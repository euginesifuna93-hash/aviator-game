// backend/src/modules/admin/routes.js
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const db = require('../../db/pool');
const logger = require('../../utils/logger');
const { AppError } = require('../../utils/errors');
const engine = require('../engine/engine');

// Middleware: Require Admin
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.userId) throw new AppError('Not authenticated', 401);
    const [users] = await db.query('SELECT is_admin FROM users WHERE id = ?', [req.userId]);
    if (users.length === 0 || !users[0].is_admin) {
      throw new AppError('Admin access required', 403);
    }
    next();
  } catch (err) { next(err); }
};

// ==========================================
// 1. LIVE GAME MONITORING (The old features)
// ==========================================

// GET /api/admin/game-state
router.get('/game-state', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const state = engine.state;
    if (!state) return res.json({ ok: true, data: null });

    const timeRemaining = state.phase === 'betting' 
      ? Math.max(0, state.bettingEndsAt - Date.now()) 
      : null;
      
    const flightProgress = state.phase === 'flying' && state.crashAt
      ? Math.min(100, ((Date.now() - state.takeoffAt) / (state.crashAt - state.takeoffAt)) * 100)
      : null;

    res.json({
      ok: true,
      data: {
        roundId: state.roundId,
        phase: state.phase,
        bettingEndsAt: state.bettingEndsAt,
        takeoffAt: state.takeoffAt,
        crashAt: state.crashAt,
        crashPoint: state.crashPoint,
        timeRemaining,
        flightProgress,
      }
    });
  } catch (err) { next(err); }
});

// GET /api/admin/rounds
router.get('/rounds', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [rounds] = await db.query(
      `SELECT id, crash_point, created_at, crashed_at, server_seed_hash 
       FROM rounds ORDER BY id DESC LIMIT 50`
    );
    res.json({ ok: true, rounds });
  } catch (err) { next(err); }
});

// ==========================================
// 2. FINANCIAL & USER MANAGEMENT (New features)
// ==========================================

