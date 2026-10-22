const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { requireAuth } = require('../auth/middleware');
const { AppError, ValidationError } = require('../../utils/errors');
const db = require('../../db/pool');
const logger = require('../../utils/logger');

// ==========================================
// 1. GET /api/profile/me — Get current user details
// ==========================================
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const [users] = await db.query(
      `SELECT id, email, balance_cents, is_admin, created_at, updated_at 
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
      }
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 2. PUT /api/profile/me — Update email/password
// ==========================================
router.put('/me', requireAuth, [
  body('email').optional().isEmail().normalizeEmail().trim(),
  body('currentPassword').optional().notEmpty(),
  body('newPassword').optional().isLength({ min: 8, max: 128 }),
], async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) throw new ValidationError(errors.array()[0].msg);

    const { email, currentPassword, newPassword } = req.body;
    const updates = [];
    const params = [];

    if (email) {
      const [existing] = await db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.userId]);
      if (existing.length > 0) throw new AppError('Email already in use', 409);
      updates.push('email = ?');
      params.push(email);
    }

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

    const [users] = await db.query('SELECT id, email, balance_cents FROM users WHERE id = ?', [req.userId]);
    res.json({ ok: true, user: { id: users[0].id, email: users[0].email, balanceCents: Number(users[0].balance_cents) } });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 3. POST /api/profile/deposit — Add balance (MIN 300 KES)
// ==========================================
router.post('/deposit', requireAuth, [
  body('amount').isFloat({ min: 300 }).withMessage('Minimum deposit is 300 KES'),
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
      
      await conn.query(
        `INSERT INTO ledger (user_id, kind, amount_cents, balance_after_cents, idempotency_key, status, meta) 
         VALUES (?, 'deposit', ?, ?, ?, 'completed', ?)`,
        [req.userId, amountCents, newBalance, idempotencyKey, JSON.stringify({ method, reference })]
      );
    });

    logger.info(`Deposit: user=${req.userId}, amount=${amount} KES, method=${method}`);

    const { getIO } = require('../realtime');
    const io = getIO();
    if (io) io.to(`user:${req.userId}`).emit('wallet', { balanceCents: newBalance });

    res.json({ ok: true, deposit: { amount, amountCents, method, reference, newBalanceCents: newBalance } });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 4. POST /api/profile/withdraw — Withdraw balance (MAX 150 KES PER DAY)
// ==========================================
router.post('/withdraw', requireAuth, [
  body('amount').isFloat({ min: 50 }).withMessage('Minimum withdrawal is 50 KES'),
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

    // ✅ RULE 1: Check Daily Withdrawal Limit (150 KES = 15000 cents)
    const DAILY_LIMIT_CENTS = 15000; 
    
    const [dailyWithdrawals] = await db.query(
      `SELECT COALESCE(SUM(ABS(amount_cents)), 0) as total FROM ledger 
       WHERE user_id = ? AND kind = 'withdrawal' 
       AND DATE(created_at) = CURDATE() AND status IN ('pending', 'processing', 'completed')`,
      [req.userId]
    );
    
    const dailyTotal = Number(dailyWithdrawals[0].total || 0);
    if (dailyTotal + amountCents > DAILY_LIMIT_CENTS) {
      const remaining = ((DAILY_LIMIT_CENTS - dailyTotal) / 100).toFixed(2);
      throw new AppError(`🚫 Daily limit reached! You can only withdraw ${remaining} KES more today.`, 400);
    }

    // ✅ RULE 2: Process the withdrawal safely
    let newBalance;
    await db.transaction(async (conn) => {
      const [user] = await conn.query('SELECT balance_cents FROM users WHERE id = ? FOR UPDATE', [req.userId]);
      if (Number(user[0].balance_cents) < amountCents) {
        throw new AppError('Insufficient balance', 400);
      }
      
      newBalance = Number(user[0].balance_cents) - amountCents;
      
      // Update user balance
      await conn.query('UPDATE users SET balance_cents = ? WHERE id = ?', [newBalance, req.userId]);
      
      // Record in ledger as 'pending' (requires your manual admin approval)
      await conn.query(
        `INSERT INTO ledger (user_id, kind, amount_cents, balance_after_cents, idempotency_key, status, meta) 
         VALUES (?, 'withdrawal', ?, ?, ?, 'pending', ?)`,
        [req.userId, -amountCents, newBalance, idempotencyKey, JSON.stringify({ method, account, reference })]
      );
    });

    logger.info(`Withdrawal requested: user=${req.userId}, amount=${amount} KES, method=${method}`);

    const { getIO } = require('../realtime');
    const io = getIO();
    if (io) io.to(`user:${req.userId}`).emit('wallet', { balanceCents: newBalance });

    res.json({
      ok: true,
      withdrawal: {
        amount,
        amountCents,
        method,
        account: account.replace(/(.{3}).*(.{3})/, '$1***$2'), // Mask for security
        reference,
        newBalanceCents: newBalance,
        status: 'pending',
      }
    });
  } catch (err) {
    next(err);
  }
});

// ==========================================
// 5. GET /api/profile/transactions — Recent transactions
// ==========================================
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