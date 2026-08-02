/**
 * App entry point: wire storage → state → render, and keep the derived
 * grocery database in sync with user-added custom entries.
 */

import * as dataStore from './core/dataStore.js';
import { buildDatabase } from './core/groceryDb.js';
import { getState, setState, setRenderer } from './ui/state.js';
import { h, mount, captureFocus, restoreFocus } from './ui/dom.js';
import { startRouter, navigate, paths } from './ui/router.js';
import { ListsScreen } from './ui/screens/listsScreen.js';
import { ListEditScreen } from './ui/screens/listEditScreen.js';
import { ShoppingScreen } from './ui/screens/shoppingScreen.js';
import { RecipeLibraryScreen, RecipeDetailScreen } from './ui/screens/recipeLibraryScreen.js';

const root = document.getElementById('app');

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
      return ListsScreen();
    case 'listEdit':
      return ListEditScreen(params);
    case 'shopping':
      return ShoppingScreen(params);
    case 'recipeLibrary':
      return RecipeLibraryScreen();
    case 'recipeDetail':
      return RecipeDetailScreen(params);
    default:
      return NotFound();
  }
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
}

async function start() {
  setRenderer(render);

  const snapshot = await dataStore.init();
  setState({
    data: { ...snapshot },
    db: buildDatabase(snapshot.customEntries),
    search: { context: null, query: '', highlight: 0 },
  });

  dataStore.subscribe(syncFromStore);
  startRouter();

  if (dataStore.isEphemeral()) {
    document.body.classList.add('is-ephemeral');
    console.warn('Shopping list: browser storage unavailable — data will not persist.');
  }
}

start();
