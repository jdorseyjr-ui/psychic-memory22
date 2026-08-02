/**
 * Transient UI state (route, recipe-building session, expand/collapse).
 *
 * Nothing here is persisted — persisted data lives in `dataStore`. Setting
 * state schedules a re-render on the next microtask so a handler can make
 * several changes without repainting in between.
 */

const state = {
  route: { name: 'lists', params: {} },
  data: { lists: [], recipes: [], customEntries: [] },
  db: null,

  /** Set while the user is inside recipe-building mode (spec §5.1). */
  building: null, // { listId, recipeInstanceId, isNew }

  /** Recipe instance ids currently collapsed on the list edit screen. */
  collapsedRecipes: new Set(),

  /** Shown after "End Recipe" — the lightweight two-button choice (spec §5.2). */
  afterRecipePrompt: null, // { listId }

  toast: null,
};

let renderFn = () => {};
let scheduled = false;

export function getState() {
  return state;
}

export function setRenderer(fn) {
  renderFn = fn;
}

/** Shallow-merge a patch into state and schedule a render. */
export function setState(patch) {
  Object.assign(state, patch);
  scheduleRender();
}

/** Mutate state in place (for Sets and other non-mergeable fields). */
export function updateState(mutator) {
  mutator(state);
  scheduleRender();
}

export function scheduleRender() {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    renderFn();
  });
}

let toastTimer = null;

export function showToast(message) {
  setState({ toast: message });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: null }), 2400);
}
