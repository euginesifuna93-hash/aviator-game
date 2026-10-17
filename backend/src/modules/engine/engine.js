


// backend/src/modules/engine/engine.js
const { EventEmitter } = require('events');
const crypto = require('crypto');
const db = require('../../db/pool');
const logger = require('../../utils/logger');
const { hashSeed, crashPoint, multiplierAt, crashDelayMs } = require('./fair');
const gameCache = require('../cache/gameCache');
const config = require('../../config');

const SETTLE_MS = 4000;
const CLIENT_SEED = 'aviator-server-seed-v1';

class Engine extends EventEmitter {
  constructor() {
    super();
    this.state = null;
    this.autoCashouts = new Map();
  }

  async boot() {
    logger.info('Engine booting...');
    await this.openBetting();
    setInterval(() => this.tick(), 100);
  }

  snapshot() {
    if (!this.state) return null;
    return {
      roundId: this.state.roundId,
      phase: this.state.phase,
      bettingEndsAt: this.state.bettingEndsAt,
      takeoffAt: this.state.takeoffAt,
      crashAt: this.state.crashAt,
    };
  }

  async tick() {
    if (!this.state) return;
    const now = Date.now();

    if (this.state.phase === 'betting' && now >= this.state.bettingEndsAt) {
      await this.takeoff();
    } else if (this.state.phase === 'flying' && now >= this.state.crashAt) {
      await this.crash();
    } else if (this.state.phase === 'flying') {
      const elapsed = now - this.state.takeoffAt;
      const currentMult = multiplierAt(elapsed);
      
      for (const [userId, target] of [...this.autoCashouts]) {
        if (currentMult >= target && target < this.state.crashPoint) {
          try {
            const betsService = require('../bets/service');
            await betsService.cashOut(userId, this.state.roundId, target);
            this.autoCashouts.delete(userId);
          } catch (err) {
            logger.warn({ err, userId }, 'Auto cashout failed');
          }
        }
      }
      this.emit('tick', { 
        roundId: this.state.roundId, 
        multiplier: Math.floor(currentMult * 100) / 100 
      });
    } else if (this.state.phase === 'settled' && now >= this.state.settledUntil) {
      await this.openBetting();
    }
  }

  async openBetting() {
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const nonce = Date.now();
    const crash = crashPoint(serverSeed, CLIENT_SEED, nonce);
    const bettingEndsAt = Date.now() + config.game.bettingMs;

    let dbRoundId;
    
    await db.transaction(async (conn) => {
      const [roundRes] = await conn.query(
        `INSERT INTO rounds (server_seed, server_seed_hash, client_seed, nonce, crash_point) VALUES (?, ?, ?, ?, ?)`,
        [serverSeed, hashSeed(serverSeed), CLIENT_SEED, nonce, crash]
      );
      dbRoundId = roundRes.insertId;
      
      await conn.query(
        `UPDATE game_state SET round_id = ?, phase = 'betting', betting_ends_at = FROM_UNIXTIME(?/1000), takeoff_at = NULL, crash_at = NULL WHERE id = 1`,
        [dbRoundId, bettingEndsAt]
      );
    });

    this.state = {
      roundId: dbRoundId,
      phase: 'betting',
      bettingEndsAt,
      takeoffAt: null,
      crashAt: null,
      crashPoint: crash,
      serverSeed,
    };

    this.autoCashouts.clear();
    await gameCache.clearLiveBets(this.state.roundId);
    this.emit('snapshot', this.snapshot());
    logger.info(`Round ${this.state.roundId} started. Betting ends in ${config.game.bettingMs}ms`);
  }

  async takeoff() {
    const takeoffAt = Date.now();
    const crashDelay = crashDelayMs(this.state.crashPoint);
    const crashAt = takeoffAt + crashDelay;

    await db.transaction(async (conn) => {
      await conn.query(
        `UPDATE game_state SET phase = 'flying', takeoff_at = FROM_UNIXTIME(?/1000), crash_at = FROM_UNIXTIME(?/1000) WHERE id = 1 AND phase = 'betting'`,
        [takeoffAt, crashAt]
      );
    });

    this.state.phase = 'flying';
    this.state.takeoffAt = takeoffAt;
    this.state.crashAt = crashAt;
    this.emit('snapshot', this.snapshot());
    logger.info(`Round ${this.state.roundId} took off! Crash at ${this.state.crashPoint}x`);
  }

  async crash() {
    await db.transaction(async (conn) => {
      await conn.query(`UPDATE game_state SET phase = 'settled' WHERE id = 1 AND phase = 'flying'`);
      await conn.query(`UPDATE rounds SET crashed_at = NOW(3) WHERE id = ?`, [this.state.roundId]);
      await conn.query(`UPDATE bets SET status = 'lost', settled_at = NOW(3) WHERE round_id = ? AND status = 'pending'`, [this.state.roundId]);
    });

    this.state.phase = 'settled';
    this.state.settledUntil = Date.now() + SETTLE_MS;

    await gameCache.pushHistory(this.state.crashPoint);
    this.emit('crashed', { 
      roundId: this.state.roundId, 
      crashPoint: this.state.crashPoint,
      serverSeed: this.state.serverSeed
    });
    logger.info(`Round ${this.state.roundId} crashed at ${this.state.crashPoint}x`);
  }

  addAutoCashout(userId, target) {
    this.autoCashouts.set(userId, target);
  }

  removeAutoCashout(userId) {
    this.autoCashouts.delete(userId);
  }
}

const engine = new Engine();
module.exports = engine;