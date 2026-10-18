'use strict';

const { loadSettings } = require('./config');
const { openDatabase } = require('./db');
const { createApp } = require('./app');
const { runMaintenance } = require('./services/games');

const MAINTENANCE_INTERVAL_MS = 60 * 1000;

const settings = loadSettings();
const db = openDatabase(settings.databasePath);
const app = createApp({ db, settings });

function maintain() {
  try {
    const changed = runMaintenance(db, { now: new Date(), settings });
    if (changed > 0) console.log(`Maintenance: settled or refunded ${changed} game(s)`);
  } catch (err) {
    console.error('Maintenance failed', err);
  }
}

maintain();
setInterval(maintain, MAINTENANCE_INTERVAL_MS).unref();

app.listen(settings.port, () => {
  console.log(`Pickup Soccer running at http://localhost:${settings.port}`);
  if (settings.paymentsMode === 'demo') console.log('Payments: demo mode (play money only)');
});
