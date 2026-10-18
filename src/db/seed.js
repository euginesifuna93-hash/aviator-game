// backend/src/db/seed.js
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const config = require('../config');
const mysql = require('mysql2/promise');
const { crashPoint, hashSeed } = require('../modules/engine/fair');

const DEMO_EMAIL = 'demo@aviator.local';
const DEMO_PASSWORD = 'demo1234';
const DEMO_BALANCE_CENTS = 100000; // $1000.00

async function seed() {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
  });

  try {
    // Check if demo user exists
    const [existing] = await conn.query(
      'SELECT id FROM users WHERE email = ?',
      [DEMO_EMAIL]
    );
    if (existing.length) {
      console.log(`[seed] demo user already exists: ${DEMO_EMAIL}`);
      return;
    }

    // Create demo user
    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

    await conn.query(
      `INSERT INTO users (id, email, password_hash, balance_cents)
       VALUES (?, ?, ?, ?)`,
      [userId, DEMO_EMAIL, passwordHash, DEMO_BALANCE_CENTS]
    );
    console.log(`[seed] ✓ created demo user: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);

    // Seed 20 historical rounds for the history UI
    const clientSeed = 'aviator-demo';
    for (let nonce = 1; nonce <= 20; nonce++) {
      const serverSeed = crypto.randomBytes(32).toString('hex');
      const crash = crashPoint(serverSeed, clientSeed, nonce);
      const crashedAt = new Date(Date.now() - (21 - nonce) * 30_000); // staggered

      await conn.query(
        `INSERT INTO rounds (server_seed, server_seed_hash, client_seed, nonce, crash_point, crashed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [serverSeed, hashSeed(serverSeed), clientSeed, nonce, crash, crashedAt]
      );
    }
    console.log('[seed] ✓ created 20 historical rounds');
  } finally {
    await conn.end();
  }
}

seed().catch(err => {
  console.error('[seed] FATAL:', err.message);
  process.exit(1);
});