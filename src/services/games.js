'use strict';

const { FORMATS } = require('../config');
const { transaction } = require('../db');
const { distanceMiles } = require('../geo');
const { HttpError, assertAllowed } = require('../http-error');
const ledger = require('./ledger');
const { computePayout, wagerEligibility } = require('./wagers');

const HOUR_MS = 60 * 60 * 1000;
// Games stay in search results while they are being played. The longest game
// allowed is 3 hours, so anything that started earlier than this is over.
const LIVE_LOOKBACK_MS = 4 * HOUR_MS;

const GAME_SELECT = `SELECT g.*, u.display_name AS organizer_name FROM games g JOIN users u ON u.id = g.organizer_id`;

function dollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Reading games

function getGame(db, id) {
  return db.prepare(`${GAME_SELECT} WHERE g.id = ?`).get(id);
}

function requireGame(db, id) {
  const game = getGame(db, id);
  if (!game) throw new HttpError(404, 'Game not found');
  return game;
}

// Players in join order. The first player on each team is that team's captain.
function getRoster(db, gameId) {
  return db
    .prepare(
      `SELECT gp.user_id, gp.team, gp.joined_at, u.display_name, u.skill_level, u.position
       FROM game_players gp JOIN users u ON u.id = gp.user_id
       WHERE gp.game_id = ? ORDER BY gp.joined_at, gp.rowid`,
    )
    .all(gameId);
}

function startOf(game) {
  return Date.parse(game.starts_at);
}

function endOf(game) {
  return startOf(game) + game.duration_minutes * 60 * 1000;
}

// upcoming → live → finished (played, waiting on a result) → completed, or cancelled.
function phaseOf(game, now) {
  if (game.status === 'cancelled') return 'cancelled';
  if (game.status === 'completed') return 'completed';
  if (now.getTime() < startOf(game)) return 'upcoming';
  if (now.getTime() < endOf(game)) return 'live';
  return 'finished';
}

function teamOf(roster, userId) {
  const player = roster.find((p) => p.user_id === userId);
  return player ? player.team : null;
}

function captainsOf(roster) {
  const captains = { A: null, B: null };
  for (const player of roster) {
    if (captains[player.team] === null) captains[player.team] = player.user_id;
  }
  return captains;
}

function teamCounts(roster) {
  const counts = { A: 0, B: 0 };
  for (const player of roster) counts[player.team] += 1;
  return counts;
}

function isFull(game, roster) {
  const perTeam = FORMATS[game.format].playersPerTeam;
  const counts = teamCounts(roster);
  return counts.A >= perTeam && counts.B >= perTeam;
}

// ---------------------------------------------------------------------------
// Rules. Each returns the reason an action is not allowed, or null if it is.
// The same checks drive both the API and the buttons the app shows.

function joinBlocker({ db, game, roster, user, now, settings }, team = null) {
  if (game.status !== 'scheduled' || game.result_status !== 'none') return 'This game is no longer taking players';
  if (teamOf(roster, user.id)) return "You're already in this game";
  if (game.is_wager && now.getTime() >= startOf(game)) return 'Wager matches close at kickoff';
  if (now.getTime() >= endOf(game)) return 'This game has already finished';
  if (isFull(game, roster)) return 'This game is full';
  if (team && teamCounts(roster)[team] >= FORMATS[game.format].playersPerTeam) return `Team ${team} is full`;
  if (game.is_wager) {
    const ineligible = wagerEligibility(user, settings, now);
    if (ineligible) return ineligible;
    if (ledger.balanceCents(db, user.id) < game.entry_fee_cents) {
      return `Add funds to your wallet to cover the ${dollars(game.entry_fee_cents)} entry fee`;
    }
  }
  return null;
}

function leaveBlocker({ game, roster, user, now }) {
  if (!teamOf(roster, user.id)) return "You're not in this game";
  if (game.status !== 'scheduled' || game.result_status !== 'none') return 'This game is closed';
  if (game.is_wager && now.getTime() >= startOf(game)) return "You can't leave a wager match after kickoff";
  return null;
}

