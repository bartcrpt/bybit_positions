import { DEFAULT_SETTINGS, normalizeSettings } from './settings.js';

export const SETTINGS_KEY = 'settings';
export const CACHE_KEY = 'monitorState';
export const PREVIOUS_POSITIONS_KEY = 'previousPositionKeys';

function storageArea(scope) {
  const area = globalThis.chrome?.storage?.[scope];

  if (!area) {
    throw new Error(`chrome.storage.${scope} is unavailable.`);
  }

  return area;
}

function chromeGet(area, keys) {
  return new Promise((resolve) => {
    area.get(keys, resolve);
  });
}

function chromeSet(area, values) {
  return new Promise((resolve) => {
    area.set(values, resolve);
  });
}

function chromeRemove(area, keys) {
  return new Promise((resolve) => {
    area.remove(keys, resolve);
  });
}

export async function readSettings() {
  const local = storageArea('local');
  const result = await chromeGet(local, [SETTINGS_KEY]);
  return normalizeSettings(result[SETTINGS_KEY] ?? DEFAULT_SETTINGS);
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await chromeSet(storageArea('local'), { [SETTINGS_KEY]: normalized });
  return normalized;
}

export async function readCachedState() {
  const session = storageArea('session');
  const result = await chromeGet(session, [CACHE_KEY]);
  return result[CACHE_KEY] ?? null;
}

export async function saveCachedState(state) {
  await chromeSet(storageArea('session'), { [CACHE_KEY]: state });
  return state;
}

export function clearCachedState() {
  return chromeRemove(storageArea('session'), [CACHE_KEY]);
}

export async function readPreviousPositionKeys() {
  const result = await chromeGet(storageArea('local'), [PREVIOUS_POSITIONS_KEY]);
  return result[PREVIOUS_POSITIONS_KEY] ?? [];
}

export async function savePreviousPositionKeys(keys) {
  await chromeSet(storageArea('local'), { [PREVIOUS_POSITIONS_KEY]: keys });
}
