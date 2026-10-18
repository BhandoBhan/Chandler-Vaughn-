'use strict';

// Fills the database with demo players and games around a location.
//
//   npm run seed                                  # around the default location
//   npm run seed -- --lat 39.95 --lng -75.16      # around your own area
//   npm run seed -- --reset                       # wipe existing data first
//
// Every demo account's password is "password123".

const fs = require('node:fs');
const { parseArgs } = require('node:util');
const { loadSettings } = require('./config');
const { openDatabase } = require('./db');
const { hashPassword } = require('./auth');
const games = require('./services/games');
const ledger = require('./services/ledger');

const { values: args } = parseArgs({
  options: {
    lat: { type: 'string', default: process.env.SEED_LAT || '41.8781' },
    lng: { type: 'string', default: process.env.SEED_LNG || '-87.6298' },
    state: { type: 'string', default: process.env.SEED_STATE || 'IL' },
    reset: { type: 'boolean', default: false },
  },
});

const center = { lat: Number(args.lat), lng: Number(args.lng) };
if (!Number.isFinite(center.lat) || !Number.isFinite(center.lng)) {
  console.error('--lat and --lng must be numbers');
  process.exit(1);
}

const PLAYERS = [
  ['Admin', 'admin'],
  ['Alex Rivera', 'alex'],
  ['Jordan Lee', 'jordan'],
  ['Sam Okafor', 'sam'],
  ['Taylor Brooks', 'taylor'],
  ['Chris Moreno', 'chris'],
  ['Pat Nguyen', 'pat'],
  ['Jamie Fischer', 'jamie'],
  ['Morgan Diaz', 'morgan'],
  ['Riley Chen', 'riley'],
  ['Casey Novak', 'casey'],
  ['Drew Santos', 'drew'],
  ['Avery Kim', 'avery'],
  ['Quinn Patel', 'quinn'],
  ['Reese Walker', 'reese'],
  ['Jesse Romero', 'jesse'],
  ['Skyler Adams', 'skyler'],
  ['Rowan Ibarra', 'rowan'],
];
const POSITIONS = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
const SKILLS = ['beginner', 'intermediate', 'advanced'];

// Each game is `day` days from today at `hour` local time; offsets are miles
// north / east of the center.
const GAMES = [
  { title: 'Late-night 3v3 in the box', format: '3v3', day: 0, hour: 21, venue: 'Riverside Park — Field 2', north: 0.8, east: -0.6, players: 2, skill: 'any' },
  { title: 'Lunchtime 3v3', format: '3v3', day: 1, hour: 12, venue: 'Lincoln Athletic Complex', north: -1.4, east: -1.1, players: 4, skill: 'intermediate' },
  { title: '$10 Box Battle', format: '3v3', day: 2, hour: 19, venue: 'Oak Hill Community Fields', north: 2.3, east: -1.9, players: 5, wager: 1000, skill: 'advanced' },
  { title: 'Half-field 8v8 run', format: '8v8', day: 3, hour: 10, venue: 'Westside Sports Park', north: -0.5, east: -2.8, players: 11, skill: 'any' },
  { title: '8v8 Money Match — $20', format: '8v8', day: 4, hour: 18, venue: 'Memorial Stadium Turf', north: 3.6, east: -3.2, players: 9, wager: 2000, skill: 'intermediate' },
  { title: 'Full-field 11v11', format: '11v11', day: 5, hour: 9, venue: 'Lakeview Regional Park', north: -4.2, east: -2.4, players: 14, skill: 'any' },
  { title: '11v11 Fiver — $5 a head', format: '11v11', day: 6, hour: 16, venue: 'Lakeview Regional Park', north: -4.2, east: -2.4, players: 6, wager: 500, skill: 'any' },
];

// Local start time for a demo game, pushed a day later if it would start
// within the next hour.
function startTime(now, { day, hour }) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day, hour);
  if (start.getTime() < now.getTime() + 60 * 60 * 1000) start.setDate(start.getDate() + 1);
  return start;
}

function offset({ north, east }) {
  return {
    lat: center.lat + north / 69,
    lng: center.lng + east / (69 * Math.cos((center.lat * Math.PI) / 180)),
  };
}

async function main() {
  const settings = loadSettings();
  if (args.reset && fs.existsSync(settings.databasePath)) {
    for (const suffix of ['', '-wal', '-shm']) fs.rmSync(settings.databasePath + suffix, { force: true });
  }
  const db = openDatabase(settings.databasePath);
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
    console.error('The database already has data. Run with --reset to replace it with demo data.');
    process.exit(1);
  }

  const now = new Date();
  const passwordHash = await hashPassword('password123');
  const users = PLAYERS.map(([name, handle], i) => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO users (email, password_hash, display_name, birth_date, state, skill_level, position,
           home_lat, home_lng, is_admin, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `${handle}@example.com`,
        passwordHash,
        name,
        `${1985 + (i % 18)}-0${1 + (i % 9)}-1${i % 10}`,
        args.state.toUpperCase(),
        SKILLS[i % SKILLS.length],
        POSITIONS[i % POSITIONS.length],
        center.lat,
        center.lng,
        handle === 'admin' ? 1 : 0,
        now.toISOString(),
      );
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
    ledger.record(db, { userId: user.id, type: 'deposit', amountCents: 10000, memo: 'Deposit (demo money)', now });
    return user;
  });
  const players = users.slice(1);

  GAMES.forEach((g, gameIndex) => {
    const roster = players.map((_, i) => players[(i + gameIndex * 3) % players.length]).slice(0, g.players);
    const id = games.createGame(
      db,
      roster[0],
      {
        title: g.title,
        format: g.format,
        skillLevel: g.skill,
        startsAt: startTime(now, g),
        durationMinutes: g.format === '3v3' ? 60 : 90,
        venueName: g.venue,
        address: null,
        ...offset(g),
        notes: g.wager
          ? 'Bring a light and a dark shirt. Captains report the score right after the final whistle.'
          : 'All levels welcome. Bring water and shin guards.',
        isWager: Boolean(g.wager),
        entryFeeCents: g.wager || 0,
        joinAsPlayer: true,
      },
      { now, settings },
    );
    for (const player of roster.slice(1)) games.joinGame(db, id, player, {}, { now, settings });
  });

  console.log(`Seeded ${users.length} players and ${GAMES.length} games around ${center.lat}, ${center.lng}.`);
  console.log('Log in as alex@example.com (or admin@example.com) with password "password123".');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
