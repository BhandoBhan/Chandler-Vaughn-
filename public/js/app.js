import { session, loadSession, onSessionChange } from './session.js';
import { h, icon, money, loading, emptyState } from './ui.js';
import { renderFind } from './views/find.js';
import { renderGame } from './views/game.js';
import { renderHost } from './views/host.js';
import { renderWallet } from './views/wallet.js';
import { renderProfile } from './views/profile.js';
import { renderLogin, renderSignup } from './views/auth.js';
import { renderAdmin } from './views/admin.js';

const ROUTES = [
  { pattern: /^\/$/, render: renderFind, tab: 'find' },
  { pattern: /^\/game\/(\d+)$/, render: renderGame, tab: 'find' },
  { pattern: /^\/host$/, render: renderHost, tab: 'host', auth: true },
  { pattern: /^\/wallet$/, render: renderWallet, tab: 'wallet', auth: true },
  { pattern: /^\/me$/, render: renderProfile, tab: 'me', auth: true },
  { pattern: /^\/admin$/, render: renderAdmin, tab: 'admin', auth: true },
  { pattern: /^\/login$/, render: renderLogin, tab: 'me' },
  { pattern: /^\/signup$/, render: renderSignup, tab: 'me' },
];

const view = document.getElementById('view');
let renderCount = 0;
let activeTab = 'find';

function navigate(path) {
  if (`#${path}` === window.location.hash) route();
  else window.location.hash = path;
}

function currentPath() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [path, query = ''] = raw.split('?');
  return { path, query: new URLSearchParams(query), raw };
}

async function route() {
  const { path, query, raw } = currentPath();
  const id = ++renderCount;
  const match = ROUTES.map((r) => ({ r, m: r.pattern.exec(path) })).find((x) => x.m);
  if (!match) {
    view.replaceChildren(emptyState('Page not found', null, h('a', { class: 'btn btn-primary', href: '#/' }, 'Find games')));
    return;
  }
  const { r, m } = match;
  activeTab = r.tab;
  renderNav();
  if (r.auth && !session.user) {
    navigate(`/login?next=${encodeURIComponent(raw)}`);
    return;
  }

  const ctx = {
    params: m.slice(1),
    query,
    navigate,
    isCurrent: () => id === renderCount,
    // Shows a view's content unless the user has already moved on.
    mount(node) {
      if (id !== renderCount) return false;
      view.replaceChildren(node);
      return true;
    },
  };
  view.replaceChildren(loading());
  window.scrollTo(0, 0);
  try {
    await r.render(view, ctx);
  } catch (err) {
    ctx.mount(emptyState('Something went wrong', err.message, h('a', { class: 'btn btn-light', href: '#/' }, 'Back to games')));
  }
}

function navItems() {
  const items = [
    { tab: 'find', href: '#/', label: 'Find', icon: 'search' },
    { tab: 'host', href: '#/host', label: 'Host', icon: 'plus' },
    { tab: 'wallet', href: '#/wallet', label: 'Wallet', icon: 'wallet' },
    { tab: 'me', href: session.user ? '#/me' : '#/login', label: session.user ? 'Me' : 'Log in', icon: 'user' },
  ];
  if (session.user && session.user.isAdmin) items.push({ tab: 'admin', href: '#/admin', label: 'Admin', icon: 'shield' });
  return items;
}

function renderNav() {
  const links = (cls) =>
    navItems().map((item) =>
      h(
        'a',
        { class: cls, href: item.href, 'aria-current': item.tab === activeTab ? 'page' : null },
        icon(item.icon, { size: cls === 'tab' ? 22 : 18 }),
        h('span', {}, item.label),
      ),
    );
  document.getElementById('topnav').replaceChildren(...links('topnav-link'));
  document.getElementById('tabbar').replaceChildren(...links('tab'));
  document
    .getElementById('account')
    .replaceChildren(
      session.user
        ? h('a', { class: 'balance-chip', href: '#/wallet', title: 'Wallet balance' }, icon('wallet', { size: 16 }), money(session.user.balanceCents))
        : h('a', { class: 'btn btn-small btn-primary', href: '#/signup' }, 'Sign up'),
    );
}

async function start() {
  view.replaceChildren(loading());
  try {
    await loadSession();
  } catch (err) {
    view.replaceChildren(emptyState("Can't reach the server", err.message));
    return;
  }
  onSessionChange(renderNav);
  window.addEventListener('hashchange', route);
  route();
}

start();
