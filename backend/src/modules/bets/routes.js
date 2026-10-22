const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { validate } = require('../../middleware/validation');
const { requireAuth } = require('../auth/middleware');
const { AppError } = require('../../utils/errors'); // ✅ Ensure AppError is imported
const bets = require('./service');
const { betLimiter, cashoutLimiter } = require('../../middleware/rateLimiter');
const { calculateUserRisk } = require('../../utils/riskEngine'); // ✅ Import our new Risk Engine

// ==========================================
// PLACE BET - with Smart Risk Limits
// ==========================================
router.post('/place', betLimiter, requireAuth, [
  // We set a high max (1,000,000 cents = 10,000 KES) so the validator doesn't block 
  // the request before our Smart Limit logic can evaluate the user's specific risk level.
  body('stakeCents').isInt({ min: 100, max: 1000000 }).withMessage('Invalid stake amount'),
  body('autoCashout').optional().isFloat({ min: 1.01, max: 10000 }).withMessage('Invalid auto cashout'),
  validate
], async (req, res, next) => {
  try {
    const stakeCents = Number(req.body.stakeCents);

    // 1. Calculate/Update User Risk Level dynamically in real-time
    const { level: riskLevel } = await calculateUserRisk(req.userId);

    // 2. Define Smart Limits based on Risk Level
    let maxAllowedStake = 4000; // Default: 40 KES (Your safe baseline from game settings)
    
    if (riskLevel === 'HIGH') {
      maxAllowedStake = 1000; // 10 KES max for high-risk users (protects your 500 KES float)
    } else if (riskLevel === 'MEDIUM') {
      maxAllowedStake = 2000; // 20 KES max for medium-risk users
    }

    // 3. Enforce the Smart Limit BEFORE calling the betting service
    if (stakeCents > maxAllowedStake) {
      throw new AppError(
        `⚠️ Bet limit exceeded. Based on recent activity, your maximum allowed bet is currently ${(maxAllowedStake / 100).toFixed(2)} KES.`, 
        400
      );
    }

    // 4. Proceed with the bet only if it passes the smart limit check
    const bet = await bets.placeBet(req.userId, stakeCents, req.body.autoCashout);
    res.json({ ok: true, bet });
    
  } catch (err) { 
    next(err); 
  }
});

// ==========================================
// CASH OUT - with cashoutLimiter
// ==========================================
router.post('/cashout/:roundId', cashoutLimiter, requireAuth, [
  param('roundId').isInt().withMessage('Invalid round ID'),
  body('targetMultiplier').optional().isFloat({ min: 1.01 }).withMessage('Invalid target'),
  validate
], async (req, res, next) => {
  try {
    const result = await bets.cashOut(req.userId, Number(req.params.roundId), req.body.targetMultiplier);
    res.json({ ok: true, ...result });
  } catch (err) { 
    next(err); 
  }
});

// ==========================================
// HISTORY - no limiter needed
// ==========================================
router.get('/history', requireAuth, async (req, res, next) => {
  try {
    const history = await bets.getHistory(req.userId);
    res.json({ ok: true, history });
  } catch (err) { 
    next(err); 
  }
});

module.exports = router;