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

const ROLE_BY_POSITION = {
  GK: 'GK',
  CB: 'DEF', LCB: 'DEF', RCB: 'DEF', LB: 'DEF', RB: 'DEF', LWB: 'DEF', RWB: 'DEF',
  CDM: 'MID', LDM: 'MID', RDM: 'MID', CM: 'MID', LCM: 'MID', RCM: 'MID', LM: 'MID', RM: 'MID',
  CAM: 'MID', LAM: 'MID', RAM: 'MID',
  ST: 'FWD', LS: 'FWD', RS: 'FWD', LW: 'FWD', RW: 'FWD', LF: 'FWD', RF: 'FWD',
};

function spots(list) {
  return Object.freeze(list.map(([pos, x, y]) => Object.freeze({ pos, role: ROLE_BY_POSITION[pos], x, y })));
}

// Formations each team can line up in. A spot is a position plus where it sits
// on the lineup board, in percent: x across (0 = left touchline, 100 = right)
// and y down the board (0 = top edge, past halfway; 100 = own goal line).
// Every formation for a format has exactly playersPerTeam spots.
// prettier-ignore
const FORMATIONS = Object.freeze({
  '3v3': Object.freeze({
    '1-2': spots([['CB', 50, 70], ['LF', 27, 30], ['RF', 73, 30]]),
    '2-1': spots([['LCB', 28, 66], ['RCB', 72, 66], ['ST', 50, 26]]),
    '1-1-1': spots([['CB', 50, 74], ['CM', 50, 50], ['ST', 50, 24]]),
    'GK-2': spots([['GK', 50, 88], ['LF', 28, 40], ['RF', 72, 40]]),
  }),
  '8v8': Object.freeze({
    '3-3-1': spots([['GK', 50, 88], ['LB', 18, 67], ['CB', 50, 69], ['RB', 82, 67], ['LM', 18, 44], ['CM', 50, 47], ['RM', 82, 44], ['ST', 50, 18]]),
    '3-2-2': spots([['GK', 50, 88], ['LB', 18, 67], ['CB', 50, 69], ['RB', 82, 67], ['LCM', 33, 46], ['RCM', 67, 46], ['LS', 33, 20], ['RS', 67, 20]]),
    '2-3-2': spots([['GK', 50, 88], ['LCB', 32, 69], ['RCB', 68, 69], ['LM', 15, 46], ['CM', 50, 48], ['RM', 85, 46], ['LS', 33, 20], ['RS', 67, 20]]),
    '3-1-3': spots([['GK', 50, 88], ['LB', 18, 67], ['CB', 50, 69], ['RB', 82, 67], ['CDM', 50, 48], ['LW', 17, 26], ['ST', 50, 17], ['RW', 83, 26]]),
  }),
  '11v11': Object.freeze({
    '4-3-3': spots([['GK', 50, 88], ['LB', 13, 66], ['LCB', 37, 69], ['RCB', 63, 69], ['RB', 87, 66], ['LCM', 27, 45], ['CM', 50, 50], ['RCM', 73, 45], ['LW', 15, 24], ['ST', 50, 15], ['RW', 85, 24]]),
    '4-4-2': spots([['GK', 50, 88], ['LB', 13, 66], ['LCB', 37, 69], ['RCB', 63, 69], ['RB', 87, 66], ['LM', 13, 45], ['LCM', 37, 49], ['RCM', 63, 49], ['RM', 87, 45], ['LS', 36, 19], ['RS', 64, 19]]),
    '4-2-3-1': spots([['GK', 50, 88], ['LB', 13, 66], ['LCB', 37, 69], ['RCB', 63, 69], ['RB', 87, 66], ['LDM', 37, 50], ['RDM', 63, 50], ['LAM', 15, 30], ['CAM', 50, 31], ['RAM', 85, 30], ['ST', 50, 12]]),
    '3-5-2': spots([['GK', 50, 89], ['LCB', 27, 68], ['CB', 50, 70], ['RCB', 73, 68], ['LWB', 12, 42], ['LCM', 31, 47], ['CDM', 50, 51], ['RCM', 69, 47], ['RWB', 88, 42], ['LS', 37, 18], ['RS', 63, 18]]),
  }),
});

const DEFAULT_FORMATIONS = Object.freeze({ '3v3': '1-2', '8v8': '3-3-1', '11v11': '4-3-3' });

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
    databasePath: env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'box2box.db'),
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

module.exports = { FORMATS, FORMATIONS, DEFAULT_FORMATIONS, SKILL_LEVELS, US_STATES, loadSettings };
