'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { HttpError } = require('./http-error');

const scrypt = promisify(crypto.scrypt);
const KEY_LENGTH = 64;
const SESSION_DAYS = 30;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Creates a session and returns the bearer token. Only its hash is stored.
function createSession(db, userId, now) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    now.toISOString(),
    expires.toISOString(),
  );
  return token;
}

function deleteSession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function bearerToken(req) {
  const header = req.get('authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

// Attaches req.user when the request carries a valid session token.
function sessionMiddleware(req, res, next) {
  const { db, clock } = req.app.locals;
  const token = bearerToken(req);
  req.user = null;
  if (token) {
    const row = db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
      )
      .get(hashToken(token), clock().toISOString());
    if (row) {
      req.user = row;
      req.sessionToken = token;
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please log in first'));
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Please log in first'));
  if (!req.user.is_admin) return next(new HttpError(403, 'Admins only'));
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  deleteSession,
  sessionMiddleware,
  requireAuth,
  requireAdmin,
};
