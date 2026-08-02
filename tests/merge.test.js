/**
 * Merge-engine tests. These simulate two phones against a shared list, which
 * is the only way to catch the failure modes that matter: lost additions,
 * resurrected deletions, and clobbered simultaneous check-offs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeRecord, mergeRecordSets, mergeList, purgeTombstones } from '../src/core/sync/merge.js';
import { createList, createItem, createRecipeInstance, allItems } from '../src/core/model.js';
import { buildDatabase, matchEntry } from '../src/core/groceryDb.js';

const db = buildDatabase();

const at = (iso) => new Date(iso).toISOString();
const T0 = at('2026-08-01T10:00:00Z');
const T1 = at('2026-08-01T10:01:00Z');
const T2 = at('2026-08-01T10:02:00Z');

function item(overrides = {}) {
  return { ...createItem({ name: 'Milk' }), updatedAt: T0, ...overrides };
}

/** A list as it would exist on one device. */
function listWith(items = [], recipes = []) {
  return { ...createList('Weekly'), id: 'list-1', updatedAt: T0, items, recipes };
}

// --- single records --------------------------------------------------------

test('the newer version of a record wins', () => {
  const older = item({ id: 'a', quantity: 1, updatedAt: T0 });
  const newer = item({ id: 'a', quantity: 5, updatedAt: T1 });

  assert.equal(mergeRecord(older, newer).quantity, 5);
  assert.equal(mergeRecord(newer, older).quantity, 5);
});

test('a record only one side has is kept', () => {
  const only = item({ id: 'a' });
  assert.equal(mergeRecord(only, null), only);
  assert.equal(mergeRecord(null, only), only);
});

test('a delete beats an edit made in the same millisecond', () => {
  const edited = item({ id: 'a', quantity: 9, updatedAt: T1 });
  const deleted = item({ id: 'a', deleted: true, updatedAt: T1 });

  assert.equal(mergeRecord(edited, deleted).deleted, true);
  assert.equal(mergeRecord(deleted, edited).deleted, true);
});

test('a later edit still beats an earlier delete', () => {
  const deleted = item({ id: 'a', deleted: true, updatedAt: T0 });
  const readded = item({ id: 'a', quantity: 2, updatedAt: T1 });
  assert.equal(mergeRecord(deleted, readded).deleted, false);
});

test('a record with no timestamp loses to one that has it', () => {
  const stamped = item({ id: 'a', quantity: 3, updatedAt: T1 });
  const unstamped = item({ id: 'a', quantity: 7, updatedAt: undefined });
  assert.equal(mergeRecord(unstamped, stamped).quantity, 3);
});

// --- record sets -----------------------------------------------------------

test('record sets union by id without duplicating', () => {
  const merged = mergeRecordSets(
    [item({ id: 'a' }), item({ id: 'b' })],
    [item({ id: 'b' }), item({ id: 'c' })],
  );
  assert.deepEqual(merged.map((r) => r.id).sort(), ['a', 'b', 'c']);
});

// --- the scenarios that actually happen in a store -------------------------

test('two people checking off different items keeps both check-offs', () => {
  // The core promise of the feature: no conflict, because different rows.
  const milk = item({ id: 'milk', name: 'Milk' });
  const bread = item({ id: 'bread', name: 'Bread' });

  const mine = listWith([{ ...milk, checked: true, updatedAt: T1 }, bread]);
  const hers = listWith([milk, { ...bread, checked: true, updatedAt: T1 }]);

  const { list } = mergeList(mine, hers);
  const byId = Object.fromEntries(list.items.map((i) => [i.id, i]));

  assert.equal(byId.milk.checked, true, 'my check-off survived');
  assert.equal(byId.bread.checked, true, 'her check-off survived');
});

test('an item added offline on one phone is not deleted by the other phone', () => {
  // The failure mode that eats data: remote has never seen the record, which
  // must not be read as "remote deleted it".
  const shared = item({ id: 'shared' });
  const mine = listWith([shared, item({ id: 'new-offline', name: 'Capers', updatedAt: T1 })]);
  const hers = listWith([shared]);

  const { list } = mergeList(mine, hers);
  assert.deepEqual(list.items.map((i) => i.id).sort(), ['new-offline', 'shared']);
});

test('an item deleted on one phone stays deleted after the other syncs', () => {
  // Without tombstones the stale copy pushes the item straight back.
  const mine = listWith([item({ id: 'milk', deleted: true, updatedAt: T1 })]);
  const hers = listWith([item({ id: 'milk', updatedAt: T0 })]);

  const { list } = mergeList(mine, hers);
  assert.equal(list.items[0].deleted, true);
  assert.equal(allItems(list).length, 0, 'and it stays out of the visible list');
});

test('both phones adding different items ends with both items', () => {
  const mine = listWith([item({ id: 'a', name: 'Apples', updatedAt: T1 })]);
  const hers = listWith([item({ id: 'b', name: 'Bananas', updatedAt: T1 })]);

  const { list } = mergeList(mine, hers);
  assert.deepEqual(allItems(list).map((i) => i.name).sort(), ['Apples', 'Bananas']);
});

test('editing the same item twice keeps the later edit', () => {
  const mine = listWith([item({ id: 'a', quantity: 2, updatedAt: T1 })]);
  const hers = listWith([item({ id: 'a', quantity: 6, updatedAt: T2 })]);

  const { list } = mergeList(mine, hers);
  assert.equal(list.items[0].quantity, 6);
});

