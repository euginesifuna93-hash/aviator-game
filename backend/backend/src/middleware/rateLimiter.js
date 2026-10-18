// backend/src/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

// General API limiter - 100 requests per minute
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Auth limiter - 20 login attempts per 15 minutes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Betting limiter - 10 bets per 10 seconds
const betLimiter = rateLimit({
  windowMs: 10 * 1000, // 10 seconds
  max: 10,
  message: { error: 'Too many bets, please slow down' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Cashout limiter - 5 cashouts per 5 seconds
const cashoutLimiter = rateLimit({
  windowMs: 5 * 1000, // 5 seconds
  max: 5,
  message: { error: 'Cashout request limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ✅ Export all four
module.exports = {
  generalLimiter,
  authLimiter,
  betLimiter,
  cashoutLimiter
};