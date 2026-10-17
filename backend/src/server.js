// backend/src/server.js
const path = require('path');
const config = require('./config');
const express = require('express');
const http = require('http');
const session = require('express-session');

const db = require('./db/pool');
const { getRedis, closeRedis } = require('./cache/redis');
const logger = require('./utils/logger');

const {
  helmetMiddleware,
  corsMiddleware,
  jsonMiddleware,
  urlencodedMiddleware,
} = require('./middleware/security');

const { generalLimiter, authLimiter } = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const authRoutes = require('./modules/auth/routes');
const betsRoutes = require('./modules/bets/routes');
const roundsRoutes = require('./modules/rounds/routes');
const adminRoutes = require('./modules/admin/routes');
const profileRoutes = require('./modules/profile/routes');
const paymentRoutes = require('./modules/payments/routes');

const engine = require('./modules/engine/engine');
const { initRealtime } = require('./modules/realtime');

const app = express();
const server = http.createServer(app);

// NGROK COMPATIBILITY
app.use((req, res, next) => {
  if (req.headers['ngrok-skip-browser-warning'] || req.query['ngrok-free'] !== undefined) {
    res.setHeader('ngrok-skip-browser-warning', 'true');
  }

  const origin = req.headers.origin;
  const allowedOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    config.app.origin,
  ];

  if (allowedOrigins.includes(origin) || (origin && origin.includes('ngrok'))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// 1. Security & Parsing
app.use(helmetMiddleware);
app.use(corsMiddleware);
app.use(jsonMiddleware);
app.use(urlencodedMiddleware);

// 2. Session Management
const sessionConfig = {
  secret: config.auth.sessionSecret,
  resave: false,
  saveUninitialized: false,
  name: 'aviator.sid',
  cookie: {
    secure: false,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: config.auth.sessionTtlHours * 60 * 60 * 1000,
  },
};

const sessionMiddleware = session(sessionConfig);
app.use(sessionMiddleware);

// 3. Rate Limiting - Applied to specific routes
app.use('/api/auth', authLimiter);      // Login/register protection
app.use('/api/', generalLimiter);        // General API protection

// 4. API Routes
app.use('/api/auth', authRoutes);
app.use('/api/bets', betsRoutes);
app.use('/api/rounds', roundsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/profile', profileRoutes);
// ... inside the route registration section ...
app.use('/api/profile', profileRoutes);
app.use('/api/payments', paymentRoutes); // <--- MAKE SURE THIS IS HERE



// 5. Health Check
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    env: config.env,
    time: new Date().toISOString(),
  });
});

// 6. Serve Frontend
const frontendDir = path.resolve(__dirname, '../../frontend');
app.use(express.static(frontendDir, {
  index: 'index.html',
  maxAge: config.isProd ? '1d' : 0,
  etag: true,
}));

// SPA Fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// 7. Error Handling
app.use(notFoundHandler);
app.use(errorHandler);

// 8. Start Server
server.listen(config.server.port, config.server.host, () => {
  logger.info(`Server listening on http://${config.server.host}:${config.server.port}`);
  getRedis();

  initRealtime(server, sessionMiddleware);

  engine.boot().catch(err => {
    logger.error({ err }, 'Engine boot failed');
  });
});

// 9. Graceful Shutdown
const shutdown = async (signal) => {
  logger.info(`Received ${signal}, shutting down...`);
  server.close(async () => {
    await db.closePool();
    await closeRedis();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled Rejection');
  shutdown('UNHANDLED_REJECTION');
});