'use strict';

const path = require('node:path');
const express = require('express');
const { HttpError } = require('./http-error');
const { sessionMiddleware } = require('./auth');
const { createPaymentProvider } = require('./payments');

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://unpkg.com",
  "style-src 'self' https://unpkg.com",
  "img-src 'self' data: https://unpkg.com https://tile.openstreetmap.org",
  "connect-src 'self' https://nominatim.openstreetmap.org",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// clock is injectable so tests can move time forward.
function createApp({ db, settings, clock = () => new Date() }) {
  const app = express();
  app.locals.db = db;
  app.locals.settings = settings;
  app.locals.clock = clock;
  app.locals.payments = createPaymentProvider(settings.paymentsMode);

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '20kb' }));
  api.use((req, res, next) => {
    req.body ??= {};
    next();
  });
  api.use(sessionMiddleware);
  api.use(require('./routes/account'));
  api.use(require('./routes/games'));
  api.use('/wallet', require('./routes/wallet'));
  api.use((req, res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}

module.exports = { createApp };
