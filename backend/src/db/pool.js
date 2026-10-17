// backend/src/db/pool.js
const mysql = require('mysql2/promise');
const config = require('../config');

let pool = null;

function getPool() {
  if (pool) return pool;

  pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: config.db.poolMax,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    // Critical: use TIMESTAMP(3) correctly
    dateStrings: false,
    timezone: '+00:00',
  });

  // Log pool errors (don't crash — pool will reconnect)
  pool.on('connection', (conn) => {
    conn.on('error', (err) => {
      console.error('[db] connection error:', err.message);
    });
  });

  return pool;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

// Helper: run a function inside a transaction
async function transaction(fn) {
  const p = getPool();
  const conn = await p.getConnection();
  await conn.beginTransaction();
  try {
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = {
  getPool,
  closePool,
  transaction,
  // Convenience: query directly on the pool
  query: (...args) => getPool().query(...args),
};