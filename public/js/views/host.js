import { api } from '../api.js';
import { session, refreshUser } from '../session.js';
import { pitch } from '../pitch.js';
import { createMap, dot, searchPlaces, currentPosition } from '../map.js';
import { h, icon, money, field, bindForm, formError, toast, loadPref, previewPayout, SKILL_LABELS } from '../ui.js';

const DURATIONS = [45, 60, 90, 120, 150, 180];

function tomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function renderHost(view, ctx) {
  const { formats, skillLevels, wagers } = session.meta;
  const user = session.user;
  const wagerBlocked = user.wagerBlockedReason;
  const lastOrigin = loadPref('find', {}).origin;
  // Where the map starts; the game's own location stays unset until the host picks it.
  const mapCenter = user.homeLat !== null ? { lat: user.homeLat, lng: user.homeLng } : lastOrigin || null;
  let location = null;
  let map = null;
  let marker = null;

  const formatChoice = h(
    'div',
    { class: 'choice-grid', role: 'radiogroup', 'aria-label': 'Format' },
    formats.map((f, i) =>
      h(
        'label',
        { class: 'choice' },
        h('input', { type: 'radio', name: 'format', value: f.id, checked: i === 0 }),
        pitch(f.id, { mini: true }),
        h('span', { class: 'choice-title' }, f.label),
        h('span', { class: 'choice-sub' }, `${f.area} · ${f.playersPerTeam * 2} players`),
      ),
    ),
  );

  const entryFee = h('input', { type: 'number', name: 'entryFee', min: wagers.minEntryFeeCents / 100, max: wagers.maxEntryFeeCents / 100, step: 1, value: '10', inputmode: 'decimal' });
  const prizePreview = h('p', { class: 'prize-preview' });
  const wagerFields = h(
    'div',
    { class: 'wager-fields', hidden: true },
    field(
      'Entry fee per player ($)',
      entryFee,
      `Between ${money(wagers.minEntryFeeCents)} and ${money(wagers.maxEntryFeeCents)}. Held in escrow until the result is confirmed.`,
    ),
    prizePreview,
  );

  const typeChoice = h(
    'div',
    { class: 'choice-grid choice-grid-2', role: 'radiogroup', 'aria-label': 'Game type' },
    h(
      'label',
      { class: 'choice' },
      h('input', { type: 'radio', name: 'type', value: 'casual', checked: true }),
      h('span', { class: 'choice-icon' }, icon('ball', { size: 26 })),
      h('span', { class: 'choice-title' }, 'Casual'),
      h('span', { class: 'choice-sub' }, 'Free to play, just show up'),
    ),
    h(
      'label',
      { class: `choice${wagerBlocked ? ' is-disabled' : ''}` },
      h('input', { type: 'radio', name: 'type', value: 'wager', disabled: Boolean(wagerBlocked) }),
      h('span', { class: 'choice-icon choice-icon-wager' }, icon('coin', { size: 26 })),
      h('span', { class: 'choice-title' }, 'Wager match'),
      h('span', { class: 'choice-sub' }, 'Everyone pays in, winners split the pot'),
    ),
  );

  const placeQuery = h('input', { type: 'search', placeholder: 'Search an address or park', 'aria-label': 'Search an address or park' });
  const placeResults = h('ul', { class: 'place-results', hidden: true });
  const locationNote = h('p', { class: 'field-hint location-note' });
  const mapEl = h('div', { class: 'map map-picker' });
  const addressInput = h('input', { type: 'text', name: 'address', maxlength: 200, placeholder: 'Street address (optional)' });
  const joinBox = h('input', { type: 'checkbox', name: 'joinAsPlayer', checked: true });
  const joinLabel = h('span', {}, "I'm playing — put me on Team A");

  function setLocation(next, { pan = true } = {}) {
    location = next;
    locationNote.textContent = `Pin set at ${next.lat.toFixed(5)}, ${next.lng.toFixed(5)}`;
    if (map) {
      if (marker) marker.remove();
      marker = dot(map, next, { title: 'Game location' });
      if (pan) map.setView([next.lat, next.lng], Math.max(map.getZoom(), 15));
    }
  }

  async function runPlaceSearch() {
    const query = placeQuery.value.trim();
    if (!query) return;
    try {
      const places = await searchPlaces(query);
      placeResults.hidden = false;
      if (places.length === 0) {
        placeResults.replaceChildren(h('li', { class: 'muted' }, 'No matches — try a different search or tap the map.'));
        return;
      }
      placeResults.replaceChildren(
        ...places.map((place) =>
          h(
            'li',
            {},
            h(
              'button',
              {
                type: 'button',
                onClick: () => {
                  setLocation(place);
                  if (!addressInput.value) addressInput.value = place.label.slice(0, 200);
                  placeResults.hidden = true;
                },
              },
              place.label,
            ),
          ),
        ),
      );
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const form = h(
    'form',
    { class: 'host-form', novalidate: true },
    h('section', { class: 'card' }, h('h2', {}, '1. Pick a format'), formatChoice),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '2. Casual or wager?'),
      typeChoice,
      wagerBlocked ? h('p', { class: 'join-help' }, icon('lock', { size: 15 }), wagerBlocked, ' — ', h('a', { href: '#/me' }, 'Update profile')) : null,
      wagerFields,
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '3. When'),
      h(
        'div',
        { class: 'field-row' },
        field('Date', h('input', { type: 'date', name: 'date', required: true, value: tomorrowDate() })),
        field('Start time', h('input', { type: 'time', name: 'time', required: true, value: '18:00' })),
        field(
          'Length',
          h('select', { name: 'duration', value: '60' }, DURATIONS.map((m) => h('option', { value: String(m) }, `${m} min`))),
        ),
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '4. Where'),
      field('Field or park name', h('input', { type: 'text', name: 'venueName', required: true, minlength: 2, maxlength: 100, placeholder: 'e.g. Riverside Park, Field 2' })),
      h(
        'div',
        { class: 'place-picker' },
        h('div', { class: 'place-search' }, icon('search'), placeQuery, h('button', { type: 'button', class: 'btn btn-small', onClick: runPlaceSearch }, 'Find')),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-light btn-small',
            onClick: async () => {
              try {
                setLocation(await currentPosition());
              } catch (err) {
                toast(err.message, 'error');
              }
            },
          },
          icon('locate', { size: 16 }),
          "I'm at the field",
        ),
      ),
      placeResults,
      mapEl,
      locationNote,
      field('Address', addressInput),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', {}, '5. Details'),
      field('Title', h('input', { type: 'text', name: 'title', maxlength: 80, placeholder: 'e.g. Thursday night 3v3' }), 'Leave blank to name it after the format and field.'),
      field('Skill level', h('select', { name: 'skillLevel', value: 'any' }, skillLevels.map((s) => h('option', { value: s }, SKILL_LABELS[s])))),
      field('Notes for players', h('textarea', { name: 'notes', rows: 3, maxlength: 500, placeholder: 'Shirt colors, parking, bring a ball…' })),
      h('label', { class: 'checkbox' }, joinBox, joinLabel),
    ),
    formError(),
    h('button', { type: 'submit', class: 'btn btn-primary btn-large' }, icon('plus'), 'Create game'),
  );

  function selected(name) {
    return form.querySelector(`input[name="${name}"]:checked`).value;
  }

  function updateWagerPreview() {
    const isWager = selected('type') === 'wager';
    wagerFields.hidden = !isWager;
    const format = formats.find((f) => f.id === selected('format'));
    const feeCents = Math.round(Number(entryFee.value || 0) * 100);
    const payout = previewPayout(feeCents, format.playersPerTeam, wagers.platformFeePercent);
    prizePreview.replaceChildren(
      `${format.playersPerTeam * 2} players × ${money(feeCents)} = ${money(payout.potCents)} pot. `,
      h('strong', {}, `Each winner gets ${money(payout.perWinnerCents)}`),
      wagers.platformFeePercent > 0 ? ` after the ${wagers.platformFeePercent}% platform fee.` : '.',
    );
    joinLabel.textContent = isWager
      ? `I'm playing — put me on Team A and pay my ${money(feeCents)} entry now`
      : "I'm playing — put me on Team A";
  }
  form.addEventListener('change', updateWagerPreview);
  entryFee.addEventListener('input', updateWagerPreview);
  placeQuery.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runPlaceSearch();
    }
  });

  bindForm(form, async (data) => {
    if (!location) throw new Error('Set the field location: search for it, tap the map, or use "I\'m at the field".');
    const date = data.get('date');
    const time = data.get('time');
    if (!date || !time) throw new Error('Pick a date and start time');
    const startsAt = new Date(`${date}T${time}`);
    if (Number.isNaN(startsAt.getTime())) throw new Error('That date or time is not valid');
    const isWager = data.get('type') === 'wager';
    const body = {
      format: data.get('format'),
      title: data.get('title'),
      startsAt: startsAt.toISOString(),
      durationMinutes: Number(data.get('duration')),
      venueName: data.get('venueName'),
      address: data.get('address'),
      lat: location.lat,
      lng: location.lng,
      skillLevel: data.get('skillLevel'),
      notes: data.get('notes'),
      isWager,
      entryFeeCents: isWager ? Math.round(Number(data.get('entryFee')) * 100) : undefined,
      joinAsPlayer: data.get('joinAsPlayer') === 'on',
    };
    const { game } = await api.post('/games', body);
    if (isWager) await refreshUser();
    toast('Game created — share it with your crew!', 'success');
    ctx.navigate(`/game/${game.id}`);
  });

  const root = h(
    'div',
    { class: 'host' },
    h('h1', {}, 'Host a game'),
    h('p', { class: 'muted' }, 'Put a game on the map and let players near you join.'),
    form,
  );
  if (!ctx.mount(root)) return;
  updateWagerPreview();

  map = createMap(mapEl, mapCenter, 13);
  if (map) {
    map.on('click', (event) => setLocation({ lat: event.latlng.lat, lng: event.latlng.lng }, { pan: false }));
    locationNote.textContent = 'Search for the field, or tap the map to drop a pin.';
  } else {
    mapEl.remove();
    locationNote.textContent = 'Search for the field or use "I\'m at the field" to set its location.';
  }
}
