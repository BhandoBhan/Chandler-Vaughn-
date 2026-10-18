'use strict';

const express = require('express');
const { SKILL_LEVELS, US_STATES } = require('../config');
const { HttpError } = require('../http-error');
const auth = require('../auth');
const v = require('../validate');
const ledger = require('../services/ledger');
const games = require('../services/games');
const { wagerEligibility } = require('../services/wagers');

function publicUser(db, user, { now, settings }) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    birthDate: user.birth_date,
    state: user.state,
    skillLevel: user.skill_level,
    position: user.position,
    homeLat: user.home_lat,
    homeLng: user.home_lng,
    isAdmin: Boolean(user.is_admin),
    balanceCents: ledger.balanceCents(db, user.id),
    wagerBlockedReason: wagerEligibility(user, settings, now),
    stats: games.playerStats(db, user.id),
  };
}

const router = express.Router();

router.post('/auth/signup', async (req, res) => {
  const { db, clock, settings } = req.app.locals;
  const email = v.email(req.body.email);
  const password = v.string(req.body.password, 'Password', { min: 8, max: 200 });
  const displayName = v.string(req.body.displayName, 'Name', { min: 2, max: 40 });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    throw new HttpError(409, 'An account with that email already exists');
  }
  const now = clock();
  const passwordHash = await auth.hashPassword(password);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (email, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)')
    .run(email, passwordHash, displayName, now.toISOString());
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid);
  const token = auth.createSession(db, user.id, now);
  res.status(201).json({ token, user: publicUser(db, user, { now, settings }) });
});

router.post('/auth/login', async (req, res) => {
  const { db, clock, settings } = req.app.locals;
  const email = v.email(req.body.email);
  const password = v.string(req.body.password, 'Password', { max: 200 });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await auth.verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, 'Email or password is incorrect');
  }
  const now = clock();
  const token = auth.createSession(db, user.id, now);
  res.json({ token, user: publicUser(db, user, { now, settings }) });
});

router.post('/auth/logout', auth.requireAuth, (req, res) => {
  auth.deleteSession(req.app.locals.db, req.sessionToken);
  res.status(204).end();
});

router.get('/me', auth.requireAuth, (req, res) => {
  const { db, clock, settings } = req.app.locals;
  res.json({ user: publicUser(db, req.user, { now: clock(), settings }) });
});

router.patch('/me', auth.requireAuth, (req, res) => {
  const { db, clock, settings } = req.app.locals;
  const body = req.body;
  const updates = {};
  if ('displayName' in body) updates.display_name = v.string(body.displayName, 'Name', { min: 2, max: 40 });
  if ('birthDate' in body) updates.birth_date = v.calendarDate(body.birthDate, 'Date of birth', { optional: true });
  if ('state' in body) updates.state = v.oneOf(body.state, 'State', US_STATES, { optional: true });
  if ('skillLevel' in body) updates.skill_level = v.oneOf(body.skillLevel, 'Skill level', SKILL_LEVELS);
  if ('position' in body) updates.position = v.string(body.position, 'Position', { max: 30, optional: true });
  if ('homeLat' in body) updates.home_lat = v.number(body.homeLat, 'Home latitude', { min: -90, max: 90, optional: true });
  if ('homeLng' in body) updates.home_lng = v.number(body.homeLng, 'Home longitude', { min: -180, max: 180, optional: true });

  const now = clock();
  if (updates.birth_date && Date.parse(updates.birth_date) > now.getTime()) v.fail('Date of birth is in the future');

  const columns = Object.keys(updates);
  if (columns.length > 0) {
    db.prepare(`UPDATE users SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(
      ...columns.map((c) => updates[c]),
      req.user.id,
    );
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(db, user, { now, settings }) });
});

module.exports = router;