// GET /api/admin/dashboard (All stats in one call)
router.get('/dashboard', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [stats] = await db.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN kind = 'deposit' AND status = 'completed' THEN amount_cents ELSE 0 END), 0) as total_deposits,
        COALESCE(SUM(CASE WHEN kind = 'withdrawal' AND status = 'completed' THEN ABS(amount_cents) ELSE 0 END), 0) as total_withdrawals_completed,
        COALESCE(SUM(CASE WHEN kind = 'withdrawal' AND status = 'pending' THEN ABS(amount_cents) ELSE 0 END), 0) as total_withdrawals_pending,
        COALESCE(SUM(CASE WHEN kind = 'stake' THEN ABS(amount_cents) ELSE 0 END), 0) as total_staked,
        COALESCE(SUM(CASE WHEN kind = 'cashout' THEN amount_cents ELSE 0 END), 0) as total_cashed_out,
        SUM(CASE WHEN kind = 'stake' THEN 1 ELSE 0 END) as total_bets_count,
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM users WHERE updated_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)) as active_users,
        (SELECT COALESCE(SUM(balance_cents), 0) FROM users) as total_user_balances
      FROM ledger
    `);

    const s = stats[0];
    const houseProfit = s.total_staked - s.total_cashed_out;

    // Recent activity
    const [recentActivity] = await db.query(`
      SELECT l.*, u.email FROM ledger l JOIN users u ON l.user_id = u.id ORDER BY l.created_at DESC LIMIT 50
    `);

    // Pending withdrawals
    const [pendingWithdrawals] = await db.query(`
      SELECT l.*, u.email FROM ledger l JOIN users u ON l.user_id = u.id WHERE l.kind = 'withdrawal' AND l.status = 'pending' ORDER BY l.created_at ASC
    `);

    // Revenue data for chart (last 7 days)
    const [revenueData] = await db.query(`
      SELECT DATE(created_at) as date,
        SUM(CASE WHEN kind = 'deposit' AND status = 'completed' THEN amount_cents ELSE 0 END) as deposits,
        SUM(CASE WHEN kind = 'withdrawal' AND status = 'completed' THEN ABS(amount_cents) ELSE 0 END) as withdrawals
      FROM ledger WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at) ORDER BY date ASC
    `);

    res.json({
      ok: true,
      data: {
        stats: {
          moneyIn: Number(s.total_deposits),
          moneyOut: Number(s.total_withdrawals_completed),
          pendingWithdrawals: Number(s.total_withdrawals_pending),
          totalStaked: Number(s.total_staked),
          totalCashedOut: Number(s.total_cashed_out),
          houseProfit: houseProfit,
          totalBets: Number(s.total_bets_count || 0),
          totalUsers: Number(s.total_users || 0),
          activeUsers: Number(s.active_users || 0),
          userLiability: Number(s.total_user_balances),
        },
        recentActivity,
        pendingWithdrawals,
        revenueData,
      }
    });
  } catch (err) { next(err); }
});

// GET /api/admin/users
router.get('/users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [users] = await db.query(`SELECT id, email, balance_cents, is_admin, is_banned, created_at FROM users ORDER BY created_at DESC`);
    res.json({ ok: true, users });
  } catch (err) { next(err); }
});

// POST /api/admin/users/:id/ban
// POST /api/admin/users/:id/ban
router.post('/users/:id/ban', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await db.query('UPDATE users SET is_banned = 1 WHERE id = ?', [req.params.id]);
    logger.info(`Admin banned user ${req.params.id}`);
    res.json({ ok: true, message: 'User banned' });
  } catch (err) { next(err); }
});

// POST /api/admin/users/:id/unban
router.post('/users/:id/unban', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await db.query('UPDATE users SET is_banned = 0 WHERE id = ?', [req.params.id]);
    logger.info(`Admin unbanned user ${req.params.id}`);
    res.json({ ok: true, message: 'User unbanned' });
  } catch (err) { next(err); }
});

// POST /api/admin/users/:id/adjust-balance
// POST /api/admin/users/:id/adjust-balance
router.post('/users/:id/adjust-balance', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    console.log('=== BACKEND ADJUST BALANCE ===');
    console.log('User ID:', req.params.id);
    console.log('Body:', req.body);
    
    const { amount, reason } = req.body;
    if (typeof amount !== 'number') {
      return res.status(400).json({ ok: false, error: 'Invalid amount' });
    }
    
    const amountCents = Math.round(amount * 100);
    
    await db.transaction(async (conn) => {
      // 1. Get current balance and lock the row
      const [user] = await conn.query('SELECT balance_cents FROM users WHERE id = ? FOR UPDATE', [req.params.id]);
      if (!user || user.length === 0) {
        throw new Error('User not found');
      }
      
      const currentBalance = Number(user[0].balance_cents);
      const newBalance = currentBalance + amountCents;
      
      // 2. Update user balance
      await conn.query('UPDATE users SET balance_cents = ? WHERE id = ?', [newBalance, req.params.id]);
      
      // 3. Record in ledger with UNIQUE idempotency key to prevent duplicate errors
      await conn.query(
        `INSERT INTO ledger (user_id, kind, amount_cents, balance_after_cents, status, idempotency_key, meta) 
         VALUES (?, 'admin_adjust', ?, ?, 'completed', ?, ?)`,
        [
          req.params.id, 
          amountCents, 
          newBalance, 
          `admin_adj:${Date.now()}:${req.params.id}`, // Unique key
          JSON.stringify({ reason, admin_id: req.userId })
        ]
      );
      
      console.log('✅ Balance updated successfully. New balance:', newBalance);
    });
    
    res.json({ ok: true, message: 'Balance adjusted successfully' });
  } catch (err) { 
    console.error('❌ Backend adjust balance error:', err);
    next(err); 
  }
});

// POST /api/admin/withdrawals/:id/approve
router.post('/withdrawals/:id/approve', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    await db.query("UPDATE ledger SET status = 'completed' WHERE id = ? AND kind = 'withdrawal' AND status = 'pending'", [req.params.id]);
    res.json({ ok: true, message: 'Withdrawal approved' });
  } catch (err) { next(err); }
});

// POST /api/admin/withdrawals/:id/reject
// POST /api/admin/withdrawals/:id/reject
router.post('/withdrawals/:id/reject', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [tx] = await db.query('SELECT * FROM ledger WHERE id = ? AND kind = ? AND status = ?', [req.params.id, 'withdrawal', 'pending']);
    if (tx.length === 0) throw new AppError('Transaction not found', 404);
    const refundAmount = Math.abs(Number(tx[0].amount_cents));
    await db.transaction(async (conn) => {
      await conn.query("UPDATE ledger SET status = 'rejected' WHERE id = ?", [req.params.id]);
      const [user] = await conn.query('SELECT balance_cents FROM users WHERE id = ? FOR UPDATE', [tx[0].user_id]);
      const newBalance = Number(user[0].balance_cents) + refundAmount;
      await conn.query('UPDATE users SET balance_cents = ? WHERE id = ?', [newBalance, tx[0].user_id]);
      // ✅ FIXED: Added unique idempotency_key
      await conn.query(
        `INSERT INTO ledger (user_id, kind, amount_cents, balance_after_cents, status, idempotency_key, meta) 
         VALUES (?, 'refund', ?, ?, 'completed', ?, ?)`,
        [
          tx[0].user_id, 
          refundAmount, 
          newBalance, 
          `refund:${Date.now()}:${req.params.id}`,  // ✅ Unique key
          JSON.stringify({ reason: 'Withdrawal rejected', original_tx: req.params.id })
        ]
      );
    });
    res.json({ ok: true, message: 'Withdrawal rejected and refunded' });
  } catch (err) { next(err); }
});

// GET /api/admin/transactions
router.get('/transactions', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { kind, status, email } = req.query;
    let query = `SELECT l.*, u.email FROM ledger l JOIN users u ON l.user_id = u.id WHERE 1=1`;
    const params = [];
    if (kind) { query += ' AND l.kind = ?'; params.push(kind); }
    if (status) { query += ' AND l.status = ?'; params.push(status); }
    if (email) { query += ' AND u.email LIKE ?'; params.push(`%${email}%`); }
    query += ' ORDER BY l.created_at DESC LIMIT 200';
    const [txs] = await db.query(query, params);
    res.json({ ok: true, transactions: txs });
  } catch (err) { next(err); }
});

// GET /api/admin/recommendations
router.get('/recommendations', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const recommendations = [];
    const [stats] = await db.query(`SELECT COALESCE(SUM(CASE WHEN kind = 'deposit' AND status = 'completed' THEN amount_cents ELSE 0 END), 0) as deposits, COALESCE(SUM(CASE WHEN kind = 'withdrawal' AND status = 'completed' THEN ABS(amount_cents) ELSE 0 END), 0) as withdrawals, COALESCE(SUM(CASE WHEN kind = 'stake' THEN ABS(amount_cents) ELSE 0 END), 0) as staked, COALESCE(SUM(CASE WHEN kind = 'cashout' THEN amount_cents ELSE 0 END), 0) as cashed_out, (SELECT COUNT(*) FROM ledger WHERE kind = 'withdrawal' AND status = 'pending') as pending_count FROM ledger`);
    const s = stats[0];
    const profitMargin = s.staked > 0 ? ((s.staked - s.cashed_out) / s.staked) * 100 : 0;

    if (s.pending_count > 0) recommendations.push({ type: 'warning', title: `${s.pending_count} Pending Withdrawal(s)`, message: `Process these to maintain user trust.`, priority: 'high' });
    if (profitMargin < 2 && s.staked > 0) recommendations.push({ type: 'danger', title: 'Low Profit Margin', message: `House profit margin is ${profitMargin.toFixed(1)}%. Review game math.`, priority: 'high' });
    if (recommendations.length === 0) recommendations.push({ type: 'success', title: 'All Systems Healthy', message: 'Platform running smoothly.', priority: 'low' });

    res.json({ ok: true, recommendations });
  } catch (err) { next(err); }
});


// ==========================================
// GAME SETTINGS (Admin Controls)
// ==========================================
// GET /api/admin/game-settings
router.get('/game-settings', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const [settings] = await db.query('SELECT * FROM game_settings WHERE id = 1');
    res.json({ 
      ok: true, 
      settings: settings[0] || {
        house_edge: 0.03,
        max_crash: 1000,
        min_bet: 100,
        max_bet: 10000000,
        betting_time: 11000,
        flight_speed: 15000
      }
    });
  } catch (err) { 
    console.error('Game settings fetch error:', err);
    next(err); 
  }
});
// PUT /api/admin/game-settings
router.put('/game-settings', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { house_edge, max_crash, min_bet, max_bet, betting_time, flight_speed } = req.body;
    
    await db.query(`
      INSERT INTO game_settings (id, house_edge, max_crash, min_bet, max_bet, betting_time, flight_speed)
      VALUES (1, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        house_edge = VALUES(house_edge),
        max_crash = VALUES(max_crash),
        min_bet = VALUES(min_bet),
        max_bet = VALUES(max_bet),
        betting_time = VALUES(betting_time),
        flight_speed = VALUES(flight_speed)
    `, [house_edge, max_crash, min_bet, max_bet, betting_time, flight_speed]);
    
    logger.info('Game settings updated by admin');
    res.json({ ok: true, message: 'Game settings updated' });
  } catch (err) { next(err); }
});


module.exports = router;