function cancelBlocker({ game, user, now }) {
  if (game.organizer_id !== user.id && !user.is_admin) return 'Only the organizer can cancel this game';
  if (game.status !== 'scheduled') return 'This game is already closed';
  if (user.is_admin) return null;
  if (game.result_status !== 'none') return 'A result has already been reported';
  if (game.is_wager && now.getTime() >= startOf(game)) return "Wager matches can't be cancelled after kickoff";
  return null;
}

function reportBlocker({ game, roster, user, now }) {
  if (game.status !== 'scheduled') return 'This game is closed';
  if (game.result_status !== 'none') return 'A result has already been reported';
  if (now.getTime() < startOf(game)) return 'You can report the score once the game kicks off';
  if (game.is_wager) {
    const captains = captainsOf(roster);
    if (captains.A !== user.id && captains.B !== user.id) return 'Only team captains can report a wager match result';
    if (!isFull(game, roster)) return 'Both teams must be full to settle a wager match';
  } else if (game.organizer_id !== user.id && !teamOf(roster, user.id)) {
    return 'Only the organizer or players can report the score';
  }
  return null;
}

// Confirming and disputing are both the other captain's call.
function confirmBlocker({ game, roster, user }) {
  if (game.status !== 'scheduled' || game.result_status !== 'pending') {
    return 'There is no result waiting for confirmation';
  }
  const otherTeam = teamOf(roster, game.reported_by) === 'A' ? 'B' : 'A';
  if (captainsOf(roster)[otherTeam] !== user.id) {
    return `Only the Team ${otherTeam} captain can confirm or dispute this result`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shaping games for the API

function wagerSummary(game) {
  const perTeam = FORMATS[game.format].playersPerTeam;
  const payout = computePayout({
    potCents: game.entry_fee_cents * perTeam * 2,
    winnerCount: perTeam,
    platformFeePercent: game.platform_fee_percent,
  });
  return {
    entryFeeCents: game.entry_fee_cents,
    platformFeePercent: game.platform_fee_percent,
    potCents: payout.potCents,
    prizePoolCents: payout.prizePoolCents,
    perWinnerCents: payout.perWinnerCents,
  };
}

function resultSummary(db, game, settings) {
  if (game.result_status === 'none') return null;
  const reporter = game.reported_by
    ? db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(game.reported_by)
    : null;
  const autoConfirmAt =
    game.result_status === 'pending'
      ? new Date(Date.parse(game.reported_at) + settings.wagers.resultWindowHours * HOUR_MS).toISOString()
      : null;
  return {
    status: game.result_status,
    scoreA: game.score_a,
    scoreB: game.score_b,
    winner: game.winner,
    reportedBy: reporter ? { id: reporter.id, displayName: reporter.display_name } : null,
    reportedAt: game.reported_at,
    autoConfirmAt,
    disputeReason: game.dispute_reason,
  };
}

function viewerState(ctx) {
  const { game, roster, user } = ctx;
  const team = teamOf(roster, user.id);
  const captains = captainsOf(roster);
  return {
    joined: Boolean(team),
    team,
    isOrganizer: game.organizer_id === user.id,
    isCaptain: Boolean(team) && captains[team] === user.id,
    joinBlockedReason: team ? null : joinBlocker(ctx),
    canJoinTeam: { A: !joinBlocker(ctx, 'A'), B: !joinBlocker(ctx, 'B') },
    canLeave: !leaveBlocker(ctx),
    canCancel: !cancelBlocker(ctx),
    canReport: !reportBlocker(ctx),
    canConfirm: !confirmBlocker(ctx),
  };
}

function serializeGame(db, game, roster, { now, settings, user = null, distance = null }) {
  const format = FORMATS[game.format];
  const captains = captainsOf(roster);
  const teams = { A: [], B: [] };
  for (const player of roster) {
    teams[player.team].push({
      id: player.user_id,
      displayName: player.display_name,
      skillLevel: player.skill_level,
      position: player.position,
      isCaptain: captains[player.team] === player.user_id,
    });
  }
  const capacity = format.playersPerTeam * 2;
  const out = {
    id: game.id,
    title: game.title,
    format: format.id,
    area: format.area,
    playersPerTeam: format.playersPerTeam,
    capacity,
    playerCount: roster.length,
    spotsLeft: capacity - roster.length,
    teams,
    skillLevel: game.skill_level,
    startsAt: game.starts_at,
    endsAt: new Date(endOf(game)).toISOString(),
    durationMinutes: game.duration_minutes,
    venueName: game.venue_name,
    address: game.address,
    lat: game.lat,
    lng: game.lng,
    notes: game.notes,
    status: game.status,
    phase: phaseOf(game, now),
    cancelReason: game.cancel_reason,
    organizer: { id: game.organizer_id, displayName: game.organizer_name },
    isWager: Boolean(game.is_wager),
    wager: game.is_wager ? wagerSummary(game) : null,
    result: resultSummary(db, game, settings),
    distanceMiles: distance === null ? null : Math.round(distance * 10) / 10,
  };
  if (user) out.viewer = viewerState({ db, game, roster, user, now, settings });
  return out;
}

function gameDetail(db, gameId, { now, settings, user }) {
  const game = requireGame(db, gameId);
  return serializeGame(db, game, getRoster(db, gameId), { now, settings, user });
}

// Upcoming and in-progress games, optionally within radiusMiles of (lat, lng).
function listGames(db, { lat = null, lng = null, radiusMiles = null, format = null, type = 'all', now, settings }) {
  const where = ["g.status = 'scheduled'", 'g.starts_at >= ?'];
  const params = [new Date(now.getTime() - LIVE_LOOKBACK_MS).toISOString()];
  if (format) {
    where.push('g.format = ?');
    params.push(format);
  }
  if (type === 'wager') where.push('g.is_wager = 1');
  if (type === 'casual') where.push('g.is_wager = 0');
  const rows = db.prepare(`${GAME_SELECT} WHERE ${where.join(' AND ')} ORDER BY g.starts_at LIMIT 500`).all(...params);

  const hasOrigin = lat !== null && lng !== null;
  const games = [];
  for (const game of rows) {
    const phase = phaseOf(game, now);
    if (phase !== 'upcoming' && phase !== 'live') continue;
    const distance = hasOrigin ? distanceMiles(lat, lng, game.lat, game.lng) : null;
    if (hasOrigin && radiusMiles !== null && distance > radiusMiles) continue;
    games.push(serializeGame(db, game, getRoster(db, game.id), { now, settings, distance }));
  }
  return games;
}

function myGames(db, user, { now, settings }) {
  const rows = db
    .prepare(
      `${GAME_SELECT}
       WHERE g.organizer_id = ? OR g.id IN (SELECT game_id FROM game_players WHERE user_id = ?)
       ORDER BY g.starts_at DESC LIMIT 100`,
    )
    .all(user.id, user.id);
  return rows.map((game) => serializeGame(db, game, getRoster(db, game.id), { now, settings }));
}

function disputedGames(db, { now, settings }) {
  const rows = db.prepare(`${GAME_SELECT} WHERE g.result_status = 'disputed' ORDER BY g.reported_at`).all();
  return rows.map((game) => serializeGame(db, game, getRoster(db, game.id), { now, settings }));
}

function playerStats(db, userId) {
  const record = db
    .prepare(
      `SELECT
         COUNT(*) AS played,
         COALESCE(SUM(g.winner = gp.team), 0) AS wins,
         COALESCE(SUM(g.winner = 'draw'), 0) AS draws,
         COALESCE(SUM(g.is_wager), 0) AS wager_played,
         COALESCE(SUM(g.is_wager AND g.winner = gp.team), 0) AS wager_wins
       FROM game_players gp JOIN games g ON g.id = gp.game_id
       WHERE gp.user_id = ? AND g.status = 'completed'`,
    )
    .get(userId);
  const { winnings } = db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS winnings FROM transactions WHERE user_id = ? AND type = 'payout'`,
    )
    .get(userId);
  return {
    gamesPlayed: record.played,
    wins: record.wins,
    draws: record.draws,
    losses: record.played - record.wins - record.draws,
    wagerMatchesPlayed: record.wager_played,
    wagerWins: record.wager_wins,
    winningsCents: winnings,
  };
}

// ---------------------------------------------------------------------------
// Changing games

function createGame(db, organizer, input, { now, settings }) {
  return transaction(db, () => {
    const result = db
      .prepare(
        `INSERT INTO games (organizer_id, title, format, skill_level, starts_at, duration_minutes, venue_name,
           address, lat, lng, notes, is_wager, entry_fee_cents, platform_fee_percent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        organizer.id,
        input.title,
        input.format,
        input.skillLevel,
        input.startsAt.toISOString(),
        input.durationMinutes,
        input.venueName,
        input.address,
        input.lat,
        input.lng,
        input.notes,
        input.isWager ? 1 : 0,
        input.isWager ? input.entryFeeCents : 0,
        input.isWager ? settings.wagers.platformFeePercent : 0,
        now.toISOString(),
      );
    const gameId = Number(result.lastInsertRowid);
    if (input.joinAsPlayer) joinGame(db, gameId, organizer, { team: 'A' }, { now, settings });
    return gameId;
  });
}

