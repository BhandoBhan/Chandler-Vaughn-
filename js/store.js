// Persistence layer backed by localStorage. Everything stays on the device.
import { DEFAULT_PLATFORMS } from './calc.js';

const ITEMS_KEY = 'vr.items.v1';
const SETTINGS_KEY = 'vr.settings.v1';

export const DEFAULT_SETTINGS = {
  businessName: 'My Vintage Shop',
  currency: 'USD',
  skuPrefix: 'VTG',
  staleDays: 90,
  defaultTargetProfit: 20,
  platforms: DEFAULT_PLATFORMS,
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.error(err);
    alert('Could not save — browser storage is full. Try removing some photos or exporting a backup.');
    return false;
  }
}

export function uid() {
  if (globalThis.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function loadItems() {
  return read(ITEMS_KEY, []);
}

export function saveItems(items) {
  return write(ITEMS_KEY, items);
}

export function loadSettings() {
  const saved = read(SETTINGS_KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    platforms: { ...DEFAULT_PLATFORMS, ...(saved.platforms || {}) },
  };
}

export function saveSettings(settings) {
  return write(SETTINGS_KEY, settings);
}

export function exportBackup() {
  return JSON.stringify({ app: 'vintage-resellers', version: 1, exportedAt: new Date().toISOString(), items: loadItems(), settings: loadSettings() }, null, 2);
}

export function importBackup(json) {
  const data = JSON.parse(json);
  if (!data || !Array.isArray(data.items)) throw new Error('Not a valid backup file.');
  saveItems(data.items);
  if (data.settings) saveSettings(data.settings);
  return data.items.length;
}
