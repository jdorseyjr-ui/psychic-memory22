// Storage driver: the browser's own localStorage.
//
// Used for builds that have no node process behind them — a static host, or
// the app opened straight from a phone. The shape stored is the same one the
// file-backed driver writes, so data can be carried between the two by hand.
//
// Storage is per browser and per device: what you learn on your phone stays on
// your phone. Moving to a shared backend later replaces this driver.

import { USER_ID } from './userId.js';

export { USER_ID };

const KEY = 'pizarra.db.v1';

function emptyDb() {
  return { version: 1, vocab: [], grammarScores: [] };
}

// Private browsing and blocked site data both make localStorage throw rather
// than return null, so every access is guarded and falls back to memory. The
// app still works for the session; it just won't be there tomorrow.
let memory = null;

function readDb() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return memory || emptyDb();
    return { ...emptyDb(), ...JSON.parse(raw) };
  } catch {
    return memory || emptyDb();
  }
}

function writeDb(db) {
  memory = db;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(db));
  } catch (err) {
    // Out of quota, or storage disabled. Keep going from memory, but say so
    // rather than pretending the save worked.
    throw new Error('No se pudo guardar en este navegador: ' + err.message);
  }
  return db;
}

function stamp(records) {
  const now = new Date().toISOString();
  return records.map((r) => ({
    ...r,
    userId: r.userId || USER_ID,
    createdAt: r.createdAt || now,
    updatedAt: now,
  }));
}

function mine(records) {
  return (records || []).filter((r) => (r.userId || USER_ID) === USER_ID);
}

export async function getVocab() {
  return mine(readDb().vocab);
}

export async function saveVocab(vocab) {
  const db = readDb();
  const others = (db.vocab || []).filter((r) => (r.userId || USER_ID) !== USER_ID);
  const saved = writeDb({ ...db, vocab: [...others, ...stamp(vocab)] });
  return mine(saved.vocab);
}

export async function getGrammarScores() {
  return mine(readDb().grammarScores);
}

export async function saveGrammarScores(scores) {
  const db = readDb();
  const others = (db.grammarScores || []).filter((r) => (r.userId || USER_ID) !== USER_ID);
  const saved = writeDb({ ...db, grammarScores: [...others, ...stamp(scores)] });
  return mine(saved.grammarScores);
}

export async function getAll() {
  const db = readDb();
  return { userId: USER_ID, vocab: mine(db.vocab), grammarScores: mine(db.grammarScores) };
}
