const crypto = require('crypto');
const db = require('../../db/pool'); // Make sure this path is correct to your db/pool.js

const E = Math.pow(2, 52);

// 1. Create a cache for settings so we don't query the database every millisecond
let gameSettings = {
  house_edge: 0.03, // Default 3%
  max_crash: 1000.00 // Default 1000x
};

// 2. Function to load settings from your database
async function loadSettings() {
  try {
    const [rows] = await db.query('SELECT house_edge, max_crash FROM game_settings WHERE id = 1');
    if (rows.length > 0) {
      gameSettings.house_edge = Number(rows[0].house_edge);
      gameSettings.max_crash = Number(rows[0].max_crash);
      console.log(`[Settings] Loaded: House Edge=${gameSettings.house_edge}, Max Crash=${gameSettings.max_crash}`);
    }
  } catch (err) {
    console.error('[Settings] Failed to load, using defaults:', err.message);
  }
}

// 3. Load settings immediately when the server starts
loadSettings();

// 4. Refresh settings every 30 seconds (so admin changes take effect automatically)
setInterval(loadSettings, 30000);

function hashSeed(serverSeed) {
  return crypto.createHash('sha256').update(serverSeed).digest('hex');
}

function crashPoint(serverSeed, clientSeed, nonce) {
  const buffer = Buffer.from(serverSeed + clientSeed + nonce);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  
  const h = parseInt(hash.slice(0, 13), 16);
  const random = h / E;
  
  // USE THE DYNAMIC HOUSE EDGE FROM DATABASE
  if (random < gameSettings.house_edge) {
    return 1.00;
  }
  
  const crash = Math.max(1.00, Math.floor((0.99 / (1 - random)) * 100) / 100);
  
  // USE THE DYNAMIC MAX CRASH FROM DATABASE
  return Math.min(crash, gameSettings.max_crash);
}

function multiplierAt(elapsedMs) {
  return Math.exp(elapsedMs / 15000);
}

function crashDelayMs(crashPoint) {
  if (crashPoint <= 1.00) return 0;
  return 15000 * Math.log(crashPoint);
}

module.exports = { hashSeed, crashPoint, multiplierAt, crashDelayMs };