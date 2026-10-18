// backend/src/modules/payments/routes.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { requireAuth } = require('../auth/middleware');
const db = require('../../db/pool');
const logger = require('../../utils/logger');

// GET /api/payments/verify?reference=xxx
router.get('/verify', requireAuth, async (req, res, next) => {
  try {
    const reference = req.query.reference;
    if (!reference) {
      return res.status(400).json({ ok: false, message: 'No reference provided' });
    }

    logger.info(`Verifying payment: ${reference} for user ${req.userId}`);

    // 1. Check if already processed (idempotency)
    const [existing] = await db.query(
      'SELECT id, status FROM ledger WHERE provider_tx_id = ?', 
      [reference]
    );
    
    if (existing.length > 0) {
      logger.info(`Transaction ${reference} already processed with status: ${existing[0].status}`);
      if (existing[0].status === 'completed') {
        return res.json({ ok: true, message: 'Already processed successfully' });
      }
      return res.status(400).json({ ok: false, message: 'Transaction already exists' });
    }

    // 2. Verify with Paystack API
    let paystackRes;
    try {
      paystackRes = await axios.get(
        `https://api.paystack.co/transaction/verify/${reference}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
          },
        }
      );
    } catch (axiosErr) {
      logger.error('Paystack API error:', axiosErr.response?.data || axiosErr.message);
      return res.status(502).json({ ok: false, message: 'Paystack verification failed' });
    }

    const tx = paystackRes.data.data;
    logger.info('Paystack response status:', tx.status);

    if (tx.status !== 'success') {
      return res.status(400).json({ ok: false, message: 'Payment was not successful' });
    }

    // 3. Update User Balance in a transaction
    const amountCents = tx.amount; // Paystack returns amount in cents/kobo
    
    await db.transaction(async (conn) => {
      // Lock the user row
      const [user] = await conn.query(
        'SELECT balance_cents FROM users WHERE id = ? FOR UPDATE', 
        [req.userId]
      );
      
      if (user.length === 0) {
        throw new Error('User not found');
      }

      const currentBalance = Number(user[0].balance_cents);
      const newBalance = currentBalance + amountCents;

      // Update balance
      await conn.query(
        'UPDATE users SET balance_cents = ? WHERE id = ?', 
        [newBalance, req.userId]
      );

      await conn.query(
        `INSERT INTO ledger 
         (user_id, kind, amount_cents, balance_after_cents, status, idempotency_key, provider_tx_id, meta) 
         VALUES (?, 'deposit', ?, ?, 'completed', ?, ?, ?)`,
        [
          req.userId, 
          amountCents, 
          newBalance, 
          `dep:${reference}`,  // ← Add this as idempotency_key
          reference, 
          JSON.stringify({ email: tx.customer?.email })
        ]
      );

      logger.info(`Deposit successful: ${amountCents/100} KES, new balance: ${newBalance/100} KES`);
    });

    // 4. Notify via Socket
    const { getIO } = require('../realtime');
    const io = getIO();
    if (io) {
      io.to(`user:${req.userId}`).emit('wallet', { 
        balanceCents: Number(
          (await db.query('SELECT balance_cents FROM users WHERE id = ?', [req.userId]))[0][0].balance_cents
        ) 
      });
    }

    res.json({ 
      ok: true, 
      message: 'Deposit successful', 
      amount: amountCents / 100 
    });

  } catch (err) {
    logger.error('Verification error:', err.message);
    logger.error('Stack:', err.stack);
    
    // Check if it's a duplicate key error
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ 
        ok: false, 
        message: 'Transaction already processed' 
      });
    }
    
    next(err);
  }
});

module.exports = router;