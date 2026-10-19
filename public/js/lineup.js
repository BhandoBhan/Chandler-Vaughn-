import { session } from './session.js';
import { h, staticHtml, initials } from './ui.js';

// The lineup board: one team's formation drawn on a pitch, with a shirt in
// every spot showing who plays there or that it is open. The board runs from
// past the halfway line (top) down to the team's own goal line (bottom), in
// metres: 68 wide, 90.67 tall (3:4).
const BOARD_LINES = `
<svg class="board-pitch" viewBox="0 0 68 90.67" preserveAspectRatio="none" aria-hidden="true">
  <g class="board-stripes">
    ${Array.from({ length: 5 }, (_, i) => `<rect x="0" y="${i * 18.13}" width="68" height="9.07"/>`).join('')}
  </g>
  <g class="board-lines">
    <rect x="0.5" y="0.5" width="67" height="89.67"/>
    <line x1="0.5" y1="38.17" x2="67.5" y2="38.17"/>
    <circle cx="34" cy="38.17" r="9.15"/>
    <circle cx="34" cy="38.17" r="0.5" class="board-dot"/>
    <rect x="13.84" y="74.17" width="40.32" height="16.5"/>
    <rect x="24.84" y="85.17" width="18.32" height="5.5"/>
    <circle cx="34" cy="79.67" r="0.5" class="board-dot"/>
    <path d="M26.69 74.17A9.15 9.15 0 0 1 41.31 74.17"/>
    <path d="M0.5 89.17A1 1 0 0 0 1.5 90.17M66.5 90.17A1 1 0 0 0 67.5 89.17"/>
  </g>
</svg>`;

const SHIRT = `
<svg class="shirt" viewBox="0 0 40 40" aria-hidden="true">
  <path d="M15 3 9 5.5 2 12l5 6 4-3v22h18V15l4 3 5-6-7-6.5L25 3c-1.2 2.6-2.9 4-5 4s-3.8-1.4-5-4Z"/>
</svg>`;

export function shortName(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

export function formationSpots(game, team) {
  return session.meta.formations[game.format][game.formations[team]];
}

// canTap(index, player) decides which spots respond; onTap(index, player)
// handles a tap.
export function lineupBoard({ game, team, selectedId = null, canTap, onTap }) {
  const players = new Map(game.teams[team].map((p) => [p.slot, p]));
  const me = session.user ? session.user.id : null;
  const isWinner = game.result && game.result.status === 'confirmed' && game.result.winner === team;

  const spots = formationSpots(game, team).map((spot, index) => {
    const player = players.get(index) || null;
    const classes = ['spot'];
    if (!player) classes.push('is-open');
    if (player && player.id === me) classes.push('is-me');
    if (player && player.id === selectedId) classes.push('is-selected');
    const label = player
      ? `${spot.pos}: ${player.displayName}${player.isCaptain ? ', captain' : ''}${player.id === me ? ' (you)' : ''}`
      : `${spot.pos}: open spot`;
    const button = h(
      'button',
      {
        type: 'button',
        class: classes.join(' '),
        'aria-label': label,
        title: player ? player.displayName : 'Open spot',
        disabled: !canTap(index, player),
        onClick: () => onTap(index, player),
      },
      h('span', { class: 'spot-pos' }, spot.pos),
      h(
        'span',
        { class: 'spot-kit' },
        staticHtml(SHIRT),
        h('span', { class: 'spot-initials' }, player ? initials(player.displayName) : '+'),
        player && player.isCaptain ? h('span', { class: 'spot-captain', 'aria-hidden': 'true' }, 'C') : null,
      ),
      h('span', { class: 'spot-name' }, player ? shortName(player.displayName) : 'Open'),
    );
    button.style.left = `${spot.x}%`;
    button.style.top = `${spot.y}%`;
    return button;
  });

  return h(
    'div',
    { class: `lineup-board kit-${team.toLowerCase()}${isWinner ? ' is-winner' : ''}`, role: 'group', 'aria-label': `Team ${team} lineup` },
    staticHtml(BOARD_LINES),
    spots,
  );
}
