import { api } from '../api.js';
import { session } from '../session.js';
import { gameCard } from '../cards.js';
import { pitch } from '../pitch.js';
import { createMap, dot, fitTo, mapsAvailable, searchPlaces, currentPosition, FORMAT_COLORS } from '../map.js';
import { h, icon, loading, emptyState, loadPref, savePref, toast } from '../ui.js';

const RADII = [5, 10, 25, 50, 100];
const DEFAULTS = { format: 'all', type: 'all', radius: 25, mode: 'list', origin: null };

export async function renderFind(view, ctx) {
  const prefs = { ...DEFAULTS, ...loadPref('find', {}) };
  if (!prefs.origin && session.user && session.user.homeLat !== null) {
    prefs.origin = { lat: session.user.homeLat, lng: session.user.homeLng, label: 'your home area' };
  }

  const results = h('section', { class: 'results', 'aria-live': 'polite' });
  const locationStatus = h('div', { class: 'location-status' });
  const searchInput = h('input', {
    type: 'search',
    name: 'place',
    placeholder: 'City, neighborhood, or ZIP',
    'aria-label': 'Search for a place',
    autocomplete: 'off',
  });

  const formatButtons = [
    { id: 'all', label: 'All games', sub: 'Every format' },
    ...session.meta.formats.map((f) => ({ id: f.id, label: f.label, sub: f.area })),
  ].map((f) =>
    h(
      'button',
      { type: 'button', class: 'format-option', 'data-format': f.id, onClick: () => update({ format: f.id }) },
      f.id === 'all' ? h('span', { class: 'format-all' }, icon('ball', { size: 28 })) : pitch(f.id, { mini: true }),
      h('span', { class: 'format-name' }, f.label),
      h('span', { class: 'format-sub' }, f.sub),
    ),
  );

  const typeButtons = [
    ['all', 'All'],
    ['casual', 'Casual'],
    ['wager', 'Wager matches'],
  ].map(([id, label]) =>
    h('button', { type: 'button', 'data-type': id, onClick: () => update({ type: id }) }, id === 'wager' ? icon('coin', { size: 16 }) : null, label),
  );

  const modeButtons = [
    ['list', 'List', 'list'],
    ['map', 'Map', 'map'],
  ].map(([id, label, iconName]) =>
    h('button', { type: 'button', 'data-mode': id, onClick: () => update({ mode: id }) }, icon(iconName, { size: 16 }), label),
  );

  const searchForm = h(
    'form',
    { class: 'place-search', role: 'search' },
    icon('search'),
    searchInput,
    h('button', { type: 'submit', class: 'btn btn-small' }, 'Search'),
  );
  searchForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = searchInput.value.trim();
    if (!query) return;
    try {
      const [place] = await searchPlaces(query);
      if (!place) {
        toast(`Couldn't find "${query}"`, 'error');
        return;
      }
      update({ origin: { lat: place.lat, lng: place.lng, label: place.shortLabel } });
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const nearMe = h(
    'button',
    { type: 'button', class: 'btn btn-light' },
    icon('locate'),
    'Near me',
  );
  nearMe.addEventListener('click', async () => {
    nearMe.disabled = true;
    try {
      const position = await currentPosition();
      update({ origin: { ...position, label: 'your location' } });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      nearMe.disabled = false;
    }
  });

  const root = h(
    'div',
    { class: 'find' },
    h(
      'section',
      { class: 'hero' },
      h('h1', {}, 'Find a pickup game'),
      h('p', { class: 'hero-sub' }, '3v3 in the box, 8v8 on half the field, or the full 11v11 — near you.'),
      h('div', { class: 'location-bar' }, nearMe, searchForm),
      locationStatus,
    ),
    h('div', { class: 'format-picker', role: 'group', 'aria-label': 'Format' }, formatButtons),
    h(
      'div',
      { class: 'filter-row' },
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'Game type' }, typeButtons),
      h('div', { class: 'segmented', role: 'group', 'aria-label': 'View' }, modeButtons),
    ),
    results,
  );
  if (!ctx.mount(root)) return;

  let requestId = 0;
  await refresh();

  function update(changes) {
    Object.assign(prefs, changes);
    refresh();
  }

  function syncControls() {
    for (const b of formatButtons) b.setAttribute('aria-pressed', String(b.dataset.format === prefs.format));
    for (const b of typeButtons) b.setAttribute('aria-pressed', String(b.dataset.type === prefs.type));
    for (const b of modeButtons) b.setAttribute('aria-pressed', String(b.dataset.mode === prefs.mode));

    if (!prefs.origin) {
      locationStatus.replaceChildren(
        icon('pin', { size: 16 }),
        h('span', {}, 'Showing games everywhere. Use your location or search to see what’s close.'),
      );
      return;
    }
    const radius = h(
      'select',
      { 'aria-label': 'Distance', value: String(prefs.radius) },
      RADII.map((r) => h('option', { value: String(r) }, `${r} miles`)),
    );
    radius.addEventListener('change', () => update({ radius: Number(radius.value) }));
    locationStatus.replaceChildren(
      icon('pin', { size: 16 }),
      'Within ',
      radius,
      ' of ',
      h('strong', {}, prefs.origin.label),
      h('button', { type: 'button', class: 'link-button', onClick: () => update({ origin: null }) }, 'Clear'),
    );
  }

  async function refresh() {
    savePref('find', prefs);
    syncControls();
    const id = ++requestId;
    const params = new URLSearchParams();
    if (prefs.format !== 'all') params.set('format', prefs.format);
    if (prefs.type !== 'all') params.set('type', prefs.type);
    if (prefs.origin) {
      params.set('lat', prefs.origin.lat);
      params.set('lng', prefs.origin.lng);
      params.set('radiusMiles', prefs.radius);
    }
    results.replaceChildren(loading('Finding games…'));
    try {
      const { games } = await api.get(`/games?${params}`);
      if (id === requestId && ctx.isCurrent()) showResults(games);
    } catch (err) {
      if (id === requestId) results.replaceChildren(emptyState("Couldn't load games", err.message));
    }
  }

  function showResults(games) {
    if (games.length === 0) {
      results.replaceChildren(
        emptyState(
          'No games match yet',
          prefs.origin ? 'Try a bigger distance or another format — or start one yourself.' : 'Be the first to put a game on the calendar.',
          h('a', { class: 'btn btn-primary', href: '#/host' }, icon('plus'), 'Host a game'),
        ),
      );
      return;
    }
    const count = h('p', { class: 'results-count' }, `${games.length} game${games.length === 1 ? '' : 's'}`);
    if (prefs.mode === 'map' && mapsAvailable()) {
      const mapEl = h('div', { class: 'map map-large' });
      results.replaceChildren(count, mapEl, legend());
      const map = createMap(mapEl, prefs.origin);
      for (const game of games) {
        dot(map, game, { color: FORMAT_COLORS[game.format], title: `${game.format} · ${game.title}` }).on('click', () =>
          ctx.navigate(`/game/${game.id}`),
        );
      }
      if (prefs.origin) dot(map, prefs.origin, { color: '#15201a', radius: 6, title: 'You are here' });
      fitTo(map, prefs.origin ? [prefs.origin, ...games] : games);
      return;
    }
    const fallbackNote = h('p', { class: 'muted' }, 'The map could not load, so here is the list.');
    results.replaceChildren(
      ...[count, prefs.mode === 'map' ? fallbackNote : null, h('div', { class: 'card-grid' }, games.map(gameCard))].filter(Boolean),
    );
  }
}

function legend() {
  return h(
    'div',
    { class: 'map-legend' },
    Object.entries(FORMAT_COLORS).map(([format, color]) => {
      const swatch = h('span', { class: 'swatch' });
      swatch.style.background = color;
      return h('span', {}, swatch, format);
    }),
  );
}
