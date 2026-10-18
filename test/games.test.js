'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, gameInput } = require('./helpers');

test('casual games: create, find nearby, join teams, fill up, report score', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const host = await s.player('Host');

  const created = await s.call('POST', '/games', { token: host.token, body: gameInput() });
  assert.equal(created.status, 201);
  const game = created.body.game;
  assert.equal(game.format, '3v3');
  assert.equal(game.area, '18-yard box');
  assert.equal(game.capacity, 6);
  assert.equal(game.isWager, false);
  assert.equal(game.teams.A[0].displayName, 'Host', 'organizer joins team A by default');
  assert.equal(game.teams.A[0].isCaptain, true);

  // Search: nearby finds it, far away does not, format filter works.
  const near = await s.call('GET', '/games?lat=41.9&lng=-87.65&radiusMiles=10');
  assert.equal(near.body.games.length, 1);
  assert.ok(near.body.games[0].distanceMiles < 10);
  const far = await s.call('GET', '/games?lat=34.05&lng=-118.24&radiusMiles=25');
  assert.equal(far.body.games.length, 0);
  assert.equal((await s.call('GET', '/games?format=11v11')).body.games.length, 0);
  assert.equal((await s.call('GET', '/games?format=3v3&type=casual')).body.games.length, 1);

  // Players are balanced onto the smaller team unless they pick one.
  const others = [];
  for (let i = 0; i < 6; i += 1) others.push(await s.player());
  const join = (p, team) => s.call('POST', `/games/${game.id}/join`, { token: p.token, body: team ? { team } : undefined });
  assert.equal((await join(others[0])).body.game.viewer.team, 'B');
  assert.equal((await join(others[1], 'A')).body.game.viewer.team, 'A');
  assert.equal((await join(others[2], 'A')).body.game.viewer.team, 'A');
  const teamAFull = await join(others[3], 'A');
  assert.equal(teamAFull.status, 409);
  assert.match(teamAFull.body.error, /Team A is full/);
  assert.equal((await join(others[3])).body.game.viewer.team, 'B');
  await join(others[4]);

  const full = await join(others[5]);
  assert.equal(full.status, 409);
  assert.match(full.body.error, /full/);
  assert.equal((await join(host)).status, 409);

  // Leaving frees the spot.
  await s.call('POST', `/games/${game.id}/leave`, { token: others[4].token });
  assert.equal((await join(others[5])).status, 200);

  // Scores can't be reported before kickoff; afterwards a casual score is final.
  const early = await s.call('POST', `/games/${game.id}/result`, { token: host.token, body: { scoreA: 5, scoreB: 3 } });
  assert.equal(early.status, 409);
  s.clock.now = new Date('2026-06-02T19:05:00.000Z');
  const reported = await s.call('POST', `/games/${game.id}/result`, {
    token: others[0].token,
    body: { scoreA: 5, scoreB: 3 },
  });
  assert.equal(reported.status, 200);
  assert.equal(reported.body.game.status, 'completed');
  assert.equal(reported.body.game.result.winner, 'A');

  const me = await s.call('GET', '/me', { token: host.token });
  assert.equal(me.body.user.stats.gamesPlayed, 1);
  assert.equal(me.body.user.stats.wins, 1);
});

test('formats set team sizes and game creation is validated', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const host = await s.player();

  const eight = await s.call('POST', '/games', { token: host.token, body: gameInput({ format: '8v8' }) });
  assert.equal(eight.body.game.capacity, 16);
  assert.equal(eight.body.game.area, 'Half field');
  const eleven = await s.call('POST', '/games', { token: host.token, body: gameInput({ format: '11v11' }) });
  assert.equal(eleven.body.game.capacity, 22);
  assert.equal(eleven.body.game.area, 'Full field');

  const bad = [
    gameInput({ format: '5v5' }),
    gameInput({ startsAt: '2026-05-01T18:00:00.000Z' }),
    gameInput({ lat: 200 }),
    gameInput({ venueName: '' }),
    gameInput({ durationMinutes: 5 }),
  ];
  for (const body of bad) {
    const res = await s.call('POST', '/games', { token: host.token, body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }

  const anonymous = await s.call('POST', '/games', { body: gameInput() });
  assert.equal(anonymous.status, 401);
});

test('organizer can cancel; other players cannot', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const host = await s.player();
  const other = await s.player();
  const { game } = (await s.call('POST', '/games', { token: host.token, body: gameInput() })).body;

  assert.equal((await s.call('POST', `/games/${game.id}/cancel`, { token: other.token })).status, 409);
  const cancelled = await s.call('POST', `/games/${game.id}/cancel`, { token: host.token });
  assert.equal(cancelled.body.game.status, 'cancelled');
  assert.equal((await s.call('GET', '/games')).body.games.length, 0);
});

test('accounts: signup, login, duplicate email, logout', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const body = { email: 'Sam@Example.com', password: 'longenough', displayName: 'Sam' };
  assert.equal((await s.call('POST', '/auth/signup', { body })).status, 201);
  assert.equal((await s.call('POST', '/auth/signup', { body })).status, 409);
  assert.equal((await s.call('POST', '/auth/signup', { body: { ...body, email: 'x@y.co', password: 'short' } })).status, 400);

  const wrong = await s.call('POST', '/auth/login', { body: { email: 'sam@example.com', password: 'nope' } });
  assert.equal(wrong.status, 401);
  const login = await s.call('POST', '/auth/login', { body: { email: 'sam@example.com', password: 'longenough' } });
  assert.equal(login.status, 200);
  const { token } = login.body;
  assert.equal((await s.call('GET', '/me', { token })).body.user.displayName, 'Sam');
  await s.call('POST', '/auth/logout', { token });
  assert.equal((await s.call('GET', '/me', { token })).status, 401);
});
