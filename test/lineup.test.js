'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, gameInput } = require('./helpers');
const { FORMATIONS } = require('../src/config');

function spotOf(game, playerId) {
  return [...game.teams.A, ...game.teams.B].find((p) => p.id === playerId);
}

test('every formation has one spot per player on the team', () => {
  const perTeam = { '3v3': 3, '8v8': 8, '11v11': 11 };
  for (const [format, formations] of Object.entries(FORMATIONS)) {
    for (const [name, spots] of Object.entries(formations)) {
      assert.equal(spots.length, perTeam[format], `${format} ${name}`);
      for (const spot of spots) assert.ok(spot.role, `${format} ${name} ${spot.pos} has a role`);
    }
  }
});

test('players join a chosen spot, or the open spot that fits their position', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const host = await s.player('Host', { profile: { position: 'Forward' } });
  const created = await s.call('POST', '/games', { token: host.token, body: gameInput({ format: '11v11' }) });
  let game = created.body.game;
  assert.deepEqual(game.formations, { A: '4-3-3', B: '4-3-3' });
  assert.match(spotOf(game, host.id).pos, /^(LW|ST|RW)$/, 'a forward is placed up front');

  const keeper = await s.player('Keeper', { profile: { position: 'Goalkeeper' } });
  game = (await s.call('POST', `/games/${game.id}/join`, { token: keeper.token, body: { team: 'A' } })).body.game;
  assert.equal(spotOf(game, keeper.id).pos, 'GK');

  // Picking a specific spot (index 9 is ST in 4-3-3).
  const striker = await s.player('Striker');
  game = (await s.call('POST', `/games/${game.id}/join`, { token: striker.token, body: { team: 'B', slot: 9 } })).body
    .game;
  assert.equal(spotOf(game, striker.id).pos, 'ST');

  const clash = await s.player('Clash');
  const taken = await s.call('POST', `/games/${game.id}/join`, { token: clash.token, body: { team: 'B', slot: 9 } });
  assert.equal(taken.status, 409);
  assert.match(taken.body.error, /ST spot is already taken/);
  const noTeam = await s.call('POST', `/games/${game.id}/join`, { token: clash.token, body: { slot: 3 } });
  assert.equal(noTeam.status, 400);
});

test('players move into open spots; captains can swap and change formation', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const captain = await s.player('Captain');
  const mate = await s.player('Mate');
  const rival = await s.player('Rival');
  let { game } = (await s.call('POST', '/games', { token: captain.token, body: gameInput({ format: '8v8' }) })).body;
  await s.call('POST', `/games/${game.id}/join`, { token: mate.token, body: { team: 'A', slot: 7 } });
  await s.call('POST', `/games/${game.id}/join`, { token: rival.token, body: { team: 'B' } });
  const move = (who, body) => s.call('POST', `/games/${game.id}/lineup/move`, { token: who.token, body });

  // A player moves themselves into an open spot (index 0 is GK).
  game = (await move(mate, { slot: 0 })).body.game;
  assert.equal(spotOf(game, mate.id).pos, 'GK');

  // Non-captains can't take an occupied spot or move teammates.
  const captainSlot = spotOf(game, captain.id).slot;
  assert.equal((await move(mate, { slot: captainSlot })).status, 409);
  assert.equal((await move(mate, { playerId: captain.id, slot: 5 })).status, 409);
  // Nobody can move players on the other team.
  assert.equal((await move(captain, { playerId: rival.id, slot: 5 })).status, 409);

  // The captain swaps themselves with the keeper.
  game = (await move(captain, { slot: 0 })).body.game;
  assert.equal(spotOf(game, captain.id).pos, 'GK');
  assert.equal(spotOf(game, mate.id).slot, captainSlot);

  // Formation changes are captain-only and must fit the format.
  const formation = (who, body) => s.call('POST', `/games/${game.id}/lineup/formation`, { token: who.token, body });
  assert.equal((await formation(mate, { team: 'A', formation: '2-3-2' })).status, 409);
  assert.equal((await formation(captain, { team: 'B', formation: '2-3-2' })).status, 409);
  assert.equal((await formation(captain, { team: 'A', formation: '4-4-2' })).status, 400);
  assert.equal((await formation(captain, { team: 'A', formation: 'constructor' })).status, 400);
  game = (await formation(captain, { team: 'A', formation: '2-3-2' })).body.game;
  assert.equal(game.formations.A, '2-3-2');
  assert.equal(spotOf(game, mate.id).pos, FORMATIONS['8v8']['2-3-2'][spotOf(game, mate.id).slot].pos);

  // Viewer flags drive the lineup controls.
  const view = (await s.call('GET', `/games/${game.id}`, { token: captain.token })).body.game.viewer;
  assert.equal(view.canEditLineup, true);
  assert.equal(view.canSetFormation, true);
  const mateView = (await s.call('GET', `/games/${game.id}`, { token: mate.token })).body.game.viewer;
  assert.equal(mateView.canSetFormation, false);

  // The lineup locks once a result is reported.
  s.clock.now = new Date('2026-06-02T19:05:00.000Z');
  await s.call('POST', `/games/${game.id}/result`, { token: captain.token, body: { scoreA: 1, scoreB: 0 } });
  assert.equal((await move(mate, { slot: 6 })).status, 409);
});

test('players without a saved spot are given one when the game is read', async (t) => {
  const s = await startTestServer();
  t.after(s.close);
  const host = await s.player('Host');
  const other = await s.player('Other');
  const { game } = (await s.call('POST', '/games', { token: host.token, body: gameInput() })).body;
  await s.call('POST', `/games/${game.id}/join`, { token: other.token, body: { team: 'A' } });
  // Simulate rows from before lineups existed.
  s.db.prepare('UPDATE game_players SET slot = NULL WHERE game_id = ?').run(game.id);
  const read = (await s.call('GET', `/games/${game.id}`)).body.game;
  assert.deepEqual(read.teams.A.map((p) => p.slot).sort(), [0, 1]);
});
