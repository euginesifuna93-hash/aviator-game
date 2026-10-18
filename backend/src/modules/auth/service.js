const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('../../db/pool');
const { AppError, AuthenticationError } = require('../../utils/errors');

const SALT_ROUNDS = 12;
async function register(email, password) {
  const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length > 0) throw new AppError('Email already registered', 409, 'DUPLICATE_EMAIL');

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const id = uuidv4();

  // --- NEW PROTECTED BONUS LOGIC ---
  const welcomeBonusCents = 1000; // 10 KES
  const wageringMultiplier = 3;   // 3x requirement
  const totalWageringRequired = welcomeBonusCents * wageringMultiplier; // 3000 cents (30 KES)

  await db.query(
    // We now insert into the new wagering_required_cents column!
    'INSERT INTO users (id, email, password_hash, balance_cents, bonus_balance_cents, wagering_required_cents) VALUES (?, ?, ?, ?, ?, ?)',
    [id, email, passwordHash, welcomeBonusCents, welcomeBonusCents, totalWageringRequired]
  );
  
  return { 
    id, 
    email, 
    balanceCents: welcomeBonusCents,
    wageringRequiredCents: totalWageringRequired // Send this back to frontend so we can show the progress bar
  };
}

async function login(email, password) {
  const [users] = await db.query('SELECT id, email, password_hash, balance_cents FROM users WHERE email = ?', [email]);
  if (users.length === 0) throw new AuthenticationError('Invalid email or password');

  const user = users[0];
  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) throw new AuthenticationError('Invalid email or password');

  return { id: user.id, email: user.email, balanceCents: user.balance_cents };
}
async function getMe(userId) {
    const [users] = await db.query(
      'SELECT id, email, balance_cents, is_admin FROM users WHERE id = ?',
      [userId]
    );
    if (users.length === 0) throw new AuthenticationError('User not found');
    
    const user = users[0];
    return {
      id: user.id,
      email: user.email,
      balanceCents: Number(user.balance_cents),
      isAdmin: Boolean(user.is_admin)  // Add this
    };
  }
module.exports = { register, login, getMe };