function joinGame(db, gameId, user, { team = null }, { now, settings }) {
  return transaction(db, () => {
    const game = requireGame(db, gameId);
    const roster = getRoster(db, gameId);
    assertAllowed(joinBlocker({ db, game, roster, user, now, settings }, team));
    const counts = teamCounts(roster);
    const assigned = team || (counts.B < counts.A ? 'B' : 'A');
    db.prepare('INSERT INTO game_players (game_id, user_id, team, joined_at) VALUES (?, ?, ?, ?)').run(
      gameId,
      user.id,
      assigned,
      now.toISOString(),
    );
    if (game.is_wager) {
      ledger.record(db, {
        userId: user.id,
        gameId,
        type: 'entry_fee',
        amountCents: -game.entry_fee_cents,
        memo: `Entry fee (held in escrow): ${game.title}`,
        now,
      });
    }
    return assigned;
  });
}

function leaveGame(db, gameId, user, { now }) {
  transaction(db, () => {
    const game = requireGame(db, gameId);
    assertAllowed(leaveBlocker({ game, roster: getRoster(db, gameId), user, now }));
    db.prepare('DELETE FROM game_players WHERE game_id = ? AND user_id = ?').run(gameId, user.id);
    if (game.is_wager) ledger.refundPlayer(db, gameId, user.id, `Refund — left match: ${game.title}`, now);
  });
}

