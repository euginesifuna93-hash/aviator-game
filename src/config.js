// backend/src/config.js
require('dotenv').config();

module.exports = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',

  server: {
    host: process.env.HOST || '0.0.0.0',
    port: parseInt(process.env.PORT || '3000', 10),
  },

  // ✅ ADD THIS - Database config (was missing!)
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'aviator_db',
  },

  // ✅ ADD THIS - Redis config (was missing!)
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  auth: {
    sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-in-prod',
    sessionTtlHours: parseInt(process.env.SESSION_TTL_HOURS || '24', 10),
  },

  app: {
    origin: process.env.APP_ORIGIN || 'http://localhost:3000',
  },

  game: {
    bettingMs: parseInt(process.env.GAME_BETTING_MS || '7000', 10),
    minStakeCents: parseInt(process.env.GAME_MIN_STAKE_CENTS || '100', 10),
    maxStakeCents: parseInt(process.env.GAME_MAX_STAKE_CENTS || '2500000', 10),
    maxCrash: parseFloat(process.env.GAME_MAX_CRASH || '100'),
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  },

  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY || '',
    publicKey: process.env.PAYSTACK_PUBLIC_KEY || '',
    webhookSecret: process.env.PAYSTACK_WEBHOOK_SECRET || '',
    callbackUrl: process.env.PAYSTACK_CALLBACK_URL || '',
  },
};