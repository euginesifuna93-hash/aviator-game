// backend/src/modules/bets/routes.js
const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { validate } = require('../../middleware/validation');
const { requireAuth } = require('../auth/middleware');
const bets = require('./service');
const { betLimiter, cashoutLimiter } = require('../../middleware/rateLimiter');

// PLACE BET - with betLimiter
router.post('/place', betLimiter, requireAuth, [
  body('stakeCents').isInt({ min: 100, max: 10000000 }).withMessage('Invalid stake'),
  body('autoCashout').optional().isFloat({ min: 1.01, max: 10000 }).withMessage('Invalid auto cashout'),
  validate
], async (req, res, next) => {
  try {
    const bet = await bets.placeBet(req.userId, req.body.stakeCents, req.body.autoCashout);
    res.json({ ok: true, bet });
  } catch (err) { next(err); }
});

// CASH OUT - with cashoutLimiter
router.post('/cashout/:roundId', cashoutLimiter, requireAuth, [
  param('roundId').isInt().withMessage('Invalid round ID'),
  body('targetMultiplier').optional().isFloat({ min: 1.01 }).withMessage('Invalid target'),
  validate
], async (req, res, next) => {
  try {
    const result = await bets.cashOut(req.userId, Number(req.params.roundId), req.body.targetMultiplier);
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// HISTORY - no limiter needed
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const history = await bets.getHistory(req.userId);
    res.json({ ok: true, history });
  } catch (err) { next(err); }
});

module.exports = router;