// backend/src/cache/redis.js
// COMPLETELY DISABLED - Using memory only

const memoryStore = new Map();

const mockRedis = {
  lpush: async (key, ...vals) => { 
    const existing = memoryStore.get(key) || [];
    memoryStore.set(key, [...vals, ...existing]); 
  },
  ltrim: async (key, start, stop) => { 
    const list = memoryStore.get(key) || []; 
    memoryStore.set(key, list.slice(start, stop + 1)); 
  },
  lrange: async (key, start, stop) => {
    const list = memoryStore.get(key) || [];
    return list.slice(start, stop + 1);
  },
  hset: async (key, field, value) => { 
    const hash = memoryStore.get(key) || {}; 
    hash[field] = value; 
    memoryStore.set(key, hash); 
  },
  hget: async (key, field) => {
    const hash = memoryStore.get(key) || {};
    return hash[field] || null;
  },
  hvals: async (key) => Object.values(memoryStore.get(key) || {}),
  expire: async () => {},
  del: async (key) => { memoryStore.delete(key); },
  quit: async () => {},
  on: () => {},
};

console.log('[CACHE] ✓ In-memory storage active (Redis disabled)');

module.exports = {
  getRedis: () => mockRedis,
  closeRedis: async () => {},
};