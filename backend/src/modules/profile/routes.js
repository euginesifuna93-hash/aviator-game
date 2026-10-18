// backend/src/modules/profile/routes.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../auth/middleware');
const { AppError, ValidationError } = require('../../utils/errors');
const db = require('../../db/pool');
const logger = require('../../utils/logger');



// GET /api/profile/me — Get current user details
// GET /api/profile/me — Get current user details
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [users] = await db.query(
      `SELECT id, email, balance_cents, is_admin, created_at, updated_at, 
              bonus_balance_cents, wagering_required_cents 
       FROM users WHERE id = ?`,
      [req.userId]
    );
    if (users.length === 0) throw new AppError('User not found', 404);
    
    const user = users[0];
    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        balanceCents: Number(user.balance_cents),
        isAdmin: Boolean(user.is_admin),
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        // ✅ NEW: Send bonus data to frontend
        bonusBalanceCents: Number(user.bonus_balance_cents || 0),
        wageringRequiredCents: Number(user.wagering_required_cents || 0),
      }
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/profile/me — Update email/password
router.put('/me', requireAuth, [
  body('email').optional().isEmail().normalizeEmail().trim(),
  body('currentPassword').optional().notEmpty(),
  body('newPassword').optional().isLength({ min: 8, max: 128 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      throw new ValidationError(errors.array()[0].msg);
    }

    const { email, currentPassword, newPassword } = req.body;
    const updates = [];
    const params = [];

    // Update email
    if (email) {
      const [existing] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.userId]);
      if (existing.length > 0) throw new AppError('Email already in use', 409);
      updates.push('email = ?');
      params.push(email);
    }

    // Update password
    if (newPassword) {
      if (!currentPassword) throw new ValidationError('Current password required');
      
      const [users] = await db.query('SELECT password_hash FROM users WHERE id = ?', [req.userId]);
      const isValid = await bcrypt.compare(currentPassword, users[0].password_hash);
      if (!isValid) throw new AppError('Current password is incorrect', 401);
      
      const hash = await bcrypt.hash(newPassword, 12);
      updates.push('password_hash = ?');
      params.push(hash);
    }

    if (updates.length === 0) throw new ValidationError('Nothing to update');

    params.push(req.userId);
    await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    // Fetch updated user
    const [users] = await db.query('SELECT id, email, balance_cents FROM users WHERE id = ?', [req.userId]);
    const user = users[0];
    
    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        balanceCents: Number(user.balance_cents),
      }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/profile/deposit — Add balance (min 100 KES)
