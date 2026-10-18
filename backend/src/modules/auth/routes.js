const express = require('express');
const router = express.Router();
const { validate } = require('../../middleware/validation');
const { registerRules, loginRules } = require('./validation');
const auth = require('./service');
const { requireAuth } = require('./middleware');

router.post('/register', registerRules, validate, async (req, res, next) => {
  try {
    const user = await auth.register(req.body.email, req.body.password);
    req.session.userId = user.id;
    res.status(201).json({ ok: true, user });
  } catch (err) { next(err); }
});

router.post('/login', loginRules, validate, async (req, res, next) => {
  try {
    const user = await auth.login(req.body.email, req.body.password);
    req.session.userId = user.id;
    res.json({ ok: true, user });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ ok: false, error: 'Logout failed' });
    res.clearCookie('aviator.sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await auth.getMe(req.userId);
    res.json({ ok: true, user });
  } catch (err) { next(err); }
});

module.exports = router;