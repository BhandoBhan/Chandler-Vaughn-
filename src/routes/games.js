'use strict';

const express = require('express');
const { FORMATS, FORMATIONS, SKILL_LEVELS, US_STATES } = require('../config');
const { HttpError } = require('../http-error');
const { requireAuth, requireAdmin } = require('../auth');
const v = require('../validate');
const games = require('../services/games');
const { wagerEligibility } = require('../services/wagers');

const FORMAT_IDS = Object.keys(FORMATS);
const MAX_DAYS_AHEAD = 90;

function gameId(req) {
  return v.integer(req.params.id, 'Game id', { min: 1 });
}

function scores(body) {
  return {
    scoreA: v.integer(body.scoreA, 'Team A score', { min: 0, max: 99 }),
    scoreB: v.integer(body.scoreB, 'Team B score', { min: 0, max: 99 }),
  };
}

function context(req) {
  const { db, clock, settings } = req.app.locals;
  return { db, now: clock(), settings };
}

function detail(req, res, status = 200) {
  const { db, now, settings } = context(req);
  res.status(status).json({ game: games.gameDetail(db, gameId(req), { now, settings, user: req.user }) });
}

const router = express.Router();

router.get('/formats', (req, res) => {
  const { wagers, paymentsMode } = req.app.locals.settings;
  res.json({
    formats: Object.values(FORMATS),
    formations: FORMATIONS,
    skillLevels: SKILL_LEVELS,
    states: US_STATES,
    wagers: {
      enabled: wagers.enabled,
      minAge: wagers.minAge,
      platformFeePercent: wagers.platformFeePercent,
      minEntryFeeCents: wagers.minEntryFeeCents,
      maxEntryFeeCents: wagers.maxEntryFeeCents,
      resultWindowHours: wagers.resultWindowHours,
    },
    paymentsMode,
  });
});

router.get('/games', (req, res) => {
  const { db, now, settings } = context(req);
  const q = req.query;
  const lat = v.number(q.lat, 'lat', { min: -90, max: 90, optional: true });
  const lng = v.number(q.lng, 'lng', { min: -180, max: 180, optional: true });
  if ((lat === null) !== (lng === null)) v.fail('lat and lng must be given together');
  const list = games.listGames(db, {
    lat,
    lng,
    radiusMiles: v.number(q.radiusMiles, 'radiusMiles', { min: 1, max: 500, optional: true }),
    format: v.oneOf(q.format, 'format', FORMAT_IDS, { optional: true }),
    type: v.oneOf(q.type, 'type', ['all', 'casual', 'wager'], { fallback: 'all' }),
    now,
    settings,
  });
  res.json({ games: list });
});

router.get('/games/mine', requireAuth, (req, res) => {
  const { db, now, settings } = context(req);
  res.json({ games: games.myGames(db, req.user, { now, settings }) });
});

router.get('/games/:id', (req, res) => detail(req, res));

