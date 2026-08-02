/**
 * Data-access layer (spec §2).
 *
 * Every read and write in the app goes through this module — no component ever
 * touches `localStorage`. The API is async on purpose: a network-backed
 * implementation can replace the body of these methods without a single call
 * site changing. Records carry `id` + `updatedAt` from v1 so a future sync
 * layer has something to resolve conflicts on.
 *
 * Reads are served from an in-memory cache so rendering stays synchronous;
 * writes are write-through with a short debounce (spec §4.1: autosave, no
 * save button).
 */

import { now } from './id.js';

const KEYS = {
  lists: 'shoppinglist.lists.v1',
  recipes: 'shoppinglist.recipes.v1',
  customEntries: 'shoppinglist.customEntries.v1',
  settings: 'shoppinglist.settings.v1',
};

const FLUSH_DELAY_MS = 120;

const cache = { lists: [], recipes: [], customEntries: [], settings: {} };
const dirty = new Set();
const listeners = new Set();

let flushTimer = null;
let ready = false;
let storageAvailable = true;

/** Load everything into memory. Safe to call more than once. */
export async function init() {
  if (ready) return snapshot();

  storageAvailable = probeStorage();
  cache.lists = readKey(KEYS.lists, []);
  cache.recipes = readKey(KEYS.recipes, []);
  cache.customEntries = readKey(KEYS.customEntries, []);
  cache.settings = readKey(KEYS.settings, {}, { array: false });
  ready = true;

  // Anything queued while the tab is closing must not be lost.
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushNow);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushNow();
    });
  }

  return snapshot();
}

/** True when persistence is unavailable (private mode, disabled storage). */
export function isEphemeral() {
  return !storageAvailable;
}

// --- Reads -----------------------------------------------------------------

export async function getLists() {
  return clone(cache.lists);
}

export async function getList(id) {
  return clone(cache.lists.find((list) => list.id === id) ?? null);
}

export async function getRecipes() {
  return clone(cache.recipes);
}

export async function getRecipe(id) {
  return clone(cache.recipes.find((recipe) => recipe.id === id) ?? null);
}

export async function getCustomEntries() {
  return clone(cache.customEntries);
}

/**
 * Synchronous view of the whole cache, for render paths. Mutations still go
 * through the async writers above/below — this is read-only by convention.
 */
export function snapshot() {
  return {
    lists: cache.lists,
    recipes: cache.recipes,
    customEntries: cache.customEntries,
    settings: cache.settings,
  };
}

/**
 * Device-level settings (currently just the household code that pairs this
 * device's recipe library and custom items with someone else's).
 */
export function getSetting(key) {
  return cache.settings[key] ?? null;
}

export async function setSetting(key, value) {
  cache.settings = { ...cache.settings, [key]: value };
  queue('settings');
  return value;
}

// --- Writes ----------------------------------------------------------------

export async function saveList(list) {
  const record = { ...clone(list), updatedAt: now() };
  upsert(cache.lists, record);
  queue('lists');
  return record;
}

export async function deleteList(id) {
  remove(cache.lists, id);
  queue('lists');
}

export async function saveRecipe(recipe) {
  const record = { ...clone(recipe), updatedAt: now() };
  upsert(cache.recipes, record);
  queue('recipes');
  return record;
}

/**
 * Tombstoned, not removed: a paired device has to learn the recipe is gone,
 * otherwise its copy pushes it straight back.
 */
export async function deleteRecipe(id) {
  tombstone(cache.recipes, id);
  queue('recipes');
}

export async function saveCustomEntry(entry) {
  const record = { ...clone(entry), updatedAt: now() };
  upsert(cache.customEntries, record);
  queue('customEntries');
  return record;
}

export async function deleteCustomEntry(id) {
  tombstone(cache.customEntries, id);
  queue('customEntries');
}

/** Wipe all local data (used by the "reset" action in settings). */
export async function clearAll() {
  cache.lists = [];
  cache.recipes = [];
  cache.customEntries = [];
  cache.settings = {};
  queue('lists', 'recipes', 'customEntries', 'settings');
}

// --- Change notification ---------------------------------------------------

/**
 * Subscribe to any mutation. The listener receives the snapshot plus the set
 * of collection names that changed. Returns an unsubscribe function.
 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(changed) {
  for (const listener of listeners) listener(snapshot(), changed);
}

// --- Internals -------------------------------------------------------------

function upsert(collection, record) {
  const index = collection.findIndex((existing) => existing.id === record.id);
  if (index === -1) collection.push(record);
  else collection[index] = record;
}

function remove(collection, id) {
  const index = collection.findIndex((existing) => existing.id === id);
  if (index !== -1) collection.splice(index, 1);
}

function tombstone(collection, id) {
  const record = collection.find((existing) => existing.id === id);
  if (record) {
    record.deleted = true;
    record.updatedAt = now();
  }
}

function queue(...names) {
  for (const name of names) dirty.add(name);
  notify(new Set(names));
  if (flushTimer !== null) return;
  flushTimer = setTimeout(flushNow, FLUSH_DELAY_MS);
}

/** Force pending writes to storage immediately. */
export function flushNow() {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  for (const name of dirty) writeKey(KEYS[name], cache[name]);
  dirty.clear();
}

function probeStorage() {
  try {
    const probe = '__shoppinglist_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

function readKey(key, fallback, { array = true } = {}) {
  if (!storageAvailable) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (array) return Array.isArray(parsed) ? parsed : fallback;
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeKey(key, value) {
  if (!storageAvailable) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Quota exhausted or storage revoked mid-session: keep running in memory
    // rather than losing the user's in-progress list to an exception.
    storageAvailable = false;
    console.warn('Shopping list: storage write failed, continuing in memory.', error);
  }
}

function clone(value) {
  if (value === null || value === undefined) return value;
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