test('the later list rename wins', () => {
  const mine = { ...listWith([]), name: 'Groceries', updatedAt: T1 };
  const hers = { ...listWith([]), name: 'Weekend shop', updatedAt: T2 };
  assert.equal(mergeList(mine, hers).list.name, 'Weekend shop');
});

// --- recipes ---------------------------------------------------------------

test('recipe ingredients stay nested under their recipe through a merge', () => {
  const recipe = { ...createRecipeInstance({ name: 'Tacos' }), id: 'r1', updatedAt: T0 };
  const ingredient = item({ id: 'i1', name: 'Tortilla', recipeId: 'r1' });

  const mine = listWith([], [{ ...recipe, items: [ingredient] }]);
  const hers = listWith([], [{ ...recipe, items: [ingredient] }]);

  const { list } = mergeList(mine, hers);
  assert.equal(list.recipes.length, 1);
  assert.equal(list.recipes[0].items.length, 1);
  assert.equal(list.items.length, 0, 'ingredient did not leak to the top level');
});

test('an ingredient whose recipe was deleted elsewhere falls back to the top level', () => {
  // Better to show a stray ingredient than to silently drop it.
  const orphan = item({ id: 'i1', name: 'Tortilla', recipeId: 'gone', updatedAt: T1 });
  const { list } = mergeList(listWith([orphan]), listWith([]));

  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].recipeId, null);
});

test('deleting a recipe tombstones it without losing the other list contents', () => {
  const recipe = { ...createRecipeInstance({ name: 'Tacos' }), id: 'r1', updatedAt: T1, deleted: true };
  const mine = listWith([item({ id: 'milk' })], [recipe]);
  const hers = listWith([item({ id: 'milk' })], [{ ...recipe, deleted: false, updatedAt: T0 }]);

  const { list } = mergeList(mine, hers);
  assert.equal(list.recipes[0].deleted, true);
  assert.equal(allItems(list).length, 1, 'the standalone milk survived');
});

// --- convergence -----------------------------------------------------------

test('merging is order-independent: both phones reach the same state', () => {
  // The property that matters most — whoever syncs first, both end up equal.
  const shared = item({ id: 'shared', name: 'Eggs' });
  const mine = listWith([
    { ...shared, checked: true, updatedAt: T1 },
    item({ id: 'mine', name: 'Apples', updatedAt: T1 }),
  ]);
  const hers = listWith([
    { ...shared, quantity: 12, updatedAt: T2 },
    item({ id: 'hers', name: 'Bananas', updatedAt: T1 }),
    item({ id: 'gone', name: 'Kale', deleted: true, updatedAt: T1 }),
  ]);

  const onMyPhone = mergeList(mine, hers).list;
  const onHerPhone = mergeList(hers, mine).list;

  const normalize = (list) =>
    allItems(list)
      .map((i) => `${i.id}:${i.name}:${i.quantity}:${i.checked}`)
      .sort();

  assert.deepEqual(normalize(onMyPhone), normalize(onHerPhone));
  assert.deepEqual(normalize(onMyPhone), ['hers:Bananas:1:false', 'mine:Apples:1:false', 'shared:Eggs:12:false']);
});

test('merging twice changes nothing the second time', () => {
  const mine = listWith([item({ id: 'a', updatedAt: T1 })]);
  const hers = listWith([item({ id: 'b', updatedAt: T2 })]);

  const once = mergeList(mine, hers).list;
  const twice = mergeList(once, hers);
  assert.equal(twice.changed, false, 'a settled list reports no further change');
});

test('a merge that changes nothing is reported as unchanged', () => {
  const same = listWith([item({ id: 'a' })]);
  assert.equal(mergeList(same, structuredClone(same)).changed, false);
});

test('merging against no remote copy leaves the local list alone', () => {
  const mine = listWith([item({ id: 'a' })]);
  const result = mergeList(mine, null);
  assert.equal(result.list, mine);
  assert.equal(result.changed, false);
});

// --- tombstone cleanup -----------------------------------------------------

test('old tombstones are purged but recent ones are kept', () => {
  const nowMs = Date.parse('2026-09-01T00:00:00Z');
  const list = listWith([
    item({ id: 'old', deleted: true, updatedAt: at('2026-07-01T00:00:00Z') }),
    item({ id: 'recent', deleted: true, updatedAt: at('2026-08-30T00:00:00Z') }),
    item({ id: 'live' }),
  ]);

  const purged = purgeTombstones(list, { nowMs });
  assert.deepEqual(purged.items.map((i) => i.id).sort(), ['live', 'recent']);
});

test('purging never drops a live record', () => {
  const list = listWith([item({ id: 'live', updatedAt: at('2020-01-01T00:00:00Z') })]);
  assert.equal(purgeTombstones(list, { nowMs: Date.now() }).items.length, 1);
});

// --- integration with the real model ---------------------------------------

test('a merged list still drives shopping mode correctly', () => {
  const eggs = matchEntry(db, 'eggs');
  const mine = listWith([{ ...createItem({ dbEntry: eggs, quantity: 12 }), id: 'e1', updatedAt: T1 }]);
  const hers = listWith([{ ...createItem({ dbEntry: eggs, quantity: 2 }), id: 'e2', updatedAt: T1 }]);

  const { list } = mergeList(mine, hers);
  assert.equal(allItems(list).length, 2);
  assert.equal(allItems(list).reduce((sum, i) => sum + i.quantity, 0), 14);
});
