const { body } = require('express-validator');

const registerRules = [
  body('email').isEmail().withMessage('Invalid email format').normalizeEmail().trim(),
  body('password').isLength({ min: 8, max: 128 }).withMessage('Password must be 8-128 chars').trim(),
];

const loginRules = [
  body('email').isEmail().normalizeEmail().trim(),
  body('password').notEmpty().withMessage('Password is required').trim(),
];

module.exports = { registerRules, loginRules };