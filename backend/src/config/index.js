require('dotenv').config();

const required = [
  'NODE_ENV', 'PORT', 'APP_ORIGIN',
  'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME',
  'SESSION_SECRET', 'REDIS_URL',
];

const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  throw new Error(`Missing required env vars: ${missing.join(', ')}`);
}

const env = process.env.NODE_ENV;
if (!['development', 'test', 'production'].includes(env)) {
  throw new Error(`Invalid NODE_ENV: ${env}`);
}
const isProd = env === 'production';

const num = (key, fallback) => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env ${key} is not a number: ${raw}`);
  return n;
};

const bool = (key, fallback) => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`Env ${key} is not a boolean: ${raw}`);
};

const cookieSecure = bool('COOKIE_SECURE', false);
if (isProd && !cookieSecure) {
  throw new Error('COOKIE_SECURE must be true in production');
}

const sessionSecret = process.env.SESSION_SECRET;
if (sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters');
}

module.exports = {
  env, isProd, isDev: env === 'development',

  server: {
    port: num('PORT', 3000),
    host: process.env.HOST || '0.0.0.0',
    origin: process.env.APP_ORIGIN,
  },

  db: {
    host: process.env.DB_HOST,
    port: num('DB_PORT', 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    poolMin: num('DB_POOL_MIN', 2),
    poolMax: num('DB_POOL_MAX', 20),
  },

  redis: { url: process.env.REDIS_URL },

  auth: {
    sessionSecret,
    cookieDomain: process.env.COOKIE_DOMAIN || undefined,
    cookieSecure,
    sessionTtlHours: num('SESSION_TTL_HOURS', 24),
  },

  game: {
    bettingMs: num('GAME_BETTING_MS', 7000),
    settleMs: num('GAME_SETTLE_MS', 4000),
    minStakeCents: num('GAME_MIN_STAKE_CENTS', 100),
    maxStakeCents: num('GAME_MAX_STAKE_CENTS', 10_000_000),
    houseEdge: num('GAME_HOUSE_EDGE', 0.03),
    maxCrash: num('GAME_MAX_CRASH', 10000),
  },

  rateLimit: {
    windowMs: num('RATE_LIMIT_WINDOW_MS', 60_000),
    max: num('RATE_LIMIT_MAX', 120),
    betMax: num('RATE_LIMIT_BET_MAX', 20),
    cashoutMax: num('RATE_LIMIT_CASHOUT_MAX', 30),
  },

  log: { level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug') },
};