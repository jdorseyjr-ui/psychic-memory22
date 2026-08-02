/**
 * Search/autocomplete input (spec §4.3).
 *
 * Used unchanged at list level, inside recipe-building mode, and on the recipe
 * library screen — the only difference is the callbacks it's handed.
 *
 * Query text lives in global UI state (keyed by `context`) because the app
 * re-renders whole screens; `data-focus-key` keeps the caret in place.
 */

import { h } from '../dom.js';
import { getState, setState } from '../state.js';
import { searchEntries, matchEntry } from '../../core/groceryDb.js';
import { categoryLabel, categoryColor } from '../../core/categories.js';
import { iconPlus } from '../icons.js';

const MAX_RESULTS = 8;

/** Below this much free space, the dropdown opens upward instead. */
const MIN_SPACE_PX = 180;
/** Never shrink the dropdown below this — it stays scrollable instead. */
const MIN_HEIGHT_PX = 120;
/** Breathing room from the viewport edge. */
const EDGE_GAP_PX = 12;

/**
 * Size and place the results list against the *visual* viewport.
 *
 * On mobile the layout viewport doesn't change when the keyboard opens, so
 * `dvh` and `innerHeight` both over-report the space available and the
 * dropdown ends up behind the keyboard. `visualViewport` is the only thing
 * that reflects reality here.
 */
function positionResults(container, results) {
  const field = container.querySelector('.search-field');
  if (!field) return;

  const viewport = window.visualViewport;
  const viewTop = viewport?.offsetTop ?? 0;
  const viewHeight = viewport?.height ?? window.innerHeight;
  const rect = field.getBoundingClientRect();

  const spaceBelow = viewTop + viewHeight - rect.bottom - EDGE_GAP_PX;
  const spaceAbove = rect.top - viewTop - EDGE_GAP_PX;
  const openUpward = spaceBelow < MIN_SPACE_PX && spaceAbove > spaceBelow;

  container.classList.toggle('search-above', openUpward);
  const available = openUpward ? spaceAbove : spaceBelow;
  results.style.maxHeight = `${Math.max(MIN_HEIGHT_PX, Math.floor(available))}px`;
}

/** Re-measure every open dropdown — the keyboard opening is a resize. */
function repositionAll() {
  for (const container of document.querySelectorAll('.search')) {
    const results = container.querySelector('.search-results');
    if (results) positionResults(container, results);
  }
}

if (typeof window !== 'undefined' && window.visualViewport) {
  window.visualViewport.addEventListener('resize', repositionAll);
  window.visualViewport.addEventListener('scroll', repositionAll);
}

export function getSearchState(context) {
  const { search } = getState();
  if (!search || search.context !== context) return { context, query: '', highlight: 0 };
  return search;
}

function setSearchState(patch) {
  setState({ search: { ...getState().search, ...patch } });
}

export function resetSearch(context) {
  setState({ search: { context, query: '', highlight: 0 } });
}

/**
 * @param {object} options
 * @param {string} options.context      Unique key so two search boxes don't share a query.
 * @param {string} options.placeholder
 * @param {(entry: object) => void} options.onSelectEntry
 * @param {(text: string) => void} options.onCreateCustom
 */
export function AddItemSearch({ context, placeholder = 'Add an item…', onSelectEntry, onCreateCustom }) {
  const { db } = getState();
  const search = getSearchState(context);
  const query = search.query;

  const entries = query ? searchEntries(db, query, MAX_RESULTS) : [];
  const exact = query ? matchEntry(db, query) : null;
  const canCreate = Boolean(query.trim()) && !exact;

  // The create row is the last selectable option when it's shown.
  const optionCount = entries.length + (canCreate ? 1 : 0);
  const highlight = optionCount === 0 ? -1 : Math.min(search.highlight, optionCount - 1);

  const commit = (index) => {
    if (index < 0) return;
    if (index < entries.length) {
      onSelectEntry(entries[index]);
    } else if (canCreate) {
      onCreateCustom(query.trim());
    }
    resetSearch(context);
  };

  const onKeydown = (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (optionCount === 0) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = (highlight + delta + optionCount) % optionCount;
      setSearchState({ highlight: next });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      commit(highlight >= 0 ? highlight : 0);
    } else if (event.key === 'Escape') {
      resetSearch(context);
    }
  };

  const input = h('input', {
    className: 'search-input',
    type: 'text',
    value: query,
    placeholder,
    autocomplete: 'off',
    autocapitalize: 'off',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'done',
    'aria-label': placeholder,
    dataset: { focusKey: `search:${context}` },
    onInput: (event) => setSearchState({ context, query: event.target.value, highlight: 0 }),
    onKeydown,
  });

  const results =
    optionCount > 0
      ? h(
          'ul',
          { className: 'search-results', role: 'listbox' },
          entries.map((entry, index) =>
            h(
              'li',
              { role: 'presentation' },
              h(
                'button',
                {
                  className: `search-result${index === highlight ? ' is-highlighted' : ''}`,
                  type: 'button',
                  role: 'option',
                  'aria-selected': index === highlight ? 'true' : 'false',
                  onMousedown: (event) => event.preventDefault(), // keep focus in the input
                  onClick: () => commit(index),
                },
                h('span', { className: 'search-result-emoji' }, entry.emoji ?? '🛒'),
                h(
                  'span',
                  { className: 'search-result-text' },
                  h('span', { className: 'search-result-name' }, entry.name),
                  h(
                    'span',
                    {
                      className: 'search-result-category',
                      style: { '--category-color': categoryColor(entry.category) },
                    },
                    categoryLabel(entry.category),
                    entry.isCustom ? ' · yours' : '',
                  ),
                ),
              ),
            ),
          ),
          canCreate
            ? h(
                'li',
                { role: 'presentation' },
                h(
                  'button',
                  {
                    className: `search-result search-result-new${
                      highlight === entries.length ? ' is-highlighted' : ''
                    }`,
                    type: 'button',
                    role: 'option',
                    'aria-selected': highlight === entries.length ? 'true' : 'false',
                    onMousedown: (event) => event.preventDefault(),
                    onClick: () => commit(entries.length),
                  },
                  h('span', { className: 'search-result-emoji' }, '✏️'),
                  h(
                    'span',
                    { className: 'search-result-text' },
                    h('span', { className: 'search-result-name' }, `Add “${query.trim()}”`),
                    h('span', { className: 'search-result-category' }, 'New item — pick an aisle'),
                  ),
                ),
              )
            : null,
        )
      : null;

  const container = h(
    'div',
    { className: 'search' },
    h(
      'div',
      { className: 'search-field' },
      h('span', { className: 'search-icon', 'aria-hidden': 'true' }, iconPlus()),
      input,
    ),
    results,
  );

  // Measured after mount: the node is not in the document yet, and the caller
  // mounts synchronously right after this returns.
  if (results) {
    requestAnimationFrame(() => {
      if (results.isConnected) positionResults(container, results);
    });
  }

  return container;
}
