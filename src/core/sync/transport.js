/**
 * Supabase transport — the only module that talks to the network.
 *
 * Deliberately hand-rolled `fetch` against Supabase's RPC endpoint rather than
 * the official SDK: the app has no build step and no dependencies, and the
 * surface we need is three function calls. Swapping in the SDK later means
 * rewriting this file only.
 *
 * Every method either resolves with data or throws a `SyncError`. Callers use
 * `error.retryable` to decide between backing off and giving up — a dropped
 * signal in a store must not look like a permanent failure.
 */

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config.js';

const REQUEST_TIMEOUT_MS = 10000;

export class SyncError extends Error {
  constructor(message, { retryable = false, status = null, cause = null } = {}) {
    super(message);
    this.name = 'SyncError';
    this.retryable = retryable;
    this.status = status;
    this.cause = cause;
  }
}

/** 128 bits of randomness, base36 — long enough that guessing isn't a threat. */
export function generateShareCode() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('');
}

async function rpc(fn, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    // Offline, DNS failure, or our own timeout — all worth retrying.
    throw new SyncError(`Network request failed (${fn})`, { retryable: true, cause: error });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // 5xx and 429 are transient; 4xx means the request itself is wrong.
    const retryable = response.status >= 500 || response.status === 429;
    throw new SyncError(`Server rejected ${fn}: ${response.status} ${detail}`.trim(), {
      retryable,
      status: response.status,
    });
  }

  if (response.status === 204) return null;
  return response.json().catch(() => null);
}

/** Register a list as shared. Idempotent — safe to call twice. */
export async function createSharedList({ listId, shareCode, name }) {
  await rpc('create_shared_list', {
    p_list_id: listId,
    p_share_code: shareCode,
    p_name: name,
  });
}

/**
 * Fetch the server's copy. Resolves to null when the code is unknown, which
 * is a real answer (bad or revoked link), not an error.
 */
export async function pullList(shareCode) {
  const data = await rpc('pull_list', { p_share_code: shareCode });
  return data ?? null;
}

/**
 * Fetch the paired household's recipe library and custom grocery entries.
 * Resolves to null when the household code is unknown.
 */
export async function pullHousehold(householdCode) {
  const data = await rpc('pull_household', { p_household_code: householdCode });
  return data ?? null;
}

/** Push library records and receive the merged server state back. */
export async function pushHousehold({ householdCode, recipes, entries }) {
  const data = await rpc('push_household', {
    p_household_code: householdCode,
    p_recipes: recipes,
    p_entries: entries,
  });
  return data ?? null;
}

/** Push local records and receive the merged server state back. */
export async function pushList({ shareCode, name, updatedAt, items, recipes }) {
  const data = await rpc('push_list', {
    p_share_code: shareCode,
    p_name: name,
    p_updated_at: updatedAt,
    p_items: items,
    p_recipes: recipes,
  });
  return data ?? null;
}
