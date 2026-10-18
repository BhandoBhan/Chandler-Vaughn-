import { api } from '../api.js';
import { session } from '../session.js';
import { h, money, whenLabel, formatBadge, bindForm, formError, actionButton, toast, emptyState } from '../ui.js';

export async function renderAdmin(view, ctx) {
  if (!session.user.isAdmin) {
    ctx.mount(emptyState('Admins only', 'You need an admin account to see this page.'));
    return;
  }
  let { games } = await api.get('/admin/disputes');
  if (!ctx.mount(build())) return;

  async function resolve(id, body, message) {
    await api.post(`/admin/games/${id}/resolve`, body);
    games = (await api.get('/admin/disputes')).games;
    view.replaceChildren(build());
    toast(message, 'success');
  }

  function build() {
    return h(
      'div',
      { class: 'admin' },
      h('h1', {}, 'Disputed wager matches'),
      h('p', { class: 'muted' }, 'Prize money stays in escrow until you settle each match with the correct score or void it.'),
      games.length === 0
        ? emptyState('No disputes', 'Nothing needs your attention right now.')
        : games.map((game) => disputeCard(game)),
    );
  }

  function disputeCard(game) {
    const r = game.result;
    const scoreInput = (name, value) => h('input', { type: 'number', name, min: 0, max: 99, required: true, value: String(value), inputmode: 'numeric' });
    return h(
      'section',
      { class: 'card dispute' },
      h('div', { class: 'card-badges' }, formatBadge(game.format), h('span', { class: 'badge wager' }, `${money(game.wager.entryFeeCents)} entry`)),
      h('h2', {}, h('a', { href: `#/game/${game.id}` }, game.title)),
      h('p', { class: 'muted' }, `${whenLabel(game.startsAt)} · ${game.venueName}`),
      h('p', {}, `${r.reportedBy ? r.reportedBy.displayName : 'A captain'} reported Team A ${r.scoreA} – ${r.scoreB} Team B.`),
      r.disputeReason ? h('blockquote', {}, r.disputeReason) : null,
      bindForm(
        h(
          'form',
          { class: 'resolve-form' },
          h('label', { class: 'score-input' }, h('span', {}, 'Team A'), scoreInput('scoreA', r.scoreA)),
          h('span', { class: 'score-sep' }, '–'),
          h('label', { class: 'score-input' }, h('span', {}, 'Team B'), scoreInput('scoreB', r.scoreB)),
          h('button', { type: 'submit', class: 'btn btn-primary' }, 'Settle with this score'),
          formError(),
        ),
        async (data) =>
          resolve(game.id, { scoreA: Number(data.get('scoreA')), scoreB: Number(data.get('scoreB')) }, 'Match settled and paid out'),
      ),
      actionButton(
        'Void match & refund everyone',
        async () => {
          if (!window.confirm('Void this match and refund every player?')) return;
          await resolve(game.id, { refund: true }, 'Match voided and refunded');
        },
        { class: 'btn btn-danger-light' },
      ),
    );
  }
}
