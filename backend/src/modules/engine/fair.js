const crypto = require('crypto');
const db = require('../../db/pool'); // Make sure this path is correct to your db/pool.js

const E = Math.pow(2, 52);

// 1. Create a cache for settings so we don't query the database every millisecond
let gameSettings = {
  house_edge: 0.03, // Default 3% (0.03)
  max_crash: 100.00 // Default 100x max
};

// 2. Function to load settings from your key-value database correctly
async function loadSettings() {
  try {
    // FIX: Query ALL key-value pairs, not just id = 1
    const [rows] = await db.query('SELECT setting_key, setting_value FROM game_settings');
    
    // Convert rows into a simple object: { house_edge: '0.03', max_crash: '100.00', ... }
    const settingsMap = {};
    rows.forEach(row => {
      settingsMap[row.setting_key] = row.setting_value;
    });

    // Update our cache with safe defaults if the DB values are missing or invalid
    gameSettings.house_edge = Number(settingsMap.house_edge) || 0.03; 
    gameSettings.max_crash = Number(settingsMap.max_crash) || 100.00; 
    
    console.log(`[Settings] Loaded: House Edge=${gameSettings.house_edge}, Max Crash=${gameSettings.max_crash}`);
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
    return 1.00; // Instant crash
  }
  
  // Standard Provably Fair Crash Formula
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