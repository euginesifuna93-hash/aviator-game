// backend/src/db/migrate.js
const fs = require('fs');
const path = require('path');
const config = require('../config');
const mysql = require('mysql2/promise');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function run() {
  // Use a single connection (not the pool) for migrations
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: false, // we run one file at a time
  });

  try {
    // Ensure DB exists
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${config.db.database}\``);
    await conn.query(`USE \`${config.db.database}\``);

    // Ensure _migrations table exists (bootstrap)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(128) NOT NULL PRIMARY KEY,
        applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB
    `);

    // Get list of migration files, sorted
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    if (!files.length) {
      console.log('[migrate] no migration files found');
      return;
    }

    // Get already-applied migrations
    const [applied] = await conn.query('SELECT name FROM _migrations');
    const appliedSet = new Set(applied.map(r => r.name));

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`[migrate] skip (already applied): ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`[migrate] applying: ${file}`);

      await conn.beginTransaction();
      try {
        // Split on semicolons to run each statement separately
        // (mysql2 doesn't support multiple statements by default)
        const statements = sql
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0);

        for (const stmt of statements) {
          await conn.query(stmt);
        }

        await conn.query('INSERT INTO _migrations (name) VALUES (?)', [file]);
        await conn.commit();
        console.log(`[migrate] ✓ applied: ${file}`);
      } catch (err) {
        await conn.rollback();
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }

    console.log('[migrate] done');
  } finally {
    await conn.end();
  }
}

run().catch(err => {
  console.error('[migrate] FATAL:', err.message);
  process.exit(1);
});