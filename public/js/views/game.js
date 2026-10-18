import { api } from '../api.js';
import { session, refreshUser } from '../session.js';
import { pitch, zoneLabel } from '../pitch.js';
import { createMap, dot, directionsUrl, FORMAT_COLORS } from '../map.js';
import {
  h,
  icon,
  money,
  dayLabel,
  timeLabel,
  fullDateLabel,
  formatBadge,
  phaseBadge,
  avatar,
  actionButton,
  bindForm,
  formError,
  toast,
  SKILL_LABELS,
} from '../ui.js';

export async function renderGame(view, ctx) {
  const id = ctx.params[0];
  let game = (await api.get(`/games/${id}`)).game;
  if (!ctx.mount(build())) return;
  drawMap();

  function rerender(next) {
    game = next;
    view.replaceChildren(build());
    drawMap();
  }

  async function act(path, body, message) {
    const { game: next } = await api.post(`/games/${id}${path}`, body);
    if (game.isWager) await refreshUser();
    rerender(next);
    if (message) toast(message, 'success');
  }

  function drawMap() {
    const el = view.querySelector('.game-map');
    const map = el && createMap(el, game, 14);
    if (map) dot(map, game, { color: FORMAT_COLORS[game.format], title: game.venueName });
    else if (el) el.remove();
  }

  function build() {
    const viewer = game.viewer;
    return h(
      'div',
      { class: 'game-page' },
      h('a', { class: 'back-link', href: '#/' }, icon('back', { size: 16 }), 'All games'),
      h(
        'header',
        { class: 'game-header' },
        h(
          'div',
          { class: 'card-badges' },
          formatBadge(game.format),
          h('span', { class: 'area' }, game.area),
          game.isWager ? h('span', { class: 'badge wager' }, icon('coin', { size: 14 }), 'Wager match') : null,
          phaseBadge(game.phase),
        ),
        h('h1', {}, game.title),
        h('p', { class: 'muted' }, 'Hosted by ', h('strong', {}, game.organizer.displayName)),
      ),
      h(
        'div',
        { class: 'game-layout' },
        h('div', { class: 'game-main' }, statusNotice(), teamsSection(viewer), resultSection(viewer), detailsSection()),
        h('aside', { class: 'game-side' }, game.isWager ? wagerPanel() : null, actionsPanel(viewer)),
      ),
    );
  }

  function statusNotice() {
    if (game.phase !== 'cancelled') return null;
    return h(
      'div',
      { class: 'notice notice-muted' },
      h('strong', {}, 'This game was cancelled'),
      game.cancelReason ? ` — ${game.cancelReason}.` : '.',
      game.isWager ? ' All entry fees were refunded to players’ wallets.' : '',
    );
  }

  function detailsSection() {
    return h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Details'),
      h(
        'dl',
        { class: 'details' },
        h('dt', {}, icon('calendar'), 'When'),
        h('dd', {}, `${dayLabel(game.startsAt)}, ${timeLabel(game.startsAt)} – ${timeLabel(game.endsAt)}`, h('span', { class: 'muted' }, ` (${game.durationMinutes} min)`)),
        h('dt', {}, icon('pin'), 'Where'),
        h(
          'dd',
          {},
          h('strong', {}, game.venueName),
          game.address ? h('div', { class: 'muted' }, game.address) : null,
          h('a', { href: directionsUrl(game), target: '_blank', rel: 'noopener' }, icon('navigate', { size: 14 }), 'Directions'),
        ),
        h('dt', {}, icon('users'), 'Format'),
        h('dd', {}, `${game.format} — ${game.playersPerTeam} a side, played ${zoneLabel(game.format)}`),
        h('dt', {}, icon('trophy'), 'Level'),
        h('dd', {}, SKILL_LABELS[game.skillLevel]),
      ),
      game.notes ? h('p', { class: 'notes' }, game.notes) : null,
      h('div', { class: 'detail-visuals' }, h('figure', { class: 'pitch-figure' }, pitch(game.format), h('figcaption', {}, `Played ${zoneLabel(game.format)}`)), h('div', { class: 'map game-map' })),
    );
  }

  function teamsSection(viewer) {
    return h(
      'section',
      { class: 'card' },
      h('div', { class: 'section-head' }, h('h2', {}, 'Teams'), h('span', { class: 'muted' }, `${game.playerCount}/${game.capacity} players`)),
      h('div', { class: 'teams' }, teamColumn('A', viewer), teamColumn('B', viewer)),
      joinHelp(viewer),
    );
  }

  function teamColumn(team, viewer) {
    const players = game.teams[team];
    const open = game.playersPerTeam - players.length;
    const isWinner = game.result && game.result.status === 'confirmed' && game.result.winner === team;
    return h(
      'div',
      { class: `team team-${team.toLowerCase()}${isWinner ? ' is-winner' : ''}` },
      h(
        'div',
        { class: 'team-head' },
        h('h3', {}, `Team ${team}`, isWinner ? h('span', { class: 'badge win' }, icon('trophy', { size: 13 }), 'Winner') : null),
        h('span', { class: 'muted' }, `${players.length}/${game.playersPerTeam}`),
      ),
      h(
        'ul',
        { class: 'roster' },
        players.map((p) =>
          h(
            'li',
            { class: session.user && p.id === session.user.id ? 'is-me' : null },
            avatar(p.displayName),
            h('span', { class: 'player-name' }, p.displayName, session.user && p.id === session.user.id ? h('span', { class: 'muted' }, ' (you)') : null),
            p.isCaptain ? h('span', { class: 'captain', title: 'Captain' }, 'C') : null,
            p.position ? h('span', { class: 'player-pos' }, p.position) : null,
          ),
        ),
        open > 0 ? h('li', { class: 'open-spot' }, h('span', { class: 'avatar avatar-empty' }, '+'), `${open} open spot${open === 1 ? '' : 's'}`) : null,
      ),
      viewer && viewer.canJoinTeam[team]
        ? actionButton(
            game.isWager ? `Join Team ${team} · ${money(game.wager.entryFeeCents)}` : `Join Team ${team}`,
            () => act('/join', { team }, game.isWager ? `You're in! ${money(game.wager.entryFeeCents)} is held in escrow.` : "You're in!"),
            { class: 'btn btn-primary btn-block' },
          )
        : null,
    );
  }

  function joinHelp(viewer) {
    if (!session.user) {
      if (game.phase !== 'upcoming' && game.phase !== 'live') return null;
      return h('p', { class: 'join-help' }, h('a', { href: `#/login?next=/game/${game.id}` }, 'Log in'), ' or ', h('a', { href: `#/signup?next=/game/${game.id}` }, 'create an account'), ' to join.');
    }
    if (!viewer || viewer.joined || !viewer.joinBlockedReason) return null;
    const reason = viewer.joinBlockedReason;
    let fix = null;
    if (/profile/.test(reason)) fix = h('a', { href: '#/me' }, 'Update profile');
    else if (/wallet/.test(reason)) fix = h('a', { href: '#/wallet' }, 'Add funds');
    return h('p', { class: 'join-help' }, icon('lock', { size: 15 }), reason, fix ? ' — ' : null, fix);
  }

  function wagerPanel() {
    const w = game.wager;
    return h(
      'section',
      { class: 'card wager-panel' },
      h('h2', {}, icon('coin'), 'Wager match'),
      h(
        'div',
        { class: 'wager-figures' },
        h('div', {}, h('span', { class: 'figure' }, money(w.entryFeeCents)), h('span', { class: 'figure-label' }, 'Entry per player')),
        h('div', {}, h('span', { class: 'figure' }, money(w.prizePoolCents)), h('span', { class: 'figure-label' }, 'Prize pool')),
        h('div', {}, h('span', { class: 'figure figure-win' }, money(w.perWinnerCents)), h('span', { class: 'figure-label' }, 'Each winner gets')),
      ),
      h(
        'ul',
        { class: 'fine-print' },
        h('li', {}, 'Entry fees are held in escrow — nobody can touch them until the result is settled.'),
        h('li', {}, 'Both teams must be full by kickoff, or the match is cancelled and everyone is refunded.'),
        h('li', {}, `A captain reports the score; the other captain confirms or disputes it. Unanswered results confirm after ${session.meta.wagers.resultWindowHours} hours.`),
        h('li', {}, 'Draws and cancellations are refunded in full.'),
        w.platformFeePercent > 0 ? h('li', {}, `${w.platformFeePercent}% platform fee comes out of the pot.`) : null,
        h('li', {}, `${session.meta.wagers.minAge}+ only.`),
      ),
    );
  }

  function actionsPanel(viewer) {
    const items = [];
    if (viewer && viewer.canLeave) {
      items.push(
        actionButton(game.isWager ? 'Leave & get refund' : 'Leave game', () => act('/leave', {}, 'You left the game'), { class: 'btn btn-light btn-block' }),
      );
    }
    if (viewer && viewer.canCancel) {
      items.push(
        actionButton(
          'Cancel game',
          async () => {
            if (!window.confirm(`Cancel "${game.title}"?${game.isWager ? ' Every player will be refunded.' : ''}`)) return;
            await act('/cancel', {}, 'Game cancelled');
          },
          { class: 'btn btn-danger-light btn-block' },
        ),
      );
    }
    items.push(
      actionButton(
        'Share game',
        async () => {
          const url = window.location.href;
          if (navigator.share) {
            await navigator.share({ title: game.title, url }).catch(() => {});
          } else {
            await navigator.clipboard.writeText(url);
            toast('Link copied', 'success');
          }
        },
        { class: 'btn btn-light btn-block' },
      ),
    );
    return h('section', { class: 'card actions' }, items);
  }

  function scoreLine(result) {
    return h(
      'div',
      { class: 'scoreline' },
      h('span', { class: 'score-team' }, 'Team A'),
      h('span', { class: 'score' }, `${result.scoreA} – ${result.scoreB}`),
      h('span', { class: 'score-team' }, 'Team B'),
    );
  }

  function resultSection(viewer) {
    const result = game.result;
    if (game.phase === 'upcoming' || game.phase === 'cancelled') return null;

    if (!result) {
      if (viewer && viewer.canReport) return reportForm();
      return h(
        'section',
        { class: 'card' },
        h('h2', {}, 'Final score'),
        h('p', { class: 'muted' }, game.isWager ? 'A team captain reports the score after the final whistle.' : 'Any player can report the score after the game.'),
      );
    }

    if (result.status === 'confirmed') {
      const winnerText = result.winner === 'draw' ? 'Draw' : `Team ${result.winner} wins`;
      let payout = null;
      if (game.isWager) {
        payout =
          result.winner === 'draw'
            ? h('p', { class: 'muted' }, 'Draw — every player got their entry fee back.')
            : h('p', { class: 'payout' }, icon('trophy'), `Each Team ${result.winner} player was paid ${money(game.wager.perWinnerCents)}.`);
      }
      return h('section', { class: 'card result-card' }, h('h2', {}, 'Final score'), scoreLine(result), h('p', { class: 'result-winner' }, winnerText), payout);
    }

    const reporter = result.reportedBy ? result.reportedBy.displayName : 'A captain';
    if (result.status === 'disputed') {
      return h(
        'section',
        { class: 'card result-card' },
        h('h2', {}, 'Result disputed'),
        scoreLine(result),
        h('p', {}, `${reporter} reported this score, but the other captain disputed it. An admin is reviewing — prize money stays in escrow until it's resolved.`),
        result.disputeReason ? h('blockquote', {}, result.disputeReason) : null,
      );
    }

    // Pending confirmation.
    const waiting = h(
      'p',
      { class: 'muted' },
      `${reporter} reported this score. Waiting for the other captain to confirm — it confirms automatically ${fullDateLabel(result.autoConfirmAt)} if they don't respond.`,
    );
    if (!viewer || !viewer.canConfirm) {
      return h('section', { class: 'card result-card' }, h('h2', {}, 'Score reported'), scoreLine(result), waiting);
    }
    const disputeForm = bindForm(
      h(
        'form',
        { class: 'dispute-form', hidden: true },
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'What actually happened?'), h('textarea', { name: 'reason', rows: 3, required: true, minlength: 3, maxlength: 300 })),
        formError(),
        h('button', { type: 'submit', class: 'btn btn-danger' }, 'Send dispute'),
      ),
      async (data) => act('/result/dispute', { reason: data.get('reason') }, 'Dispute sent to an admin'),
    );
    return h(
      'section',
      { class: 'card result-card' },
      h('h2', {}, 'Confirm the score'),
      scoreLine(result),
      h('p', {}, `${reporter} reported this score. As the other captain, confirm it to pay out the winners, or dispute it if it's wrong.`),
      h(
        'div',
        { class: 'button-row' },
        actionButton('Confirm score', () => act('/result/confirm', {}, 'Score confirmed'), { class: 'btn btn-primary' }),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-light',
            onClick: () => {
              disputeForm.hidden = false;
              disputeForm.querySelector('textarea').focus();
            },
          },
          'Dispute',
        ),
      ),
      disputeForm,
    );
  }

  function reportForm() {
    const scoreInput = (name, label) =>
      h('label', { class: 'score-input' }, h('span', {}, label), h('input', { type: 'number', name, min: 0, max: 99, required: true, inputmode: 'numeric' }));
    return h(
      'section',
      { class: 'card' },
      h('h2', {}, 'Report the final score'),
      bindForm(
        h(
          'form',
          { class: 'report-form' },
          h('div', { class: 'score-inputs' }, scoreInput('scoreA', 'Team A'), h('span', { class: 'score-sep' }, '–'), scoreInput('scoreB', 'Team B')),
          game.isWager ? h('p', { class: 'muted' }, "The other team's captain will be asked to confirm before prize money is paid.") : null,
          formError(),
          h('button', { type: 'submit', class: 'btn btn-primary' }, 'Submit score'),
        ),
        async (data) =>
          act('/result', { scoreA: Number(data.get('scoreA')), scoreB: Number(data.get('scoreB')) }, game.isWager ? 'Score sent for confirmation' : 'Score saved'),
      ),
    );
  }
}
