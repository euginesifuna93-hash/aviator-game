const crypto = require('crypto');
const db = require('../../db/pool');
const engine = require('../engine/engine');
const gameCache = require('../cache/gameCache');
const { AppError, ValidationError } = require('../../utils/errors');
const { multiplierAt } = require('../engine/fair');
const config = require('../../config');

    

async function placeBet(userId, stakeCents, autoCashout, panel = 1) {
  try {
    const currentRound = engine.snapshot();
  
    if (stakeCents < config.game.minStakeCents || stakeCents > config.game.maxStakeCents) {
      throw new ValidationError('Invalid stake amount');
    }
    if (autoCashout && (autoCashout < 1.01 || autoCashout > config.game.maxCrash)) {
      throw new ValidationError('Invalid auto cashout');
    }
  
    if (!currentRound || currentRound.phase !== 'betting') {
      throw new AppError('Betting is closed', 400);
    }
  
    const betId = crypto.randomUUID();
    let finalBalance = 0;

    await db.transaction(async (conn) => {
      const [gs] = await conn.query('SELECT * FROM game_state WHERE id = 1 FOR UPDATE');
      if (gs[0].phase !== 'betting' || gs[0].round_id !== currentRound.roundId) {
        throw new AppError('Betting closed', 400);
      }
  
      const [user] = await conn.query('SELECT * FROM users WHERE id = ? FOR UPDATE', [userId]);
      if (user[0].balance_cents < stakeCents) {
        throw new AppError('Insufficient balance', 400);
      }
  
      // ✅ ADD THE PANEL COLUMN HERE
      await conn.query(
        `INSERT INTO bets (id, round_id, user_id, stake_cents, auto_cashout, status, panel) VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
        [betId, currentRound.roundId, userId, stakeCents, autoCashout || null, panel]
      );
  
      finalBalance = user[0].balance_cents - stakeCents;
      await conn.query('UPDATE users SET balance_cents = ? WHERE id = ?', [finalBalance, userId]);
      await conn.query(
        `INSERT INTO ledger (user_id, kind, amount_cents, balance_after_cents, idempotency_key) VALUES (?, 'stake', ?, ?, ?)`,
        [userId, -stakeCents, finalBalance, `stake:${betId}`]
      );
    });
  
    if (autoCashout) engine.addAutoCashout(userId, autoCashout);
    
    await gameCache.addLiveBet(currentRound.roundId, { 
      userId, betId, stakeCents, status: 'pending', timestamp: Date.now() 
    });
    
    const { getIO } = require('../realtime');
    const io = getIO();
    if (io) {
      io.emit('live_bet_update');
      io.to(`user:${userId}`).emit('wallet', { balanceCents: finalBalance });
    }
  
    return { id: betId, roundId: currentRound.roundId, stakeCents, status: 'pending', panel };
    
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw new Error('You have already placed a bet in this panel for this round.');
    }
    throw error;
  }
}


  async function cashOut(userId, roundId, betId, targetMultiplier = null) {
    let cashoutResult = null;
    
    await db.transaction(async (conn) => {
      const [gs] = await conn.query(
        `SELECT gs.*, r.crash_point FROM game_state gs 
         JOIN rounds r ON r.id = gs.round_id WHERE gs.id = 1 FOR UPDATE`
      );
      
      if (gs[0].round_id !== roundId) throw new AppError('Round mismatch', 400);
      if (gs[0].phase !== 'flying') throw new AppError('Game not flying', 400);
  
      const [timeRes] = await conn.query(
        `SELECT TIMESTAMPDIFF(MICROSECOND, takeoff_at, NOW(3)) / 1000 AS elapsed_ms 
         FROM game_state WHERE id = 1`
      );
      const elapsedMs = Number(timeRes[0].elapsed_ms);
      const liveMultiplier = multiplierAt(elapsedMs);
      const crashPoint = Number(gs[0].crash_point);
  
      if (liveMultiplier >= crashPoint) throw new AppError('Plane already crashed', 400);
  
      const cashoutMult = targetMultiplier || liveMultiplier;
      if (cashoutMult > liveMultiplier || cashoutMult >= crashPoint) {
        throw new AppError('Invalid cashout multiplier', 400);
      }
  
      // Find the SPECIFIC bet by ID (not just any pending bet)
      const [bet] = await conn.query(
        `SELECT * FROM bets WHERE id = ? AND user_id = ? AND round_id = ? AND status = 'pending' FOR UPDATE`,
        [betId, userId, roundId]
      );
      if (bet.length === 0) throw new AppError('No active bet found', 404);
  
      const payout = Math.floor(Number(bet[0].stake_cents) * cashoutMult);
  
      await conn.query(
        `UPDATE bets SET status = 'cashed_out', cashout_multiplier = ?, payout_cents = ?, settled_at = NOW(3) 
         WHERE id = ?`,
        [cashoutMult, payout, bet[0].id]
      );
  
      const [user] = await conn.query('SELECT balance_cents FROM users WHERE id = ? FOR UPDATE', [userId]);
      const newBalance = Number(user[0].balance_cents) + payout;
      await conn.query('UPDATE users SET balance_cents = ? WHERE id = ?', [newBalance, userId]);
  
      await conn.query(
        `INSERT INTO ledger (user_id, kind, amount_cents, balance_after_cents, idempotency_key) 
         VALUES (?, 'cashout', ?, ?, ?)`,
        [userId, payout, newBalance, `cashout:${bet[0].id}`]
      );
  
      engine.removeAutoCashout(userId);
      
      cashoutResult = { 
        multiplier: cashoutMult, 
        payoutCents: payout, 
        balanceCents: newBalance 
      };
    });
  
    await gameCache.updateLiveBet(roundId, userId, { 
      status: 'cashed_out', 
      cashoutMultiplier: cashoutResult.multiplier, 
      payoutCents: cashoutResult.payoutCents 
    });
    
    const { getIO } = require('../realtime');
    const io = getIO();
    if (io) {
      io.emit('live_bet_update');
      io.to(`user:${userId}`).emit('wallet', { balanceCents: cashoutResult.balanceCents });
    }
  
    return cashoutResult;
  }


async function getHistory(userId) {
  const [rows] = await db.query(`SELECT b.*, r.crash_point, r.crashed_at FROM bets b JOIN rounds r ON r.id = b.round_id WHERE b.user_id = ? ORDER BY b.created_at DESC LIMIT 50`, [userId]);
  return rows;
}



async function cancelBet(userId, roundId, betId) { // <--- Added betId here
  let finalBalance = 0; 
  
  await db.transaction(async (conn) => {
    const [gs] = await conn.query('SELECT * FROM game_state WHERE id = 1 FOR UPDATE');
    if (gs[0].phase !== 'betting' || gs[0].round_id !== roundId) {
      throw new AppError('Betting closed', 400);
    }

    // Update this query to look for the specific betId!
    const [bet] = await conn.query(
      `SELECT * FROM bets WHERE id = ? AND user_id = ? AND round_id = ? AND status = 'pending' FOR UPDATE`,
      [betId, userId, roundId] // <--- Added betId here
    );
    if (bet.length === 0) throw new AppError('No active bet', 404);

    // ... (keep the rest of the function exactly as it was) ...
      const [user] = await conn.query('SELECT balance_cents FROM users WHERE id = ? FOR UPDATE', [userId]);
      finalBalance = Number(user[0].balance_cents) + Number(bet[0].stake_cents); // Assign here
      await conn.query('UPDATE users SET balance_cents = ? WHERE id = ?', [finalBalance, userId]);
  
      await conn.query(
        `UPDATE bets SET status = 'refunded', settled_at = NOW(3) WHERE id = ?`,
        [bet[0].id]
      );
  
      await conn.query(
        `INSERT INTO ledger (user_id, kind, amount_cents, balance_after_cents, idempotency_key) VALUES (?, 'refund', ?, ?, ?)`,
        [userId, Number(bet[0].stake_cents), finalBalance, `cancel:${bet[0].id}`]
      );
  
      await gameCache.updateLiveBet(roundId, userId, { status: 'refunded' });
    });
  
    const { getIO } = require('../realtime');
    const io = getIO();
    if (io) {
      io.emit('live_bet_update');
      io.to(`user:${userId}`).emit('wallet', { balanceCents: finalBalance }); // Now works!
    }
  
    return { ok: true };
  }
  

  
  module.exports = { placeBet, cashOut, getHistory, cancelBet };