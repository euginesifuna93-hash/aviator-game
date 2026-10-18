const { getRedis } = require('../../cache/redis');
const db = require('../../db/pool');

const HISTORY_KEY = 'aviator:history';
const LIVE_BETS_PREFIX = 'aviator:round:';
const MAX_HISTORY = 100;

async function pushHistory(crashPoint) {
  const redis = getRedis();
  await redis.lpush(HISTORY_KEY, crashPoint);
  await redis.ltrim(HISTORY_KEY, 0, MAX_HISTORY - 1);
}

async function getHistory() {
  const redis = getRedis();
  let history = await redis.lrange(HISTORY_KEY, 0, MAX_HISTORY - 1);
  if (!history.length) {
    const [rows] = await db.query('SELECT crash_point FROM rounds ORDER BY id DESC LIMIT ?', [MAX_HISTORY]);
    history = rows.map(r => String(r.crash_point));
    if (history.length) await redis.lpush(HISTORY_KEY, ...history);
  }
  return history.map(h => Number(h));
}

async function addLiveBet(roundId, bet) {
  const redis = getRedis();
  const key = `${LIVE_BETS_PREFIX}${roundId}`;
  await redis.hset(key, bet.userId, JSON.stringify(bet));
  await redis.expire(key, 300);
}

async function updateLiveBet(roundId, userId, updates) {
  const redis = getRedis();
  const key = `${LIVE_BETS_PREFIX}${roundId}`;
  const existing = await redis.hget(key, userId);
  if (existing) {
    const parsed = JSON.parse(existing);
    Object.assign(parsed, updates);
    await redis.hset(key, userId, JSON.stringify(parsed));
  }
}

async function getLiveBets(roundId) {
  const redis = getRedis();
  const key = `${LIVE_BETS_PREFIX}${roundId}`;
  const data = await redis.hvals(key);
  return data.map(d => JSON.parse(d));
}

async function clearLiveBets(roundId) {
  const redis = getRedis();
  await redis.del(`${LIVE_BETS_PREFIX}${roundId}`);
}

module.exports = { pushHistory, getHistory, addLiveBet, updateLiveBet, getLiveBets, clearLiveBets };