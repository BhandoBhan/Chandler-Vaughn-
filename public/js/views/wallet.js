import { api } from '../api.js';
import { session, refreshUser } from '../session.js';
import { h, icon, money, fullDateLabel, bindForm, formError, toast, emptyState } from '../ui.js';

const QUICK_AMOUNTS = [1000, 2500, 5000, 10000];
const TYPE_LABELS = {
  deposit: 'Added funds',
  withdrawal: 'Withdrawal',
  entry_fee: 'Entry fee',
  refund: 'Refund',
  payout: 'Winnings',
};

export async function renderWallet(view, ctx) {
  let wallet = await api.get('/wallet');
  const demo = session.meta.paymentsMode === 'demo';
  if (!ctx.mount(build())) return;

  async function move(path, amountCents, message) {
    wallet = await api.post(`/wallet/${path}`, { amountCents });
    await refreshUser();
    view.replaceChildren(build());
    toast(message, 'success');
  }

  function build() {
    const depositInput = h('input', { type: 'number', name: 'amount', min: 1, max: 500, step: 1, placeholder: 'Other amount', inputmode: 'decimal' });
    const withdrawInput = h('input', { type: 'number', name: 'amount', min: 1, max: 500, step: 1, placeholder: 'Amount', inputmode: 'decimal' });

    return h(
      'div',
      { class: 'wallet' },
      h('h1', {}, 'Wallet'),
      demo
        ? h('div', { class: 'notice notice-info' }, h('strong', {}, 'Demo mode: '), 'this wallet uses play money. No real payments are taken or paid out.')
        : null,
      h(
        'section',
        { class: 'balance-card' },
        h('span', { class: 'balance-label' }, 'Available balance'),
        h('span', { class: 'balance' }, money(wallet.balanceCents)),
        h('span', { class: 'balance-sub' }, 'Use it for wager match entry fees. Winnings land here automatically.'),
      ),
      session.user.wagerBlockedReason
        ? h('p', { class: 'join-help' }, icon('lock', { size: 15 }), session.user.wagerBlockedReason, ' — ', h('a', { href: '#/me' }, 'Update profile'))
        : null,
      h(
        'div',
        { class: 'wallet-actions' },
        h(
          'section',
          { class: 'card' },
          h('h2', {}, 'Add funds'),
          h(
            'div',
            { class: 'quick-amounts' },
            QUICK_AMOUNTS.map((cents) =>
              h('button', { type: 'button', class: 'btn btn-light', onClick: () => move('deposit', cents, `${money(cents)} added`).catch((err) => toast(err.message, 'error')) }, money(cents)),
            ),
          ),
          bindForm(
            h('form', { class: 'inline-form' }, depositInput, h('button', { type: 'submit', class: 'btn btn-primary' }, 'Add'), formError()),
            async () => {
              const cents = Math.round(Number(depositInput.value) * 100);
              await move('deposit', cents, `${money(cents)} added`);
            },
          ),
        ),
        h(
          'section',
          { class: 'card' },
          h('h2', {}, 'Withdraw'),
          h('p', { class: 'muted' }, demo ? 'In demo mode this just removes play money.' : 'Sent to your linked bank account.'),
          bindForm(
            h('form', { class: 'inline-form' }, withdrawInput, h('button', { type: 'submit', class: 'btn btn-light' }, 'Withdraw'), formError()),
            async () => {
              const cents = Math.round(Number(withdrawInput.value) * 100);
              await move('withdraw', cents, `${money(cents)} withdrawn`);
            },
          ),
        ),
      ),
      h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Activity'),
        wallet.transactions.length === 0
          ? emptyState('No activity yet', 'Add funds to enter your first wager match.')
          : h(
              'ul',
              { class: 'activity' },
              wallet.transactions.map((t) =>
                h(
                  'li',
                  {},
                  h(
                    'div',
                    { class: 'activity-main' },
                    h('strong', {}, TYPE_LABELS[t.type] || t.type),
                    t.gameId ? h('a', { href: `#/game/${t.gameId}` }, t.gameTitle) : h('span', { class: 'muted' }, t.memo),
                    h('span', { class: 'muted small' }, fullDateLabel(t.createdAt)),
                  ),
                  h('span', { class: `amount ${t.amountCents >= 0 ? 'amount-in' : 'amount-out'}` }, `${t.amountCents >= 0 ? '+' : '−'}${money(Math.abs(t.amountCents))}`),
                ),
              ),
            ),
      ),
    );
  }
}
