/**
 * Sync orchestration for shared lists.
 *
 * Local-first, always. Every user action writes to local storage immediately
 * and returns; this engine reconciles with the server in the background. That
 * ordering is the whole design — a grocery store is a concrete box with bad
 * signal, and the app must never block on the network while someone is
 * standing in an aisle.
 *
 * One round for a list: pull the server copy, merge it with local, save the
 * result, then push if local still has anything the server lacks. The push
 * returns post-write server state, so a round ends converged.
 *
 * The transport is injected so the whole engine can be tested against a fake
 * server — see `tests/sync.test.js`, which runs two engines against one store
 * and asserts they converge.
 */

import { mergeList, purgeTombstones } from './merge.js';
import { allRecords } from '../model.js';

export const SyncStatus = {
  IDLE: 'idle',
  SYNCING: 'syncing',
  SYNCED: 'synced',
  OFFLINE: 'offline',
  ERROR: 'error',
};

const BACKOFF_MS = [1000, 2000, 5000, 15000, 30000];

export function createSyncEngine({
  transport,
  getLists,
  saveList,
  onStatus = () => {},
  now = () => Date.now(),
}) {
  /** Lists currently mid-sync, so two rounds never overlap on one list. */
  const inFlight = new Map();
  let consecutiveFailures = 0;
  let timer = null;
  let running = false;
  let interval = 12000;
  let status = SyncStatus.IDLE;
  let lastSyncedAt = null;

  function setStatus(next, detail = null) {
    if (status === next && next !== SyncStatus.ERROR) return;
    status = next;
    onStatus({ status, detail, lastSyncedAt });
  }

  function sharedLists() {
    return getLists().filter((list) => list.shareCode);
  }

  /** Flatten a list into the wire shape the server's RPCs expect. */
  function toWire(list) {
    const { items, recipes } = allRecords(list);
    return {
      shareCode: list.shareCode,
      name: list.name,
      updatedAt: list.updatedAt,
      items: items.map((item) => ({
        id: item.id,
        recipeId: item.recipeId ?? null,
        dbEntryId: item.dbEntryId ?? null,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        unitLabel: item.unitLabel ?? null,
        // Denormalized so the other device files this in the right aisle even
        // when it references a custom database entry it has never seen.
        category: item.category ?? null,
        emoji: item.emoji ?? null,
        checked: Boolean(item.checked),
        deleted: Boolean(item.deleted),
        updatedAt: item.updatedAt,
      })),
      recipes: recipes.map((recipe) => ({
        id: recipe.id,
        recipeDefId: recipe.recipeDefId ?? null,
        name: recipe.name,
        deleted: Boolean(recipe.deleted),
        updatedAt: recipe.updatedAt,
      })),
    };
  }

  /**
   * Rebuild a list-shaped object from a server snapshot so `mergeList` can
   * treat both sides identically.
   */
  function fromWire(remote, local) {
    if (!remote) return null;
    const recipes = (remote.recipes ?? []).map((recipe) => ({ ...recipe, items: [] }));
    const byRecipe = new Map(recipes.map((recipe) => [recipe.id, recipe]));
    const standalone = [];

    for (const item of remote.items ?? []) {
      const target = item.recipeId ? byRecipe.get(item.recipeId) : null;
      if (target) target.items.push(item);
      else standalone.push({ ...item, recipeId: item.recipeId ?? null });
    }

    return {
      ...local,
      id: local.id,
      name: remote.name,
      updatedAt: remote.updatedAt,
      items: standalone,
      recipes,
    };
  }

  /** True when local holds a record the server's copy doesn't match. */
  function needsPush(local, remote) {
    if (!remote) return true;
    const remoteById = new Map(
      [...(remote.items ?? []), ...(remote.recipes ?? [])].map((r) => [r.id, r.updatedAt]),
    );
    const { items, recipes } = allRecords(local);

    for (const record of [...items, ...recipes]) {
      const seen = remoteById.get(record.id);
      if (!seen) return true;
      if (Date.parse(record.updatedAt ?? 0) > Date.parse(seen)) return true;
    }
    return Date.parse(local.updatedAt ?? 0) > Date.parse(remote.updatedAt ?? 0);
  }

  /** One full reconciliation round for a single list. */
  async function syncList(listId) {
    if (inFlight.has(listId)) return inFlight.get(listId);

    const run = (async () => {
      const local = getLists().find((candidate) => candidate.id === listId);
      if (!local?.shareCode) return { synced: false };

      const remote = await transport.pullList(local.shareCode);

      // The list was unshared or the code is wrong. Keep the local copy —
      // dropping the user's data because a link went stale is unacceptable.
      if (remote === null) {
        return { synced: false, unknownCode: true };
      }

      // Re-read: local may have changed while the request was in flight.
      const current = getLists().find((candidate) => candidate.id === listId) ?? local;
      const merged = mergeList(current, fromWire(remote, current));
      if (merged.changed) await saveList(merged.list);

      const after = getLists().find((candidate) => candidate.id === listId) ?? merged.list;
      if (needsPush(after, remote)) {
        const echoed = await transport.pushList(toWire(after));
        const settled = mergeList(after, fromWire(echoed, after));
        if (settled.changed) await saveList(settled.list);
      }

      return { synced: true };
    })();

    inFlight.set(listId, run);
    try {
      return await run;
    } finally {
      inFlight.delete(listId);
    }
  }

  /** Sync every shared list once. Never throws. */
  async function syncAll() {
    const lists = sharedLists();
    if (lists.length === 0) {
      setStatus(SyncStatus.IDLE);
      return;
    }

    setStatus(SyncStatus.SYNCING);
    const results = await Promise.allSettled(lists.map((list) => syncList(list.id)));
    const failures = results.filter((result) => result.status === 'rejected');

    if (failures.length === 0) {
      consecutiveFailures = 0;
      lastSyncedAt = now();
      setStatus(SyncStatus.SYNCED);
      return;
    }

    consecutiveFailures += 1;
    const offline = failures.every((failure) => failure.reason?.retryable);
    setStatus(offline ? SyncStatus.OFFLINE : SyncStatus.ERROR, failures[0].reason);
  }

  function scheduleNext() {
    if (!running) return;
    clearTimeout(timer);
    // Back off after failures so a dead network isn't hammered, but never
    // stop entirely — signal comes back.
    const delay =
      consecutiveFailures > 0
        ? BACKOFF_MS[Math.min(consecutiveFailures - 1, BACKOFF_MS.length - 1)]
        : interval;

    timer = setTimeout(async () => {
      await syncAll();
      scheduleNext();
    }, delay);
  }

  return {
    /** Begin background syncing. */
    start() {
      if (running) return;
      running = true;
      syncAll().then(scheduleNext);
    },

    stop() {
      running = false;
      clearTimeout(timer);
      timer = null;
    },

    /** Poll faster in shopping mode, where check-offs should land quickly. */
    setInterval(ms) {
      interval = ms;
      if (running && consecutiveFailures === 0) scheduleNext();
    },

    /** Force a round now — after a local edit, or on regaining focus. */
    syncNow: syncAll,
    syncList,
    getStatus: () => ({ status, lastSyncedAt }),

    /** Drop tombstones everyone has certainly seen. */
    async purge() {
      for (const list of sharedLists()) {
        const purged = purgeTombstones(list, { nowMs: now() });
        if (purged.items.length !== list.items.length) await saveList(purged);
      }
    },
  };
}