router.post('/games', requireAuth, (req, res) => {
  const { db, now, settings } = context(req);
  const body = req.body;
  const format = v.oneOf(body.format, 'Format', FORMAT_IDS);
  const venueName = v.string(body.venueName, 'Field or park name', { min: 2, max: 100 });
  const isWager = v.boolean(body.isWager, 'Wager match');
  const startsAt = v.isoDate(body.startsAt, 'Start time');
  if (startsAt.getTime() < now.getTime()) v.fail('Start time must be in the future');
  if (startsAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000) {
    v.fail(`Games can be scheduled up to ${MAX_DAYS_AHEAD} days ahead`);
  }

  let entryFeeCents = 0;
  if (isWager) {
    const { wagers } = settings;
    const blocked = wagerEligibility(req.user, settings, now);
    if (blocked) throw new HttpError(409, blocked);
    entryFeeCents = v.integer(body.entryFeeCents, 'Entry fee', {
      min: wagers.minEntryFeeCents,
      max: wagers.maxEntryFeeCents,
    });
  }

  const id = games.createGame(
    db,
    req.user,
    {
      title: v.string(body.title, 'Title', { max: 80, optional: true }) || `${format} at ${venueName}`,
      format,
      skillLevel: v.oneOf(body.skillLevel, 'Skill level', SKILL_LEVELS, { fallback: 'any' }),
      startsAt,
      durationMinutes: v.integer(body.durationMinutes ?? 60, 'Duration', { min: 30, max: 180 }),
      venueName,
      address: v.string(body.address, 'Address', { max: 200, optional: true }),
      lat: v.number(body.lat, 'Location latitude', { min: -90, max: 90 }),
      lng: v.number(body.lng, 'Location longitude', { min: -180, max: 180 }),
      notes: v.string(body.notes, 'Notes', { max: 500, optional: true }),
      isWager,
      entryFeeCents,
      joinAsPlayer: v.boolean(body.joinAsPlayer, 'Join as a player', { fallback: true }),
    },
    { now, settings },
  );
  res.status(201).json({ game: games.gameDetail(db, id, { now, settings, user: req.user }) });
});

router.post('/games/:id/join', requireAuth, (req, res) => {
  const { db, now, settings } = context(req);
  const team = v.oneOf(req.body.team, 'Team', ['A', 'B'], { optional: true });
  const slot = v.integer(req.body.slot, 'Spot', { min: 0, max: 10, optional: true });
  games.joinGame(db, gameId(req), req.user, { team, slot }, { now, settings });
  detail(req, res);
});

router.post('/games/:id/lineup/move', requireAuth, (req, res) => {
  const { db } = context(req);
  games.movePlayer(db, gameId(req), req.user, {
    playerId: v.integer(req.body.playerId, 'Player', { min: 1, optional: true }),
    slot: v.integer(req.body.slot, 'Spot', { min: 0, max: 10 }),
  });
  detail(req, res);
});

router.post('/games/:id/lineup/formation', requireAuth, (req, res) => {
  const { db } = context(req);
  games.setFormation(db, gameId(req), req.user, {
    team: v.oneOf(req.body.team, 'Team', ['A', 'B']),
    formation: v.string(req.body.formation, 'Formation', { max: 10 }),
  });
  detail(req, res);
});

router.post('/games/:id/leave', requireAuth, (req, res) => {
  const { db, now } = context(req);
  games.leaveGame(db, gameId(req), req.user, { now });
  detail(req, res);
});

router.post('/games/:id/cancel', requireAuth, (req, res) => {
  const { db, now } = context(req);
  games.cancelGame(db, gameId(req), req.user, { now });
  detail(req, res);
});

router.post('/games/:id/result', requireAuth, (req, res) => {
  const { db, now } = context(req);
  games.reportResult(db, gameId(req), req.user, scores(req.body), { now });
  detail(req, res);
});

router.post('/games/:id/result/confirm', requireAuth, (req, res) => {
  const { db, now } = context(req);
  games.confirmResult(db, gameId(req), req.user, { now });
  detail(req, res);
});

router.post('/games/:id/result/dispute', requireAuth, (req, res) => {
  const { db } = context(req);
  const reason = v.string(req.body.reason, 'Reason', { min: 3, max: 300 });
  games.disputeResult(db, gameId(req), req.user, { reason });
  detail(req, res);
});

router.get('/admin/disputes', requireAdmin, (req, res) => {
  const { db, now, settings } = context(req);
  res.json({ games: games.disputedGames(db, { now, settings }) });
});

router.post('/admin/games/:id/resolve', requireAdmin, (req, res) => {
  const { db, now } = context(req);
  const refund = v.boolean(req.body.refund, 'Refund');
  games.resolveResult(db, gameId(req), req.user, refund ? { refund } : scores(req.body), { now });
  detail(req, res);
});

module.exports = router;
