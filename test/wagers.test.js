'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, gameInput, HOUR } = require('./helpers');
const { computePayout } = require('../src/services/wagers');
const ledger = require('../src/services/ledger');

const FEE = 1000; // $10 entry

// Creates a full $10 3v3 wager match: host + 2 on team A, 3 on team B.
async function fullWagerMatch(s, env) {
  const host = await s.player('Host');
  const { game } = (
    await s.call('POST', '/games', { token: host.token, body: gameInput({ isWager: true, entryFeeCents: FEE, ...env }) })
  ).body;
  const teamA = [host, await s.player(), await s.player()];
  const teamB = [await s.player(), await s.player(), await s.player()];
  for (const p of teamA.slice(1)) await s.call('POST', `/games/${game.id}/join`, { token: p.token, body: { team: 'A' } });
  for (const p of teamB) await s.call('POST', `/games/${game.id}/join`, { token: p.token, body: { team: 'B' } });
  return { game, host, teamA, teamB };
}

function kickoffPlusOneHour(s) {
  s.clock.now = new Date('2026-06-02T19:05:00.000Z');
}

test('payout math accounts for every cent', () => {
  assert.deepEqual(computePayout({ potCents: 6000, winnerCount: 3, platformFeePercent: 10 }), {
    potCents: 6000,
    prizePoolCents: 5400,
    perWinnerCents: 1800,
    platformCents: 600,
  });
  const odd = computePayout({ potCents: 1000, winnerCount: 3, platformFeePercent: 0 });
  assert.equal(odd.perWinnerCents, 333);
  assert.equal(odd.perWinnerCents * 3 + odd.platformCents, 1000);
});

test('entry fees go into escrow and the winning team splits the prize once the other captain confirms', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const { game, teamA, teamB } = await fullWagerMatch(s);

  for (const p of [...teamA, ...teamB]) assert.equal(await s.balance(p), 10000 - FEE);
  assert.equal(ledger.escrowHeldCents(s.db, game.id), 6 * FEE);

  const detail = (await s.call('GET', `/games/${game.id}`, { token: teamA[0].token })).body.game;
  assert.deepEqual(detail.wager, {
    entryFeeCents: 1000,
    platformFeePercent: 10,
    potCents: 6000,
    prizePoolCents: 5400,
    perWinnerCents: 1800,
  });
  assert.equal(detail.viewer.isCaptain, true);

  // Can't leave or cancel after kickoff.
  kickoffPlusOneHour(s);
  assert.equal((await s.call('POST', `/games/${game.id}/leave`, { token: teamB[2].token })).status, 409);
  assert.equal((await s.call('POST', `/games/${game.id}/cancel`, { token: teamA[0].token })).status, 409);

  // Only captains may report; a non-captain is refused.
  const nonCaptain = await s.call('POST', `/games/${game.id}/result`, { token: teamA[1].token, body: { scoreA: 4, scoreB: 2 } });
  assert.equal(nonCaptain.status, 409);

  const reported = await s.call('POST', `/games/${game.id}/result`, { token: teamA[0].token, body: { scoreA: 4, scoreB: 2 } });
  assert.equal(reported.body.game.result.status, 'pending');
  assert.equal(await s.balance(teamA[0]), 10000 - FEE, 'nothing is paid until confirmed');

  // The reporting captain can't confirm their own result, and neither can a non-captain on the other team.
  assert.equal((await s.call('POST', `/games/${game.id}/result/confirm`, { token: teamA[0].token })).status, 409);
  assert.equal((await s.call('POST', `/games/${game.id}/result/confirm`, { token: teamB[1].token })).status, 409);

  const confirmed = await s.call('POST', `/games/${game.id}/result/confirm`, { token: teamB[0].token });
  assert.equal(confirmed.body.game.status, 'completed');

  for (const p of teamA) assert.equal(await s.balance(p), 10000 - FEE + 1800);
  for (const p of teamB) assert.equal(await s.balance(p), 10000 - FEE);
  assert.equal(ledger.escrowHeldCents(s.db, game.id), 0);
  const platform = s.db.prepare("SELECT SUM(amount_cents) AS c FROM transactions WHERE type = 'platform_fee'").get();
  assert.equal(platform.c, 600);

  const stats = (await s.call('GET', '/me', { token: teamA[1].token })).body.user.stats;
  assert.equal(stats.wagerWins, 1);
  assert.equal(stats.winningsCents, 1800);
});

