/**
 * Sync-engine tests: two independent "phones" against one fake server.
 *
 * The fake server implements the same last-write-wins-per-row rules as
 * `db/schema.sql`, so these exercise the real reconciliation path — pull,
 * merge, push, converge — without needing a live Supabase project.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createSyncEngine, SyncStatus } from '../src/core/sync/syncEngine.js';
import { createList, createItem, allItems } from '../src/core/model.js';
import { SyncError } from '../src/core/sync/transport.js';

// --- fake server -----------------------------------------------------------

/** Mirrors the SQL: rows keyed by id, newer `updatedAt` wins. */
function createFakeServer() {
  const lists = new Map(); // shareCode -> { id, name, updatedAt, items, recipes }
  let pulls = 0;
  let pushes = 0;

  const upsert = (collection, incoming) => {
    for (const record of incoming) {
      const existing = collection.get(record.id);
      if (!existing || Date.parse(record.updatedAt) > Date.parse(existing.updatedAt)) {
        collection.set(record.id, { ...record });
      }
    }
  };

  /**
   * Snapshot without touching the counters. `push_list` returns the
   * post-write state in one round trip, so building that response must not
   * register as a separate pull.
   */
  const snapshotOf = (shareCode) => {
    const row = lists.get(shareCode);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      updatedAt: row.updatedAt,
      items: [...row.items.values()],
      recipes: [...row.recipes.values()],
    };
  };

  return {
    get pullCount() { return pulls; },
    get pushCount() { return pushes; },

    transport: {
      async createSharedList({ listId, shareCode, name }) {
        if (!lists.has(shareCode)) {
          lists.set(shareCode, {
            id: listId,
            name,
            updatedAt: new Date().toISOString(),
            items: new Map(),
            recipes: new Map(),
          });
        }
      },

      async pullList(shareCode) {
        pulls += 1;
        return snapshotOf(shareCode);
      },

      async pushList({ shareCode, name, updatedAt, items, recipes }) {
        pushes += 1;
        const row = lists.get(shareCode);
        if (!row) throw new SyncError('unknown share code', { retryable: false });

        if (Date.parse(updatedAt) > Date.parse(row.updatedAt)) {
          row.name = name;
          row.updatedAt = updatedAt;
        }
        upsert(row.items, items);
        upsert(row.recipes, recipes);

        return snapshotOf(shareCode);
      },
    },
  };
}

/** A device: its own local store plus an engine pointed at the shared server. */
function createPhone(server, seedList) {
  const lists = [structuredClone(seedList)];

  const engine = createSyncEngine({
    transport: server.transport,
    getLists: () => lists,
    saveList: async (list) => {
      const index = lists.findIndex((candidate) => candidate.id === list.id);
      if (index === -1) lists.push(list);
      else lists[index] = list;
    },
  });

  return {
    engine,
    get list() { return lists[0]; },
    names: () => allItems(lists[0]).map((item) => item.name).sort(),
    /** Apply a local edit the way the real actions layer would. */
    edit(mutator) {
      mutator(lists[0]);
    },
  };
}

const SHARE_CODE = 'a'.repeat(32);

function sharedList() {
  return { ...createList('Weekly'), id: 'list-1', shareCode: SHARE_CODE };
}

function newItem(name, overrides = {}) {
  return { ...createItem({ name }), ...overrides };
}

async function seedServer(server) {
  await server.transport.createSharedList({
    listId: 'list-1',
    shareCode: SHARE_CODE,
    name: 'Weekly',
  });
}

// --- tests -----------------------------------------------------------------

test('a local-only list is never sent to the server', async () => {
  const server = createFakeServer();
  const phone = createPhone(server, { ...createList('Private'), id: 'list-1', shareCode: null });

  await phone.engine.syncNow();
  assert.equal(server.pullCount, 0, 'unshared lists must not touch the network');
  assert.equal(phone.engine.getStatus().status, SyncStatus.IDLE);
});

test('a shared list uploads its items on first sync', async () => {
  const server = createFakeServer();
  await seedServer(server);

  const phone = createPhone(server, sharedList());
  phone.edit((list) => list.items.push(newItem('Milk')));
  await phone.engine.syncNow();

  const remote = await server.transport.pullList(SHARE_CODE);
  assert.deepEqual(remote.items.map((i) => i.name), ['Milk']);
  assert.equal(phone.engine.getStatus().status, SyncStatus.SYNCED);
});

test('an item added on one phone appears on the other', async () => {
  const server = createFakeServer();
  await seedServer(server);

  const mine = createPhone(server, sharedList());
  const hers = createPhone(server, sharedList());

  mine.edit((list) => list.items.push(newItem('Milk')));
  await mine.engine.syncNow();
  await hers.engine.syncNow();

  assert.deepEqual(hers.names(), ['Milk']);
});

