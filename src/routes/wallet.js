'use strict';

const express = require('express');
const { HttpError } = require('../http-error');
const { requireAuth } = require('../auth');
const { transaction } = require('../db');
const v = require('../validate');
const ledger = require('../services/ledger');

const MAX_TRANSFER_CENTS = 50000;

function walletResponse(db, userId) {
  return {
    balanceCents: ledger.balanceCents(db, userId),
    transactions: ledger.history(db, userId).map((t) => ({
      id: t.id,
      type: t.type,
      amountCents: t.amount_cents,
      memo: t.memo,
      gameId: t.game_id,
      gameTitle: t.game_title,
      createdAt: t.created_at,
    })),
  };
}

function amount(body) {
  return v.integer(body.amountCents, 'Amount', { min: 100, max: MAX_TRANSFER_CENTS });
}

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(walletResponse(req.app.locals.db, req.user.id));
});

router.post('/deposit', async (req, res) => {
  const { db, clock, payments } = req.app.locals;
  const amountCents = amount(req.body);
  const { reference } = await payments.deposit({ user: req.user, amountCents });
  ledger.record(db, {
    userId: req.user.id,
    type: 'deposit',
    amountCents,
    memo: payments.realMoney ? 'Deposit' : 'Deposit (demo money)',
    reference,
    now: clock(),
  });
  res.status(201).json(walletResponse(db, req.user.id));
});

router.post('/withdraw', async (req, res) => {
  const { db, clock, payments } = req.app.locals;
  const amountCents = amount(req.body);
  // Debit first so the same money can't be withdrawn twice while the
  // payment provider is working; put it back if the provider fails.
  transaction(db, () => {
    if (ledger.balanceCents(db, req.user.id) < amountCents) throw new HttpError(409, 'Not enough money in your wallet');
    ledger.record(db, { userId: req.user.id, type: 'withdrawal', amountCents: -amountCents, memo: 'Withdrawal', now: clock() });
  });
  try {
    await payments.withdraw({ user: req.user, amountCents });
  } catch (err) {
    ledger.record(db, { userId: req.user.id, type: 'refund', amountCents, memo: 'Withdrawal failed — returned', now: clock() });
    throw err;
  }
  res.status(201).json(walletResponse(db, req.user.id));
});

module.exports = router;
