-- 001_initial.sql
-- Foundation schema for Aviator

-- ---------- Users ----------
CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) NOT NULL PRIMARY KEY,          -- UUID v4, fixed size = faster than VARCHAR
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,       -- bcrypt hash
  balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Rounds ----------
-- Each round has a committed server seed (hash published before betting).
-- The crash point is computed server-side and NEVER sent to clients until crash.
CREATE TABLE IF NOT EXISTS rounds (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  server_seed VARCHAR(64) NOT NULL,          -- kept secret until crash
  server_seed_hash VARCHAR(64) NOT NULL,     -- published BEFORE betting opens
  client_seed VARCHAR(64) NOT NULL,
  nonce BIGINT NOT NULL,
  crash_point DECIMAL(12,2) NOT NULL,        -- e.g. 2.34, 100.00
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  crashed_at TIMESTAMP(3) NULL,
  UNIQUE INDEX idx_rounds_nonce (client_seed, nonce)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Game state (singleton) ----------
-- Exactly ONE row (id=1). We lock it with FOR UPDATE to serialize
-- all state transitions (bet placement, takeoff, crash, cash-out).
-- This is the single source of truth for "what phase are we in?"
CREATE TABLE IF NOT EXISTS game_state (
  id TINYINT NOT NULL PRIMARY KEY CHECK (id = 1),
  round_id BIGINT NOT NULL,
  phase ENUM('betting','flying','settled') NOT NULL,
  betting_ends_at TIMESTAMP(3) NOT NULL,
  takeoff_at TIMESTAMP(3) NULL,
  crash_at TIMESTAMP(3) NULL,
  CONSTRAINT fk_game_state_round FOREIGN KEY (round_id) REFERENCES rounds(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed the singleton row
INSERT INTO game_state (id, round_id, phase, betting_ends_at)
VALUES (1, 0, 'settled', CURRENT_TIMESTAMP(3));

-- ---------- Bets ----------
CREATE TABLE IF NOT EXISTS bets (
  id CHAR(36) NOT NULL PRIMARY KEY,          -- UUID v4
  round_id BIGINT NOT NULL,
  user_id CHAR(36) NOT NULL,
  stake_cents BIGINT NOT NULL CHECK (stake_cents > 0),
  auto_cashout DECIMAL(12,2) NULL,           -- NULL = manual cash-out only
  status ENUM('pending','cashed_out','lost','refunded') NOT NULL DEFAULT 'pending',
  cashout_multiplier DECIMAL(12,2) NULL,
  payout_cents BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  settled_at TIMESTAMP(3) NULL,
  -- One active bet per user per round (prevents double-betting)
  UNIQUE INDEX idx_bets_round_user (round_id, user_id),
  INDEX idx_bets_user_status (user_id, status),
  INDEX idx_bets_round_status (round_id, status),
  CONSTRAINT fk_bets_round FOREIGN KEY (round_id) REFERENCES rounds(id),
  CONSTRAINT fk_bets_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Ledger ----------
-- Append-only. Every balance change has a row here.
-- idempotency_key prevents double-processing of the same event.
CREATE TABLE IF NOT EXISTS ledger (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  kind VARCHAR(32) NOT NULL,                 -- 'stake' | 'cashout' | 'refund' | 'deposit' | 'withdraw'
  amount_cents BIGINT NOT NULL,              -- signed: negative = debit, positive = credit
  balance_after_cents BIGINT NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,  -- e.g. 'stake:<betId>'
  meta JSON NULL,                            -- optional structured metadata
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_ledger_user_created (user_id, created_at),
  CONSTRAINT fk_ledger_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Migrations tracker ----------
CREATE TABLE IF NOT EXISTS _migrations (
  name VARCHAR(128) NOT NULL PRIMARY KEY,
  applied_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;