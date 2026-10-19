'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  birth_date    TEXT,              -- YYYY-MM-DD; required for wager matches
  state         TEXT,              -- two-letter US state code; required for wager matches
  skill_level   TEXT NOT NULL DEFAULT 'any',
  position      TEXT,
  home_lat      REAL,
  home_lng      REAL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS games (
  id                   INTEGER PRIMARY KEY,
  organizer_id         INTEGER NOT NULL REFERENCES users(id),
  title                TEXT NOT NULL,
  format               TEXT NOT NULL CHECK (format IN ('3v3', '8v8', '11v11')),
  skill_level          TEXT NOT NULL DEFAULT 'any',
  starts_at            TEXT NOT NULL,  -- ISO 8601, UTC
  duration_minutes     INTEGER NOT NULL,
  venue_name           TEXT NOT NULL,
  address              TEXT,
  lat                  REAL NOT NULL,
  lng                  REAL NOT NULL,
  notes                TEXT,
  is_wager             INTEGER NOT NULL DEFAULT 0,
  entry_fee_cents      INTEGER NOT NULL DEFAULT 0,
  platform_fee_percent REAL NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'scheduled'
                       CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  cancel_reason        TEXT,
  result_status        TEXT NOT NULL DEFAULT 'none'
                       CHECK (result_status IN ('none', 'pending', 'disputed', 'confirmed')),
  formation_a          TEXT,
  formation_b          TEXT,
  score_a              INTEGER,
  score_b              INTEGER,
  winner               TEXT CHECK (winner IN ('A', 'B', 'draw')),
  reported_by          INTEGER REFERENCES users(id),
  reported_at          TEXT,
  confirmed_by         INTEGER REFERENCES users(id),
  dispute_reason       TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS games_by_start ON games (status, starts_at);

CREATE TABLE IF NOT EXISTS game_players (
  game_id   INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  team      TEXT NOT NULL CHECK (team IN ('A', 'B')),
  slot      INTEGER,          -- index into the team's formation
  joined_at TEXT NOT NULL,
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX IF NOT EXISTS game_players_by_user ON game_players (user_id);

-- Every money movement is a row here; a wallet balance is the sum of a user's rows.
-- Entry fees debit the player and sit in escrow until the game is settled, so
-- the escrow held for a game is minus the sum of all of that game's rows.
-- user_id is NULL for the platform's own account (platform fees).
CREATE TABLE IF NOT EXISTS transactions (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id),
  game_id      INTEGER REFERENCES games(id),
  type         TEXT NOT NULL
               CHECK (type IN ('deposit', 'withdrawal', 'entry_fee', 'refund', 'payout', 'platform_fee')),
  amount_cents INTEGER NOT NULL,
  memo         TEXT,
  reference    TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_by_user ON transactions (user_id, id);
CREATE INDEX IF NOT EXISTS transactions_by_game ON transactions (game_id);
`;

// Columns added after the first version, so databases created before them
// still open.
const ADDED_COLUMNS = [
  ['games', 'formation_a', 'TEXT'],
  ['games', 'formation_b', 'TEXT'],
  ['game_players', 'slot', 'INTEGER'],
];

function addMissingColumns(db) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const exists = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((c) => c.name === column);
    if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  addMissingColumns(db);
  return db;
}

const transactionDepth = new WeakMap();

// Runs fn inside a single SQLite transaction. Nested calls join the outer one,
// so service functions can call each other freely.
function transaction(db, fn) {
  const depth = transactionDepth.get(db) || 0;
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  transactionDepth.set(db, 1);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    transactionDepth.set(db, 0);
  }
}

module.exports = { openDatabase, transaction };