test('both phones adding items at once ends with both items everywhere', async () => {
  const server = createFakeServer();
  await seedServer(server);

  const mine = createPhone(server, sharedList());
  const hers = createPhone(server, sharedList());

  mine.edit((list) => list.items.push(newItem('Apples')));
  hers.edit((list) => list.items.push(newItem('Bananas')));

  await Promise.all([mine.engine.syncNow(), hers.engine.syncNow()]);
  await Promise.all([mine.engine.syncNow(), hers.engine.syncNow()]);

  assert.deepEqual(mine.names(), ['Apples', 'Bananas']);
  assert.deepEqual(hers.names(), ['Apples', 'Bananas']);
});

test('checking off on one phone shows up checked on the other', async () => {
  // The actual in-store scenario.
  const server = createFakeServer();
  await seedServer(server);

  const mine = createPhone(server, sharedList());
  mine.edit((list) => list.items.push(newItem('Milk', { id: 'milk' })));
  await mine.engine.syncNow();

  const hers = createPhone(server, sharedList());
  await hers.engine.syncNow();
  assert.equal(allItems(hers.list)[0].checked, false);

  hers.edit((list) => {
    const item = list.items.find((candidate) => candidate.id === 'milk');
    item.checked = true;
    item.updatedAt = new Date(Date.now() + 1000).toISOString();
  });
  await hers.engine.syncNow();
  await mine.engine.syncNow();

  assert.equal(allItems(mine.list)[0].checked, true, 'her check-off reached my phone');
});

test('two people checking different items keeps both check-offs', async () => {
  const server = createFakeServer();
  await seedServer(server);

  const mine = createPhone(server, sharedList());
  mine.edit((list) => {
    list.items.push(newItem('Milk', { id: 'milk' }), newItem('Bread', { id: 'bread' }));
  });
  await mine.engine.syncNow();

  const hers = createPhone(server, sharedList());
  await hers.engine.syncNow();

  const later = new Date(Date.now() + 1000).toISOString();
  mine.edit((list) => {
    const item = list.items.find((i) => i.id === 'milk');
    item.checked = true;
    item.updatedAt = later;
  });
  hers.edit((list) => {
    const item = list.items.find((i) => i.id === 'bread');
    item.checked = true;
    item.updatedAt = later;
  });

  await Promise.all([mine.engine.syncNow(), hers.engine.syncNow()]);
  await Promise.all([mine.engine.syncNow(), hers.engine.syncNow()]);

  for (const phone of [mine, hers]) {
    const checked = allItems(phone.list).filter((i) => i.checked).map((i) => i.name).sort();
    assert.deepEqual(checked, ['Bread', 'Milk']);
  }
});

test('a delete on one phone removes the item from the other', async () => {
  const server = createFakeServer();
  await seedServer(server);

  const mine = createPhone(server, sharedList());
  mine.edit((list) => list.items.push(newItem('Kale', { id: 'kale' })));
  await mine.engine.syncNow();

  const hers = createPhone(server, sharedList());
  await hers.engine.syncNow();
  assert.deepEqual(hers.names(), ['Kale']);

  mine.edit((list) => {
    const item = list.items.find((i) => i.id === 'kale');
    item.deleted = true;
    item.updatedAt = new Date(Date.now() + 1000).toISOString();
  });
  await mine.engine.syncNow();
  await hers.engine.syncNow();

  assert.deepEqual(hers.names(), [], 'the delete propagated');
});

test('a deleted item is not resurrected by the other phone syncing later', async () => {
  // The classic tombstone bug: a stale copy pushes a deleted item back.
  const server = createFakeServer();
  await seedServer(server);

  const mine = createPhone(server, sharedList());
  mine.edit((list) => list.items.push(newItem('Kale', { id: 'kale' })));
  await mine.engine.syncNow();

  const hers = createPhone(server, sharedList());
  await hers.engine.syncNow(); // she now holds a live copy

  mine.edit((list) => {
    const item = list.items.find((i) => i.id === 'kale');
    item.deleted = true;
    item.updatedAt = new Date(Date.now() + 1000).toISOString();
  });
  await mine.engine.syncNow();

  // She syncs late, still holding the live version.
  await hers.engine.syncNow();
  await mine.engine.syncNow();

  assert.deepEqual(hers.names(), []);
  assert.deepEqual(mine.names(), [], 'and it did not come back to my phone either');
});