test('a drawn wager match refunds everyone in full', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const { game, teamA, teamB } = await fullWagerMatch(s);
  kickoffPlusOneHour(s);
  await s.call('POST', `/games/${game.id}/result`, { token: teamB[0].token, body: { scoreA: 2, scoreB: 2 } });
  await s.call('POST', `/games/${game.id}/result/confirm`, { token: teamA[0].token });
  for (const p of [...teamA, ...teamB]) assert.equal(await s.balance(p), 10000);
  assert.equal(ledger.escrowHeldCents(s.db, game.id), 0);
});

test('disputed results go to an admin, who can settle or void them', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const { game, teamA, teamB } = await fullWagerMatch(s);
  kickoffPlusOneHour(s);
  await s.call('POST', `/games/${game.id}/result`, { token: teamA[0].token, body: { scoreA: 3, scoreB: 1 } });
  const disputed = await s.call('POST', `/games/${game.id}/result/dispute`, {
    token: teamB[0].token,
    body: { reason: 'We won 3-2, they are lying' },
  });
  assert.equal(disputed.body.game.result.status, 'disputed');

  // Disputed results don't auto-confirm.
  s.advance(48 * HOUR);
  const { runMaintenance } = require('../src/services/games');
  runMaintenance(s.db, { now: s.clock.now, settings: s.settings });
  assert.equal(await s.balance(teamA[0]), 10000 - FEE);

  // Regular players can't use the admin endpoints.
  assert.equal((await s.call('GET', '/admin/disputes', { token: teamA[0].token })).status, 403);

  const admin = await s.player('Admin', { depositCents: 0 });
  s.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(admin.id);
  const queue = await s.call('GET', '/admin/disputes', { token: admin.token });
  assert.deepEqual(queue.body.games.map((g) => g.id), [game.id]);

  await s.call('POST', `/admin/games/${game.id}/resolve`, { token: admin.token, body: { scoreA: 2, scoreB: 3 } });
  for (const p of teamB) assert.equal(await s.balance(p), 10000 - FEE + 1800);
  for (const p of teamA) assert.equal(await s.balance(p), 10000 - FEE);
});

test('admin can void a disputed match and refund everyone', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const { game, teamA, teamB } = await fullWagerMatch(s);
  kickoffPlusOneHour(s);
  await s.call('POST', `/games/${game.id}/result`, { token: teamA[0].token, body: { scoreA: 3, scoreB: 1 } });
  await s.call('POST', `/games/${game.id}/result/dispute`, { token: teamB[0].token, body: { reason: 'Never played' } });
  const admin = await s.player('Admin', { depositCents: 0 });
  s.db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(admin.id);
  const res = await s.call('POST', `/admin/games/${game.id}/resolve`, { token: admin.token, body: { refund: true } });
  assert.equal(res.body.game.status, 'cancelled');
  for (const p of [...teamA, ...teamB]) assert.equal(await s.balance(p), 10000);
});

test('an unanswered result is confirmed automatically after the result window', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const { runMaintenance } = require('../src/services/games');
  const { game, teamA } = await fullWagerMatch(s);
  kickoffPlusOneHour(s);
  await s.call('POST', `/games/${game.id}/result`, { token: teamA[0].token, body: { scoreA: 1, scoreB: 0 } });

  s.advance(23 * HOUR);
  assert.equal(runMaintenance(s.db, { now: s.clock.now, settings: s.settings }), 0);
  s.advance(2 * HOUR);
  assert.equal(runMaintenance(s.db, { now: s.clock.now, settings: s.settings }), 1);
  assert.equal(await s.balance(teamA[0]), 10000 - FEE + 1800);
});

