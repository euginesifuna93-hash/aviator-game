const express = require('express');
const router = express.Router();
const gameCache = require('../cache/gameCache');
const engine = require('../engine/engine');

router.get('/history', async (req, res, next) => {
  try {
    const history = await gameCache.getHistory();
    res.json({ ok: true, history });
  } catch (err) { next(err); }
});

router.get('/live-bets', async (req, res, next) => {
  try {
    const snapshot = engine.snapshot();
    if (!snapshot) return res.json({ ok: true, bets: [] });
    const bets = await gameCache.getLiveBets(snapshot.roundId);
    res.json({ ok: true, bets });
  } catch (err) { next(err); }
});

module.exports = router;