test('edits made offline upload once the network returns', async () => {
  const server = createFakeServer();
  await seedServer(server);

  let offline = true;
  const flaky = {
    createSharedList: (...args) => server.transport.createSharedList(...args),
    async pullList(code) {
      if (offline) throw new SyncError('offline', { retryable: true });
      return server.transport.pullList(code);
    },
    async pushList(payload) {
      if (offline) throw new SyncError('offline', { retryable: true });
      return server.transport.pushList(payload);
    },
  };

  const lists = [sharedList()];
  const engine = createSyncEngine({
    transport: flaky,
    getLists: () => lists,
    saveList: async (list) => { lists[0] = list; },
  });

  lists[0].items.push(newItem('Capers'));
  await engine.syncNow();
  assert.equal(engine.getStatus().status, SyncStatus.OFFLINE);
  assert.deepEqual(allItems(lists[0]).map((i) => i.name), ['Capers'], 'local edit survived');

  offline = false;
  await engine.syncNow();
  assert.equal(engine.getStatus().status, SyncStatus.SYNCED);

  const remote = await server.transport.pullList(SHARE_CODE);
  assert.deepEqual(remote.items.map((i) => i.name), ['Capers'], 'and uploaded on reconnect');
});

test('a stale or revoked share link never destroys local data', async () => {
  const server = createFakeServer(); // never seeded: the code is unknown
  const phone = createPhone(server, sharedList());
  phone.edit((list) => list.items.push(newItem('Milk')));

  await phone.engine.syncNow();
  assert.deepEqual(phone.names(), ['Milk'], 'local list untouched by an unknown code');
});

test('a non-retryable server error surfaces as an error, not as offline', async () => {
  const failing = {
    async pullList() {
      throw new SyncError('bad request', { retryable: false, status: 400 });
    },
    async pushList() { throw new SyncError('bad request', { retryable: false, status: 400 }); },
    async createSharedList() {},
  };

  const lists = [sharedList()];
  const engine = createSyncEngine({
    transport: failing,
    getLists: () => lists,
    saveList: async (list) => { lists[0] = list; },
  });

  await engine.syncNow();
  assert.equal(engine.getStatus().status, SyncStatus.ERROR);
});

test('overlapping sync rounds for one list collapse into a single round', async () => {
  const server = createFakeServer();
  await seedServer(server);
  const phone = createPhone(server, sharedList());

  await Promise.all([
    phone.engine.syncList('list-1'),
    phone.engine.syncList('list-1'),
    phone.engine.syncList('list-1'),
  ]);

  assert.equal(server.pullCount, 1, 'concurrent calls share one in-flight request');
});

test('repeated syncs with no changes settle and stop pushing', async () => {
  const server = createFakeServer();
  await seedServer(server);

  const phone = createPhone(server, sharedList());
  phone.edit((list) => list.items.push(newItem('Milk')));

  await phone.engine.syncNow();
  const afterFirst = server.pushCount;
  await phone.engine.syncNow();
  await phone.engine.syncNow();

  assert.equal(server.pushCount, afterFirst, 'a converged list stops uploading');
});

test('a recipe and its ingredients survive the round trip nested', async () => {
  const server = createFakeServer();
  await seedServer(server);

  const mine = createPhone(server, sharedList());
  mine.edit((list) => {
    list.recipes.push({
      id: 'r1',
      recipeDefId: null,
      name: 'Tacos',
      deleted: false,
      updatedAt: new Date().toISOString(),
      items: [newItem('Tortilla', { id: 'i1', recipeId: 'r1' })],
    });
  });
  await mine.engine.syncNow();

  const hers = createPhone(server, sharedList());
  await hers.engine.syncNow();

  assert.equal(hers.list.recipes.length, 1);
  assert.equal(hers.list.recipes[0].name, 'Tacos');
  assert.deepEqual(hers.list.recipes[0].items.map((i) => i.name), ['Tortilla']);
  assert.equal(hers.list.items.length, 0, 'ingredient stayed nested, not duplicated');
});

test('three sync rounds across two phones converge to identical state', async () => {
  const server = createFakeServer();
  await seedServer(server);

  const mine = createPhone(server, sharedList());
  const hers = createPhone(server, sharedList());

  mine.edit((list) => list.items.push(newItem('Apples', { id: 'a' })));
  hers.edit((list) => list.items.push(newItem('Bananas', { id: 'b' })));
  await Promise.all([mine.engine.syncNow(), hers.engine.syncNow()]);

  mine.edit((list) => list.items.push(newItem('Cheese', { id: 'c' })));
  hers.edit((list) => {
    const item = list.items.find((i) => i.id === 'b');
    item.deleted = true;
    item.updatedAt = new Date(Date.now() + 2000).toISOString();
  });
  await Promise.all([mine.engine.syncNow(), hers.engine.syncNow()]);
  await Promise.all([mine.engine.syncNow(), hers.engine.syncNow()]);

  assert.deepEqual(mine.names(), hers.names(), 'both phones agree');
  assert.deepEqual(mine.names(), ['Apples', 'Cheese']);
});
