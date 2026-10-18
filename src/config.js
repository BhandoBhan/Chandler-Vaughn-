'use strict';

const path = require('node:path');

// The three game formats players can choose from. `area` is the part of the
// pitch the game is played on.
const FORMATS = Object.freeze({
  '3v3': Object.freeze({
    id: '3v3',
    label: '3v3',
    playersPerTeam: 3,
    area: '18-yard box',
    summary: 'Quick, small games played inside the 18-yard box.',
  }),
  '8v8': Object.freeze({
    id: '8v8',
    label: '8v8',
    playersPerTeam: 8,
    area: 'Half field',
    summary: 'Small-sided games played on half the field.',
  }),
  '11v11': Object.freeze({
    id: '11v11',
    label: '11v11',
    playersPerTeam: 11,
    area: 'Full field',
    summary: 'Full-sided games played on the full field.',
  }),
});

const SKILL_LEVELS = Object.freeze(['any', 'beginner', 'intermediate', 'advanced']);

// prettier-ignore
const US_STATES = Object.freeze([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC',
  'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]);

function numberFromEnv(env, name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}

function listFromEnv(env, name) {
  return (env[name] || '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function loadSettings(env = process.env) {
  return {
    port: numberFromEnv(env, 'PORT', 3000),
    databasePath: env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'pickup-soccer.db'),
    // "demo" credits wallets with play money. Real money needs a licensed
    // payment processor wired into src/payments.js (see README).
    paymentsMode: env.PAYMENTS_MODE || 'demo',
    wagers: {
      enabled: env.WAGERS_ENABLED !== 'false',
      minAge: numberFromEnv(env, 'WAGER_MIN_AGE', 18),
      // Share of each wager pot the platform keeps. Locked in per game when it is created.
      platformFeePercent: numberFromEnv(env, 'PLATFORM_FEE_PERCENT', 10),
      minEntryFeeCents: numberFromEnv(env, 'WAGER_MIN_ENTRY_FEE_CENTS', 100),
      maxEntryFeeCents: numberFromEnv(env, 'WAGER_MAX_ENTRY_FEE_CENTS', 10000),
      // Two-letter state codes where wager matches are switched off. Fill this in
      // after legal review; paid skill contests are regulated state by state.
      blockedStates: listFromEnv(env, 'WAGER_BLOCKED_STATES'),
      // How long the other captain has to confirm or dispute a reported result
      // before it is confirmed automatically. Also how long after a wager match
      // ends before an unreported match is refunded.
      resultWindowHours: numberFromEnv(env, 'RESULT_WINDOW_HOURS', 24),
    },
  };
}

module.exports = { FORMATS, SKILL_LEVELS, US_STATES, loadSettings };
