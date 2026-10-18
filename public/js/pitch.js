import { staticHtml } from './ui.js';

// Pitch diagrams in metres (105 × 68) showing where each format is played.
const ZONES = {
  '3v3': { x: 0, y: 13.84, w: 16.5, h: 40.32, label: 'inside the 18-yard box' },
  '8v8': { x: 0, y: 0, w: 52.5, h: 68, label: 'on half the field' },
  '11v11': { x: 0, y: 0, w: 105, h: 68, label: 'on the full field' },
};

const LINES = `
  <rect x="0" y="0" width="105" height="68"/>
  <line x1="52.5" y1="0" x2="52.5" y2="68"/>
  <circle cx="52.5" cy="34" r="9.15"/>
  <rect x="0" y="13.84" width="16.5" height="40.32"/>
  <rect x="0" y="24.84" width="5.5" height="18.32"/>
  <rect x="88.5" y="13.84" width="16.5" height="40.32"/>
  <rect x="99.5" y="24.84" width="5.5" height="18.32"/>
  <path d="M16.5 26.69A9.15 9.15 0 0 1 16.5 41.31"/>
  <path d="M88.5 26.69A9.15 9.15 0 0 0 88.5 41.31"/>
  <rect x="-2" y="30.34" width="2" height="7.32"/>
  <rect x="105" y="30.34" width="2" height="7.32"/>`;

const STRIPES = Array.from({ length: 5 }, (_, i) => `<rect x="${i * 21 + 10.5}" y="0" width="10.5" height="68"/>`).join('');

export function zoneLabel(format) {
  return ZONES[format].label;
}

export function pitch(format, { mini = false } = {}) {
  const z = ZONES[format];
  const dim = `M0 0H105V68H0Z M${z.x} ${z.y}v${z.h}h${z.w}v${-z.h}Z`;
  return staticHtml(`
    <svg class="pitch${mini ? ' pitch-mini' : ''}" viewBox="-4 -4 113 76" role="img" aria-label="${format} is played ${z.label}">
      <rect class="pitch-grass" x="-4" y="-4" width="113" height="76" rx="3"/>
      <g class="pitch-stripes">${STRIPES}</g>
      ${format === '11v11' ? '' : `<path class="pitch-dim" fill-rule="evenodd" d="${dim}"/>`}
      <rect class="pitch-zone" x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}"/>
      <g class="pitch-lines">${LINES}</g>
    </svg>`);
}