function closeWithRefunds(db, game, reason, now) {
  db.prepare("UPDATE games SET status = 'cancelled', cancel_reason = ? WHERE id = ?").run(reason, game.id);
  ledger.refundGame(db, game.id, `Refund — ${reason}: ${game.title}`, now);
}

function cancelGame(db, gameId, user, { now }) {
  transaction(db, () => {
    const game = requireGame(db, gameId);
    assertAllowed(cancelBlocker({ game, user, now }));
    const byAdmin = user.is_admin && game.organizer_id !== user.id;
    closeWithRefunds(db, game, byAdmin ? 'cancelled by an admin' : 'cancelled by the organizer', now);
  });
}

// Pays out (or refunds, on a draw) a wager match whose score is recorded, and
// marks the game completed.
function settleGame(db, game, confirmedBy, now) {
  if (game.is_wager) {
    if (game.winner === 'draw') {
      ledger.refundGame(db, game.id, `Refund — match drawn: ${game.title}`, now);
    } else {
      const winners = getRoster(db, game.id).filter((p) => p.team === game.winner);
      const payout = computePayout({
        potCents: ledger.escrowHeldCents(db, game.id),
        winnerCount: winners.length,
        platformFeePercent: game.platform_fee_percent,
      });
      for (const winner of winners) {
        ledger.record(db, {
          userId: winner.user_id,
          gameId: game.id,
          type: 'payout',
          amountCents: payout.perWinnerCents,
          memo: `Winnings: ${game.title}`,
          now,
        });
      }
      if (payout.platformCents > 0) {
        ledger.record(db, {
          userId: null,
          gameId: game.id,
          type: 'platform_fee',
          amountCents: payout.platformCents,
          memo: `Platform fee: ${game.title}`,
          now,
        });
      }
    }
  }
  db.prepare("UPDATE games SET status = 'completed', result_status = 'confirmed', confirmed_by = ? WHERE id = ?").run(
    confirmedBy,
    game.id,
  );
}

