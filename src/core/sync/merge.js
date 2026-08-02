/**
 * Merge logic for shared lists.
 *
 * Pure and DOM-free so it can be tested exhaustively — this is where sync bugs
 * hide. The rules, in order of how much they matter:
 *
 * 1. **Records merge individually, by id.** Two people editing different items
 *    is not a conflict; both edits survive. Only edits to the *same* record
 *    can conflict.
 * 2. **Last write wins, per record, on `updatedAt`.** Deliberately simple. For
 *    a two-person grocery list the realistic conflict is "we both checked off
 *    the milk", where either answer is right.
 * 3. **Tombstones beat edits at equal timestamps.** If a delete and an edit
 *    land in the same millisecond, the delete wins — resurrecting an item
 *    someone deliberately removed is more annoying than losing an edit.
 * 4. **Unknown-to-remote records are kept, not dropped.** A record the server
 *    has never seen is a local addition that hasn't been pushed yet, not a
 *    remote deletion. Getting this backwards silently eats offline additions.
 */

/** Newer of two ISO timestamps, treating a missing one as infinitely old. */
function isNewer(a, b) {
  if (!b) return true;
  if (!a) return false;
  return Date.parse(a) > Date.parse(b);
}

/**
 * Pick the winning version of a single record.
 * Exported for tests; callers use `mergeRecordSets`.
 */
export function mergeRecord(local, remote) {
  if (!local) return remote;
  if (!remote) return local;

  if (isNewer(local.updatedAt, remote.updatedAt)) return local;
  if (isNewer(remote.updatedAt, local.updatedAt)) return remote;

  // Same timestamp: a delete outranks an edit (rule 3).
  if (local.deleted && !remote.deleted) return local;
  if (remote.deleted && !local.deleted) return remote;
  return remote;
}

/**
 * Merge two sets of records keyed by id.
 *
 * `remoteKnowsAll` distinguishes the two situations that look identical from
 * the client's side: a full server snapshot (a record missing from it was
 * deleted and purged) versus a partial/incremental one (missing just means
 * "no news"). We only ever pass full snapshots, but the flag keeps the
 * function honest about what it assumes.
 */
export function mergeRecordSets(localRecords, remoteRecords, { remoteKnowsAll = true } = {}) {
  const locals = new Map(localRecords.map((record) => [record.id, record]));
  const remotes = new Map(remoteRecords.map((record) => [record.id, record]));
  const merged = new Map();

  for (const [id, local] of locals) {
    merged.set(id, mergeRecord(local, remotes.get(id) ?? null));
  }
  for (const [id, remote] of remotes) {
    if (!merged.has(id)) merged.set(id, remote);
  }

  // A local record the server has never heard of is an unpushed addition
  // (rule 4) — `mergeRecord` already keeps it, this just documents the case.
  void remoteKnowsAll;

  return [...merged.values()];
}

/**
 * Merge a whole list. Returns the merged list plus the records that changed
 * locally, so the caller knows what still needs pushing.
 *
 * Ordering: merged records follow the local order where possible, with
 * remote-only additions appended. Two devices can therefore disagree about the
 * order of items added while offline — harmless, since shopping mode sorts by
 * aisle and name anyway.
 */
export function mergeList(local, remote) {
  if (!remote) return { list: local, changed: false };
  if (!local) return { list: remote, changed: true };

  const mergedRecipes = mergeRecordSets(local.recipes, remote.recipes);

  // Items are merged in one flat pass so an item that moved between the list
  // top level and a recipe doesn't get duplicated, then re-bucketed by the
  // winning version's `recipeId`.
  const localItems = [...local.items, ...local.recipes.flatMap((r) => r.items)];
  const remoteItems = [...remote.items, ...remote.recipes.flatMap((r) => r.items)];
  const mergedItems = mergeRecordSets(localItems, remoteItems);

  const recipeIds = new Set(mergedRecipes.map((recipe) => recipe.id));
  const standalone = [];
  const byRecipe = new Map(mergedRecipes.map((recipe) => [recipe.id, []]));

  for (const item of mergedItems) {
    // An item whose recipe is gone entirely falls back to the top level rather
    // than vanishing with it.
    if (item.recipeId && recipeIds.has(item.recipeId)) byRecipe.get(item.recipeId).push(item);
    else standalone.push(item.recipeId ? { ...item, recipeId: null } : item);
  }

  const list = {
    ...local,
    name: isNewer(remote.updatedAt, local.updatedAt) ? remote.name : local.name,
    items: standalone,
    recipes: mergedRecipes.map((recipe) => ({ ...recipe, items: byRecipe.get(recipe.id) ?? [] })),
    updatedAt: isNewer(remote.updatedAt, local.updatedAt) ? remote.updatedAt : local.updatedAt,
    shareCode: local.shareCode ?? remote.shareCode ?? null,
  };

  return { list, changed: !sameShape(local, list) };
}

/** Cheap structural comparison to decide whether a re-render/save is needed. */
function sameShape(a, b) {
  return JSON.stringify(stripVolatile(a)) === JSON.stringify(stripVolatile(b));
}

function stripVolatile(list) {
  return {
    name: list.name,
    items: list.items.map(recordShape),
    recipes: list.recipes.map((recipe) => ({
      ...recordShape(recipe),
      items: recipe.items.map(recordShape),
    })),
  };
}

function recordShape(record) {
  const { id, name, quantity, unit, unitLabel, checked, deleted, recipeId, updatedAt } = record;
  return { id, name, quantity, unit, unitLabel, checked, deleted, recipeId, updatedAt };
}

/**
 * Drop tombstones that everyone has certainly seen. Without this, a
 * long-running list accumulates deleted rows forever.
 */
export function purgeTombstones(list, { olderThanMs = 30 * 24 * 60 * 60 * 1000, nowMs = Date.now() } = {}) {
  const expired = (record) =>
    record.deleted && record.updatedAt && nowMs - Date.parse(record.updatedAt) > olderThanMs;

  return {
    ...list,
    items: list.items.filter((item) => !expired(item)),
    recipes: list.recipes
      .filter((recipe) => !expired(recipe))
      .map((recipe) => ({ ...recipe, items: recipe.items.filter((item) => !expired(item)) })),
  };
}
