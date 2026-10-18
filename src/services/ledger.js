'use strict';

// Wallet ledger. Positive amounts credit a wallet, negative amounts debit it.

function record(db, { userId, gameId = null, type, amountCents, memo = null, reference = null, now }) {
  db.prepare(
    `INSERT INTO transactions (user_id, game_id, type, amount_cents, memo, reference, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, gameId, type, amountCents, memo, reference, now.toISOString());
}

function balanceCents(db, userId) {
  return db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS balance FROM transactions WHERE user_id = ?').get(userId)
    .balance;
}

// Money currently held in escrow for a game: entry fees paid in, minus
// everything already refunded, paid out, or taken as a platform fee.
function escrowHeldCents(db, gameId) {
  const { net } = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS net FROM transactions WHERE game_id = ?').get(gameId);
  return 0 - net;
}

function history(db, userId, limit = 100) {
  return db
    .prepare(
      `SELECT t.id, t.type, t.amount_cents, t.memo, t.game_id, t.created_at, g.title AS game_title
       FROM transactions t LEFT JOIN games g ON g.id = t.game_id
       WHERE t.user_id = ? ORDER BY t.id DESC LIMIT ?`,
    )
    .all(userId, limit);
}

// Refunds whatever each player still has in escrow for this game.
function refundGame(db, gameId, memo, now) {
  const owed = db
    .prepare(
      `SELECT user_id, SUM(amount_cents) AS net FROM transactions
       WHERE game_id = ? AND user_id IS NOT NULL GROUP BY user_id HAVING net < 0`,
    )
    .all(gameId);
  for (const { user_id: userId, net } of owed) {
    record(db, { userId, gameId, type: 'refund', amountCents: -net, memo, now });
  }
}

// Refunds one player who is leaving a game.
function refundPlayer(db, gameId, userId, memo, now) {
  const { net } = db
    .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS net FROM transactions WHERE game_id = ? AND user_id = ?')
    .get(gameId, userId);
  if (net < 0) record(db, { userId, gameId, type: 'refund', amountCents: -net, memo, now });
}

module.exports = { record, balanceCents, escrowHeldCents, history, refundGame, refundPlayer };
