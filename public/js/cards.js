import { h, icon, money, whenLabel, formatBadge, phaseBadge, SKILL_LABELS } from './ui.js';

export function spotsMeter(game) {
  const fill = h('span', { class: 'meter-fill' });
  fill.style.width = `${Math.round((game.playerCount / game.capacity) * 100)}%`;
  const label =
    game.spotsLeft === 0
      ? 'Full'
      : `${game.spotsLeft} spot${game.spotsLeft === 1 ? '' : 's'} left`;
  return h(
    'div',
    { class: `spots${game.spotsLeft === 0 ? ' is-full' : game.spotsLeft <= 2 ? ' is-low' : ''}` },
    h('span', { class: 'meter', 'aria-hidden': 'true' }, fill),
    h('span', { class: 'spots-label' }, `${game.playerCount}/${game.capacity} players · ${label}`),
  );
}

export function wagerBadge(game) {
  return h(
    'span',
    { class: 'badge wager' },
    icon('coin', { size: 14 }),
    `${money(game.wager.entryFeeCents)} entry · win ${money(game.wager.perWinnerCents)}`,
  );
}

export function gameCard(game) {
  return h(
    'a',
    { class: `game-card${game.isWager ? ' is-wager' : ''}`, href: `#/game/${game.id}` },
    h(
      'div',
      { class: 'card-badges' },
      formatBadge(game.format),
      h('span', { class: 'area' }, game.area),
      game.isWager ? wagerBadge(game) : null,
      game.phase !== 'upcoming' ? phaseBadge(game.phase) : null,
    ),
    h('h3', { class: 'card-title' }, game.title),
    h('p', { class: 'meta' }, icon('calendar', { size: 16 }), whenLabel(game.startsAt)),
    h(
      'p',
      { class: 'meta' },
      icon('pin', { size: 16 }),
      game.venueName,
      game.distanceMiles !== null ? h('span', { class: 'distance' }, `${game.distanceMiles} mi`) : null,
    ),
    h('div', { class: 'card-foot' }, spotsMeter(game), h('span', { class: 'skill' }, SKILL_LABELS[game.skillLevel])),
  );
}