router.post('/deposit', requireAuth, [
  body('amount').isFloat({ min: 100 }).withMessage('Minimum deposit is 100 KES'),
  body('method').isIn(['mpesa', 'bank', 'card']).withMessage('Invalid payment method'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new ValidationError(errors.array()[0].msg);

    const { amount, method } = req.body;
    const amountCents = Math.round(amount * 100);
    const idempotencyKey = `dep:${crypto.randomUUID()}`;
    const reference = `DEP-${Date.now().toString().slice(-8)}`;

    let newBalance;
    await db.transaction(async (conn) => {
      const [user] = await conn.query('SELECT balance_cents FROM users WHERE id = ? FOR UPDATE', [req.userId]);
      newBalance = Number(user[0].balance_cents) + amountCents;
      
      await conn.query('UPDATE users SET balance_cents = ? WHERE id = ?', [newBalance, req.userId]);
      
      // Added 'completed' status for instant deposits
      await conn.query(
        `INSERT INTO ledger (user_id, kind, amount_cents, balance_after_cents, idempotency_key, status, meta) 
         VALUES (?, 'deposit', ?, ?, ?, 'completed', ?)`,
        [req.userId, amountCents, newBalance, idempotencyKey, JSON.stringify({ method, reference })]
      );
    });

    logger.info(`Deposit: user=${req.userId}, amount=${amountCents}, method=${method}`);

    // Notify via socket
    const { getIO } = require('../realtime');
    const io = getIO();
    if (io) io.to(`user:${req.userId}`).emit('wallet', { balanceCents: newBalance });

    res.json({
      ok: true,
      deposit: {
        amount,
        amountCents,
        method,
        reference,
        newBalanceCents: newBalance,
      }
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/profile/withdraw — Withdraw balance (min 100 KES) WITH DAILY LIMIT
router.post('/withdraw', requireAuth, [
  body('amount').isFloat({ min: 100 }).withMessage('Minimum withdrawal is 100 KES'),
  body('method').isIn(['mpesa', 'bank']).withMessage('Invalid withdrawal method'),
  body('account').notEmpty().withMessage('Account number/phone required'),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new ValidationError(errors.array()[0].msg);

    const { amount, method, account } = req.body;
    const amountCents = Math.round(amount * 100);
    const idempotencyKey = `wd:${crypto.randomUUID()}`;
    const reference = `WD-${Date.now().toString().slice(-8)}`;
    // --- SMART WAGERING SHIELD ---
    const [userWithBonus] = await db.query(
      'SELECT balance_cents, bonus_balance_cents, wagering_required_cents FROM users WHERE id = ?', 
      [req.userId]
    );
    
    const totalBalance = Number(userWithBonus[0].balance_cents);
    const bonusBalance = Number(userWithBonus[0].bonus_balance_cents || 0);
    const wageringRequired = Number(userWithBonus[0].wagering_required_cents || 0);
    
    // Calculate how much of their balance is ACTUALLY their own real money
    const realMoneyBalance = totalBalance - bonusBalance; 

    if (wageringRequired > 0) {
      if (amountCents > realMoneyBalance) {
        // They are trying to withdraw bonus winnings before meeting the requirement
        const remainingKES = (wageringRequired / 100).toFixed(2);
        const maxWithdrawKES = (realMoneyBalance / 100).toFixed(2);
        throw new AppError(`🔒 Bonus locked! Please wager ${remainingKES} KES more to unlock winnings. (You can withdraw up to ${maxWithdrawKES} KES of your own deposited funds).`, 400);
      } else {
        // They are withdrawing their OWN real money. We allow it, but we FORFEIT the bonus!
        // We will handle the bonus cancellation inside the transaction below.
        req.forfeitBonus = true; 
      }
    }
    // --------------------------------
    // 1. Check daily withdrawal limit (50,000 KES = 5,000,000 cents)
    const DAILY_WITHDRAWAL_LIMIT = 5000000; 
    const today = new Date().toISOString().split('T')[0];
    
    const [dailyWithdrawals] = await db.query(
      `SELECT COALESCE(SUM(ABS(amount_cents)), 0) as total FROM ledger 
       WHERE user_id = ? AND kind = 'withdrawal' 
       AND DATE(created_at) = ? AND status IN ('pending', 'processing', 'completed')`,
      [req.userId, today]
    );
    
    const dailyTotal = Number(dailyWithdrawals[0].total || 0);
    if (dailyTotal + amountCents > DAILY_WITHDRAWAL_LIMIT) {
      throw new AppError(`Daily withdrawal limit of ${DAILY_WITHDRAWAL_LIMIT / 100} KES exceeded`, 400);
    }



    let newBalance;
    await db.transaction(async (conn) => {
      const [user] = await conn.query('SELECT balance_cents FROM users WHERE id = ? FOR UPDATE', [req.userId]);
      if (Number(user[0].balance_cents) < amountCents) {
        throw new AppError('Insufficient balance', 400);
      }
      
      newBalance = Number(user[0].balance_cents) - amountCents;
      
      // --- NEW: Handle Bonus Forfeiture ---
      let bonusUpdateQuery = '';
      let bonusUpdateValues = [];
      
      if (req.forfeitBonus) {
        bonusUpdateQuery = ', bonus_balance_cents = 0, wagering_required_cents = 0';
        bonusUpdateValues = [];
        logger.info(`User ${req.userId} forfeited bonus to withdraw real funds.`);
      }

      await conn.query(
        `UPDATE users SET balance_cents = ? ${bonusUpdateQuery} WHERE id = ?`, 
        [newBalance, ...bonusUpdateValues, req.userId]
      );
      // ------------------------------------
      
      // 2. Insert ledger with status 'pending' (requires admin approval for real money safety)
      await conn.query(
        `INSERT INTO ledger (user_id, kind, amount_cents, balance_after_cents, idempotency_key, status, meta) 
         VALUES (?, 'withdrawal', ?, ?, ?, 'pending', ?)`,
        [req.userId, -amountCents, newBalance, idempotencyKey, JSON.stringify({ method, account, reference })]
      );
    });

    logger.info(`Withdrawal requested: user=${req.userId}, amount=${amountCents}, method=${method}, account=${account}`);

    const { getIO } = require('../realtime');
    const io = getIO();
    if (io) io.to(`user:${req.userId}`).emit('wallet', { balanceCents: newBalance });

    res.json({
      ok: true,
      withdrawal: {
        amount,
        amountCents,
        method,
        account: account.replace(/(.{3}).*(.{3})/, '$1***$2'), // Mask account for security
        reference,
        newBalanceCents: newBalance,
        status: 'pending', // Inform frontend it's pending admin approval
      }
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/profile/transactions — Recent transactions
router.get('/transactions', requireAuth, async (req, res, next) => {
  try {
    const [txs] = await db.query(
      `SELECT id, kind, amount_cents, balance_after_cents, status, meta, created_at 
       FROM ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [req.userId]
    );
    res.json({ ok: true, transactions: txs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;