function winnerFor(scoreA, scoreB) {
  if (scoreA > scoreB) return 'A';
  if (scoreB > scoreA) return 'B';
  return 'draw';
}

// Casual scores are final right away. Wager results wait for the other
// captain to confirm, so nobody can claim a prize on their own say-so.
function reportResult(db, gameId, user, { scoreA, scoreB }, { now }) {
  transaction(db, () => {
    const game = requireGame(db, gameId);
    assertAllowed(reportBlocker({ game, roster: getRoster(db, gameId), user, now }));
    db.prepare(
      `UPDATE games SET score_a = ?, score_b = ?, winner = ?, reported_by = ?, reported_at = ?, result_status = 'pending'
       WHERE id = ?`,
    ).run(scoreA, scoreB, winnerFor(scoreA, scoreB), user.id, now.toISOString(), gameId);
    if (!game.is_wager) settleGame(db, requireGame(db, gameId), user.id, now);
  });
}

function confirmResult(db, gameId, user, { now }) {
  transaction(db, () => {
    const game = requireGame(db, gameId);
    assertAllowed(confirmBlocker({ game, roster: getRoster(db, gameId), user }));
    settleGame(db, game, user.id, now);
  });
}

function disputeResult(db, gameId, user, { reason }) {
  transaction(db, () => {
    const game = requireGame(db, gameId);
    assertAllowed(confirmBlocker({ game, roster: getRoster(db, gameId), user }));
    db.prepare("UPDATE games SET result_status = 'disputed', dispute_reason = ? WHERE id = ?").run(reason, gameId);
  });
}

// An admin settles a contested wager match with the correct score, or voids
// it and refunds everyone.
function resolveResult(db, gameId, admin, { scoreA, scoreB, refund }, { now }) {
  transaction(db, () => {
    const game = requireGame(db, gameId);
    if (game.status !== 'scheduled' || !['pending', 'disputed'].includes(game.result_status)) {
      throw new HttpError(409, 'This game has no result to resolve');
    }
    if (refund) {
      closeWithRefunds(db, game, 'voided by an admin', now);
      return;
    }
    db.prepare('UPDATE games SET score_a = ?, score_b = ?, winner = ? WHERE id = ?').run(
      scoreA,
      scoreB,
      winnerFor(scoreA, scoreB),
      gameId,
    );
    settleGame(db, requireGame(db, gameId), admin.id, now);
  });
}

// Housekeeping that keeps money from getting stuck in escrow. Run regularly.
//  - Wager matches that reach kickoff without full teams are cancelled and refunded.
//  - Wager matches nobody reports a result for are refunded once the result window passes.
//  - Reported results the other captain ignores are confirmed once the result window passes.
function runMaintenance(db, { now, settings }) {
  const windowMs = settings.wagers.resultWindowHours * HOUR_MS;
  return transaction(db, () => {
    let changed = 0;
    const kickedOff = db
      .prepare(`${GAME_SELECT} WHERE g.status = 'scheduled' AND g.is_wager = 1 AND g.result_status = 'none' AND g.starts_at <= ?`)
      .all(now.toISOString());
    for (const game of kickedOff) {
      if (!isFull(game, getRoster(db, game.id))) {
        closeWithRefunds(db, game, 'teams were not full at kickoff', now);
        changed += 1;
      } else if (endOf(game) + windowMs <= now.getTime()) {
        closeWithRefunds(db, game, 'no result was reported', now);
        changed += 1;
      }
    }
    const unanswered = db
      .prepare(`${GAME_SELECT} WHERE g.status = 'scheduled' AND g.result_status = 'pending' AND g.reported_at <= ?`)
      .all(new Date(now.getTime() - windowMs).toISOString());
    for (const game of unanswered) {
      settleGame(db, game, null, now);
      changed += 1;
    }
    return changed;
  });
}

module.exports = {
  getGame,
  gameDetail,
  listGames,
  myGames,
  disputedGames,
  playerStats,
  createGame,
  joinGame,
  leaveGame,
  cancelGame,
  reportResult,
  confirmResult,
  disputeResult,
  resolveResult,
  runMaintenance,
};
