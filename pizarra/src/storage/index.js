// The storage interface.
//
// Components call getVocab() / saveVocab() and friends; nothing else in the
// app knows where the data actually lives. Today that's a JSON file on disk,
// reached over /api. Pointing this at a shared backend later means editing
// this file and the server, not the views.

export const USER_ID = 'default';

const BASE = '/api';

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'X-User-Id': USER_ID,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).error || detail;
    } catch {
      /* keep statusText */
    }
    throw new Error(`${method} ${path} failed: ${detail}`);
  }
  return res.json();
}

/** Stamps records with the current user before they go to storage. */
function withUser(records) {
  return records.map((r) => ({ ...r, userId: r.userId || USER_ID }));
}

export function getVocab() {
  return request('/vocab');
}

export function saveVocab(vocab) {
  return request('/vocab', { method: 'PUT', body: withUser(vocab) });
}

export function getGrammarScores() {
  return request('/grammar-scores');
}

export function saveGrammarScores(scores) {
  return request('/grammar-scores', { method: 'PUT', body: withUser(scores) });
}

/** One round trip on startup instead of two. */
export function getAll() {
  return request('/state');
}
