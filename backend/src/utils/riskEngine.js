const db = require('../db/pool');

// Function to calculate and update a user's risk score
async function calculateUserRisk(userId) {
  try {
    // 1. Get user's activity in the last 24 hours
    const [stats] = await db.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount_cents ELSE 0 END), 0) as total_deposits_24h,
        SUM(CASE WHEN kind = 'deposit' THEN 1 ELSE 0 END) as deposit_count_24h,
        COALESCE(SUM(CASE WHEN kind = 'stake' THEN ABS(amount_cents) ELSE 0 END), 0) as total_staked_24h,
        COALESCE(SUM(CASE WHEN kind = 'cashout' THEN amount_cents ELSE 0 END), 0) as total_cashed_out_24h
      FROM ledger 
      WHERE user_id = ? AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `, [userId]);

    const s = stats[0];
    let score = 0;

    // 2. Calculate Risk Points
    // Rule A: High Deposit Frequency (Depositing more than twice in 24h is risky)
    if (s.deposit_count_24h >= 3) score += 30;
    else if (s.deposit_count_24h === 2) score += 10;

    // Rule B: Chasing Losses (Staked much more than they cashed out)
    const net_loss_24h = s.total_staked_24h - s.total_cashed_out_24h;
    if (net_loss_24h > 200000) score += 40; // Lost more than 2000 KES
    else if (net_loss_24h > 50000) score += 20; // Lost more than 500 KES

    // Rule C: High Velocity (Staked more than 5000 KES in 24h)
    if (s.total_staked_24h > 500000) score += 30;

    // 3. Determine Risk Level
    let level = 'LOW';
    if (score >= 60) level = 'HIGH';
    else if (score >= 30) level = 'MEDIUM';

    // 4. Update the database
    await db.query(
      'UPDATE users SET risk_score = ?, risk_level = ? WHERE id = ?', 
      [score, level, userId]
    );

    return { score, level };
  } catch (err) {
    console.error('Risk calculation error:', err);
    return { score: 0, level: 'LOW' };
  }
}

module.exports = { calculateUserRisk };