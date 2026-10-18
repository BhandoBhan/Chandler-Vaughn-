import { api, setToken, hasToken, handleUnauthorized } from './api.js';

// The signed-in player (or null) and app-wide settings from the server.
export const session = { user: null, meta: null };

const listeners = new Set();

export function onSessionChange(fn) {
  listeners.add(fn);
}

function emit() {
  for (const fn of listeners) fn(session);
}

handleUnauthorized(() => {
  session.user = null;
  emit();
});

export async function loadSession() {
  session.meta = await api.get('/formats');
  if (hasToken()) {
    try {
      session.user = (await api.get('/me')).user;
    } catch (err) {
      if (err.status !== 401) throw err;
    }
  }
  emit();
}

export function signIn({ token, user }) {
  setToken(token);
  session.user = user;
  emit();
}

export async function signOut() {
  try {
    await api.post('/auth/logout');
  } catch {
    // Already signed out on the server.
  }
  setToken(null);
  session.user = null;
  emit();
}

export function setUser(user) {
  session.user = user;
  emit();
}

export async function refreshUser() {
  if (!hasToken()) return null;
  setUser((await api.get('/me')).user);
  return session.user;
}

export function formatInfo(id) {
  return session.meta.formats.find((f) => f.id === id);
}
