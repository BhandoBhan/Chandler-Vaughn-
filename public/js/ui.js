// Small DOM helpers. Everything user-supplied goes through text nodes, never
// innerHTML; staticHtml() is only for markup written in this codebase.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [key, val] of Object.entries(props || {})) {
    if (val === null || val === undefined || val === false) continue;
    if (key === 'class') el.className = val;
    else if (key === 'value') value = val;
    else if (key.startsWith('on') && typeof val === 'function') el.addEventListener(key.slice(2).toLowerCase(), val);
    else if (val === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(val));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  // Set after children so <select> options exist first.
  if (value !== undefined) el.value = value;
  return el;
}

export function staticHtml(markup) {
  const template = document.createElement('template');
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

const ICONS = {
  calendar: '<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21.5s7-6.1 7-11.5a7 7 0 1 0-14 0c0 5.4 7 11.5 7 11.5z"/><circle cx="12" cy="10" r="2.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="m12 7.5 4 2.9-1.5 4.6h-5L8 10.4z"/><path d="M12 7.5V3.2M16 10.4l4-1.3M14.5 15l2.5 3.4M9.5 15 7 18.4M8 10.4 4 9.1"/>',
  shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  navigate: '<path d="m3 11 18-8-8 18-2-8z"/>',
  coin: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6.5V8M12 16v1.5"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};

export function icon(name, { size = 18 } = {}) {
  return staticHtml(
    `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`,
  );
}

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export function money(cents) {
  return currency.format(cents / 100);
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const fullFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function dayLabel(iso) {
  const date = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (sameDay(date, today)) return 'Today';
  if (sameDay(date, tomorrow)) return 'Tomorrow';
  return dayFormat.format(date);
}

export function timeLabel(iso) {
  return timeFormat.format(new Date(iso));
}

export function whenLabel(iso) {
  return `${dayLabel(iso)} · ${timeLabel(iso)}`;
}

export function fullDateLabel(iso) {
  return fullFormat.format(new Date(iso));
}

export const SKILL_LABELS = {
  any: 'All levels',
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const PHASE_LABELS = {
  upcoming: 'Upcoming',
  live: 'Live now',
  finished: 'Awaiting score',
  completed: 'Final',
  cancelled: 'Cancelled',
};

export function formatBadge(format) {
  return h('span', { class: `badge fmt fmt-${format}` }, format);
}

export function phaseBadge(phase) {
  return h('span', { class: `badge phase phase-${phase}` }, PHASE_LABELS[phase]);
}

export function avatar(name) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase();
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return h('span', { class: `avatar hue-${hash % 8}`, 'aria-hidden': 'true' }, initials);
}

let toastTimer;
export function toast(message, kind = 'info') {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast show toast-${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
  }, 4000);
}

// A button that runs an async action, stays disabled while it runs, and
// reports failures as a toast.
export function actionButton(label, action, props = {}) {
  const button = h('button', { type: 'button', class: 'btn', ...props }, label);
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.classList.add('busy');
    try {
      await action();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      button.disabled = false;
      button.classList.remove('busy');
    }
  });
  return button;
}

// Wires a form to an async submit handler. Errors show in the form's
// .form-error element.
export function bindForm(form, handler) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = form.querySelector('.form-error');
    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    if (error) error.hidden = true;
    try {
      await handler(new FormData(form));
    } catch (err) {
      if (error) {
        error.textContent = err.message;
        error.hidden = false;
      } else {
        toast(err.message, 'error');
      }
    } finally {
      if (submit) submit.disabled = false;
    }
  });
  return form;
}

export function formError() {
  return h('p', { class: 'form-error', role: 'alert', hidden: true });
}

export function field(label, control, hint) {
  return h(
    'label',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint ? h('span', { class: 'field-hint' }, hint) : null,
  );
}

export function loading(text = 'Loading…') {
  return h('div', { class: 'loading' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text);
}

export function emptyState(title, body, action) {
  return h('div', { class: 'empty' }, icon('ball', { size: 36 }), h('h3', {}, title), body && h('p', {}, body), action);
}

export function loadPref(key, fallback) {
  try {
    const raw = localStorage.getItem(`pickup-soccer-${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key, value) {
  try {
    localStorage.setItem(`pickup-soccer-${key}`, JSON.stringify(value));
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
}

// Payout preview matching the server's math in src/services/wagers.js.
export function previewPayout(entryFeeCents, playersPerTeam, platformFeePercent) {
  const potCents = entryFeeCents * playersPerTeam * 2;
  const prizePoolCents = potCents - Math.round((potCents * platformFeePercent) / 100);
  return { potCents, prizePoolCents, perWinnerCents: Math.floor(prizePoolCents / playersPerTeam) };
}
