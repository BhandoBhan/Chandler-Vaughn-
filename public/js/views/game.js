import { api } from '../api.js';
import { session, refreshUser } from '../session.js';
import { pitch, zoneLabel } from '../pitch.js';
import { createMap, dot, directionsUrl, FORMAT_COLORS } from '../map.js';
import { lineupBoard, formationSpots } from '../lineup.js';
import {
  h,
  icon,
  money,
  dayLabel,
  timeLabel,
  fullDateLabel,
  formatBadge,
  phaseBadge,
  actionButton,
  bindForm,
  formError,
  toast,
  SKILL_LABELS,
} from '../ui.js';

export async function renderGame(view, ctx) {
  const id = ctx.params[0];
  let game = (await api.get(`/games/${id}`)).game;
  // Lineup board state: which team is shown and which player a captain has
  // picked up to move.
  let shownTeam = (game.viewer && game.viewer.team) || 'A';
  let selectedId = null;
  let busy = false;
  let teamsEl = null;
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

  // Lineup changes only redraw the board, not the whole page.
  async function updateLineup(path, body, message) {
    game = (await api.post(`/games/${id}${path}`, body)).game;
    renderTeams();
    toast(message, 'success');
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
        h('div', { class: 'game-main' }, statusNotice(), teamsSection(), resultSection(viewer), detailsSection()),
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

  function teamsSection() {
    teamsEl = h('section', { class: 'card lineup' });
    renderTeams();
    return teamsEl;
  }

  function renderTeams() {
    const viewer = game.viewer;
    const team = shownTeam;
    const winner = game.result && game.result.status === 'confirmed' ? game.result.winner : null;

    const tabs = ['A', 'B'].map((t) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(t === team),
          onClick: () => {
            shownTeam = t;
            selectedId = null;
            renderTeams();
          },
        },
        winner === t ? icon('trophy', { size: 14 }) : null,
        `Team ${t}`,
        h('span', { class: 'tab-count' }, `${game.teams[t].length}/${game.playersPerTeam}`),
      ),
    );

    let formation = h('span', { class: 'formation-label' }, game.formations[team]);
    if (viewer && viewer.canSetFormation && viewer.team === team) {
      formation = h(
        'select',
        { class: 'formation-select', 'aria-label': 'Formation', value: game.formations[team] },
        Object.keys(session.meta.formations[game.format]).map((name) => h('option', { value: name }, name)),
      );
      formation.addEventListener('change', () =>
        run(() => updateLineup('/lineup/formation', { team, formation: formation.value }, `Formation set to ${formation.value}`)),
      );
    }

    teamsEl.replaceChildren(
      h('div', { class: 'section-head' }, h('h2', {}, 'Lineups'), h('span', { class: 'muted' }, `${game.playerCount}/${game.capacity} players`)),
      h('div', { class: 'lineup-bar' }, h('div', { class: 'segmented', role: 'group', 'aria-label': 'Team' }, tabs), formation),
      lineupBoard({ game, team, selectedId, canTap: (index, player) => canTap(team, player), onTap: (index, player) => onSpot(team, index, player) }),
      h('p', { class: 'lineup-hint' }, lineupHint(team)),
      viewer && viewer.canJoinTeam[team]
        ? actionButton(
            game.isWager ? `Join Team ${team} · ${money(game.wager.entryFeeCents)}` : `Join Team ${team}`,
            () => act('/join', { team }, game.isWager ? `You're in! ${money(game.wager.entryFeeCents)} is held in escrow.` : "You're in!"),
            { class: 'btn btn-primary btn-block' },
          )
        : null,
      joinHelp(viewer),
    );
  }

  function gameOpen() {
    return game.status === 'scheduled' && (game.phase === 'upcoming' || game.phase === 'live');
  }

  function canTap(team, player) {
    const viewer = game.viewer;
    if (!session.user) return !player && gameOpen();
    if (!viewer.joined) return !player && viewer.canJoinTeam[team];
    if (viewer.team !== team || !viewer.canEditLineup) return false;
    if (viewer.isCaptain) return true;
    return !player;
  }

  function lineupHint(team) {
    const viewer = game.viewer;
    if (!session.user) return gameOpen() ? 'Tap an open spot to log in and claim it.' : '';
    if (!viewer.joined) {
      if (!viewer.canJoinTeam[team]) return '';
      return game.isWager
        ? `Tap an open spot to join Team ${team} in that position (${money(game.wager.entryFeeCents)} entry).`
        : `Tap an open spot to join Team ${team} in that position.`;
    }
    if (viewer.team !== team) return `You're on Team ${viewer.team}.`;
    if (!viewer.canEditLineup) return 'The lineup is locked.';
    if (viewer.isCaptain) {
      return selectedId
        ? 'Now tap the spot to move them to. Tapping a teammate swaps the two.'
        : "You're captain: tap a player, then a spot, to move or swap them.";
    }
    return 'Tap an open spot to change your position.';
  }

  // Runs one lineup action at a time and reports failures.
  async function run(action) {
    if (busy) return;
    busy = true;
    try {
      await action();
    } catch (err) {
      toast(err.message, 'error');
      renderTeams();
    } finally {
      busy = false;
    }
  }

  function onSpot(team, index, player) {
    const viewer = game.viewer;
    const pos = formationSpots(game, team)[index].pos;
    if (!session.user) {
      ctx.navigate(`/login?next=/game/${game.id}`);
      return;
    }
    if (!viewer.joined) {
      if (game.isWager && !window.confirm(`Join Team ${team} as ${pos}? Your ${money(game.wager.entryFeeCents)} entry fee is held in escrow until the result is settled.`)) return;
      run(() => act('/join', { team, slot: index }, `You're in at ${pos}!`));
      return;
    }
    if (viewer.isCaptain && selectedId === null && player) {
      selectedId = player.id;
      renderTeams();
      return;
    }
    if (player && player.id === selectedId) {
      selectedId = null;
      renderTeams();
      return;
    }
    const playerId = selectedId ?? session.user.id;
    selectedId = null;
    run(() => updateLineup('/lineup/move', { playerId, slot: index }, player ? 'Players swapped' : `Moved to ${pos}`));
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
