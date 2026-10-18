'use strict';

const { loadSettings } = require('../src/config');
const { openDatabase } = require('../src/db');
const { createApp } = require('../src/app');

const HOUR = 60 * 60 * 1000;

// Starts the app on a random port with an in-memory database and a clock the
// test controls.
async function startTestServer(env = {}) {
  const settings = loadSettings({ DATABASE_PATH: ':memory:', ...env });
  const db = openDatabase(':memory:');
  const clock = { now: new Date('2026-06-01T12:00:00.000Z') };
  const app = createApp({ db, settings, clock: () => new Date(clock.now) });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function call(method, path, { token, body } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  let userCount = 0;
  // Signs up a player who is old enough and located where wagers are allowed,
  // with demo money in their wallet.
  async function player(name = `Player ${userCount + 1}`, { depositCents = 10000, profile = {} } = {}) {
    userCount += 1;
    const signup = await call('POST', '/auth/signup', {
      body: { email: `player${userCount}@example.com`, password: 'correct horse', displayName: name },
    });
    if (signup.status !== 201) throw new Error(`signup failed: ${JSON.stringify(signup.body)}`);
    const { token } = signup.body;
    await call('PATCH', '/me', { token, body: { birthDate: '1995-04-12', state: 'CA', ...profile } });
    if (depositCents) await call('POST', '/wallet/deposit', { token, body: { amountCents: depositCents } });
    return { token, id: signup.body.user.id, name };
  }

  async function balance(user) {
    return (await call('GET', '/wallet', { token: user.token })).body.balanceCents;
  }

  function advance(ms) {
    clock.now = new Date(clock.now.getTime() + ms);
  }

  return {
    db,
    settings,
    clock,
    call,
    player,
    balance,
    advance,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function gameInput(overrides = {}) {
  return {
    format: '3v3',
    title: 'Tuesday night 3v3',
    startsAt: '2026-06-02T18:00:00.000Z',
    durationMinutes: 60,
    venueName: 'Riverside Park',
    address: '100 River Rd',
    lat: 41.88,
    lng: -87.63,
    ...overrides,
  };
}

module.exports = { startTestServer, gameInput, HOUR };
