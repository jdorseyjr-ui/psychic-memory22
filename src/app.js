/**
 * App entry point: wire storage → state → render, keep the derived grocery
 * database in sync with user-added custom entries, and — when sharing is
 * configured — run the background sync engine.
 */

import * as dataStore from './core/dataStore.js';
import { buildDatabase } from './core/groceryDb.js';
import { createSyncEngine } from './core/sync/syncEngine.js';
import * as transport from './core/sync/transport.js';
import { isSharingConfigured, POLL_INTERVAL_MS } from './config.js';
import { getState, setState, setRenderer } from './ui/state.js';
import { h, mount, captureFocus, restoreFocus } from './ui/dom.js';
import { startRouter, navigate, paths } from './ui/router.js';
import { joinList } from './ui/sharing.js';
import { ListsScreen } from './ui/screens/listsScreen.js';
import { ListEditScreen } from './ui/screens/listEditScreen.js';
import { ShoppingScreen } from './ui/screens/shoppingScreen.js';
import { RecipeLibraryScreen, RecipeDetailScreen } from './ui/screens/recipeLibraryScreen.js';

const root = document.getElementById('app');

let engine = null;
/** Set while the sync engine is writing, so its own saves don't re-trigger it. */
let syncWriting = false;
let pushTimer = null;

function render() {
  const state = getState();
  const focus = captureFocus();

  mount(root, screenFor(state), state.toast ? h('div', { className: 'toast' }, state.toast) : null);

  restoreFocus(focus);
}

function screenFor(state) {
  const { name, params } = state.route;
  switch (name) {
    case 'lists':
      return ListsScreen({ engine });
    case 'listEdit':
      return ListEditScreen({ ...params, engine });
    case 'shopping':
      return ShoppingScreen({ ...params, engine });
    case 'recipeLibrary':
      return RecipeLibraryScreen();
    case 'recipeDetail':
      return RecipeDetailScreen(params);
    case 'join':
      return JoiningScreen();
    default:
      return NotFound();
  }
}

function JoiningScreen() {
  return h(
    'div',
    { className: 'screen' },
    h(
      'main',
      { className: 'screen-body' },
      h(
        'div',
        { className: 'empty-state' },
        h('span', { className: 'empty-emoji', 'aria-hidden': 'true' }, '🔗'),
        h('h2', {}, 'Opening shared list…'),
      ),
    ),
  );
}

function NotFound() {
  return h(
    'div',
    { className: 'screen' },
    h(
      'main',
      { className: 'screen-body' },
      h(
        'div',
        { className: 'empty-state' },
        h('span', { className: 'empty-emoji', 'aria-hidden': 'true' }, '🧭'),
        h('h2', {}, 'Page not found'),
        h(
          'button',
          { className: 'btn btn-primary', type: 'button', onClick: () => navigate(paths.lists()) },
          'Back to lists',
        ),
      ),
    ),
  );
}

/** Refresh the state snapshot, rebuilding the DB when custom entries change. */
function syncFromStore(snapshot, changed) {
  const patch = { data: { ...snapshot } };
  if (!getState().db || changed?.has('customEntries')) {
    patch.db = buildDatabase(snapshot.customEntries);
  }
  setState(patch);

  // A local edit should reach the other device promptly, but a burst of
  // keystrokes shouldn't mean a request each.
  if (engine && !syncWriting && (changed?.has('lists') || changed?.has('recipes') || changed?.has('customEntries'))) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => engine.syncNow(), 700);
  }
}

function startSync() {
  if (!isSharingConfigured()) return null;

  const created = createSyncEngine({
    transport,
    getLists: () => dataStore.snapshot().lists,
    saveList: async (list) => {
      syncWriting = true;
      try {
        await dataStore.saveList(list);
      } finally {
        syncWriting = false;
      }
    },

    getHousehold: () => ({
      householdCode: dataStore.getSetting('householdCode'),
      recipes: dataStore.snapshot().recipes,
      entries: dataStore.snapshot().customEntries,
    }),

    saveHousehold: async ({ recipes, entries }) => {
      syncWriting = true;
      try {
        for (const recipe of recipes) await dataStore.saveRecipe(recipe);
        for (const entry of entries) await dataStore.saveCustomEntry(entry);
      } finally {
        syncWriting = false;
      }
    },
    onStatus: (sync) => setState({ sync }),
  });

  created.start();

  // Coming back to the app, or back onto a network, is the moment the other
  // person's changes are most likely to be waiting.
  window.addEventListener('online', () => created.syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') created.syncNow();
  });

  return created;
}

/** Poll faster in shopping mode, where check-offs should land quickly. */
function tuneSyncRate() {
  if (!engine) return;
  const shopping = getState().route.name === 'shopping';
  engine.setInterval(shopping ? POLL_INTERVAL_MS.shopping : POLL_INTERVAL_MS.idle);
}

/** Handle the join route once, when it becomes active. */
let joinInFlight = null;

function handleJoinRoute() {
  const { route } = getState();
  if (route.name !== 'join') {
    joinInFlight = null;
    return;
  }
  if (joinInFlight === route.params.shareCode) return;

  joinInFlight = route.params.shareCode;
  joinList(route.params.shareCode, { engine });
}

async function start() {
  setRenderer(render);

  const snapshot = await dataStore.init();
  setState({
    data: { ...snapshot },
    db: buildDatabase(snapshot.customEntries),
    search: { context: null, query: '', highlight: 0 },
    sync: null,
  });

  dataStore.subscribe(syncFromStore);
  engine = startSync();

  startRouter();
  window.addEventListener('hashchange', () => {
    tuneSyncRate();
    handleJoinRoute();
  });
  tuneSyncRate();
  handleJoinRoute();

  if (dataStore.isEphemeral()) {
    document.body.classList.add('is-ephemeral');
    console.warn('Shopping list: browser storage unavailable — data will not persist.');
  }
}

start();