test('wager matches that are not full at kickoff are cancelled and refunded', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const { runMaintenance } = require('../src/services/games');
  const host = await s.player();
  const guest = await s.player();
  const { game } = (
    await s.call('POST', '/games', { token: host.token, body: gameInput({ isWager: true, entryFeeCents: FEE }) })
  ).body;
  await s.call('POST', `/games/${game.id}/join`, { token: guest.token });
  assert.equal(await s.balance(guest), 10000 - FEE);

  // Leaving before kickoff refunds immediately.
  await s.call('POST', `/games/${game.id}/leave`, { token: guest.token });
  assert.equal(await s.balance(guest), 10000);
  await s.call('POST', `/games/${game.id}/join`, { token: guest.token });

  s.clock.now = new Date('2026-06-02T18:00:30.000Z');
  assert.equal((await s.call('POST', `/games/${game.id}/join`, { token: (await s.player()).token })).status, 409);
  runMaintenance(s.db, { now: s.clock.now, settings: s.settings });
  const after = (await s.call('GET', `/games/${game.id}`)).body.game;
  assert.equal(after.status, 'cancelled');
  assert.match(after.cancelReason, /not full/);
  assert.equal(await s.balance(host), 10000);
  assert.equal(await s.balance(guest), 10000);
});

test('full wager matches with no reported result are refunded after the result window', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const { runMaintenance } = require('../src/services/games');
  const { game, teamA, teamB } = await fullWagerMatch(s);
  kickoffPlusOneHour(s);
  assert.equal(runMaintenance(s.db, { now: s.clock.now, settings: s.settings }), 0);
  s.advance(24 * HOUR);
  assert.equal(runMaintenance(s.db, { now: s.clock.now, settings: s.settings }), 1);
  assert.equal((await s.call('GET', `/games/${game.id}`)).body.game.status, 'cancelled');
  for (const p of [...teamA, ...teamB]) assert.equal(await s.balance(p), 10000);
});

test('wager eligibility: age, profile, state, and balance', async (t) => {
  const s = await startTestServer({ WAGER_BLOCKED_STATES: 'WA, ut' });
  t.after(s.close);
  const host = await s.player();
  const { game } = (
    await s.call('POST', '/games', { token: host.token, body: gameInput({ isWager: true, entryFeeCents: FEE }) })
  ).body;

  const cases = [
    [{ birthDate: '2010-01-01' }, 10000, /18 or older/],
    [{ birthDate: null }, 10000, /date of birth/],
    [{ state: null }, 10000, /state/],
    [{ state: 'WA' }, 10000, /not available in your state/],
    [{ state: 'UT' }, 10000, /not available in your state/],
    [{}, 500, /Add funds/],
  ];
  for (const [profile, depositCents, message] of cases) {
    const p = await s.player(undefined, { profile, depositCents });
    const res = await s.call('POST', `/games/${game.id}/join`, { token: p.token });
    assert.equal(res.status, 409, JSON.stringify(profile));
    assert.match(res.body.error, message);
    const view = (await s.call('GET', `/games/${game.id}`, { token: p.token })).body.game.viewer;
    assert.match(view.joinBlockedReason, message);
  }

  // Under-age players can't host wager matches either.
  const teen = await s.player(undefined, { profile: { birthDate: '2010-01-01' } });
  const hosted = await s.call('POST', '/games', { token: teen.token, body: gameInput({ isWager: true, entryFeeCents: FEE }) });
  assert.equal(hosted.status, 409);

  // Entry fee limits.
  const tooBig = await s.call('POST', '/games', { token: host.token, body: gameInput({ isWager: true, entryFeeCents: 1000000 }) });
  assert.equal(tooBig.status, 400);
});

test('wager matches can be switched off entirely', async (t) => {
  const s = await startTestServer({ WAGERS_ENABLED: 'false' });
  t.after(s.close);
  const host = await s.player();
  const res = await s.call('POST', '/games', { token: host.token, body: gameInput({ isWager: true, entryFeeCents: FEE }) });
  assert.equal(res.status, 409);
});

test('withdrawals cannot exceed the wallet balance', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const p = await s.player(undefined, { depositCents: 2000 });
  assert.equal((await s.call('POST', '/wallet/withdraw', { token: p.token, body: { amountCents: 2500 } })).status, 409);
  const ok = await s.call('POST', '/wallet/withdraw', { token: p.token, body: { amountCents: 1500 } });
  assert.equal(ok.body.balanceCents, 500);
  assert.deepEqual(
    ok.body.transactions.map((t) => t.type),
    ['withdrawal', 'deposit'],
  );
});
