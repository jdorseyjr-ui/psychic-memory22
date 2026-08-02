/** Hash-based routing (spec §8). No dependencies, back button works. */

import { setState } from './state.js';

const ROUTES = [
  { pattern: /^\/?$/, build: () => ({ name: 'lists', params: {} }) },
  { pattern: /^\/lists$/, build: () => ({ name: 'lists', params: {} }) },
  { pattern: /^\/recipes$/, build: () => ({ name: 'recipeLibrary', params: {} }) },
  { pattern: /^\/recipes\/([^/]+)$/, build: (m) => ({ name: 'recipeDetail', params: { recipeId: m[1] } }) },
  { pattern: /^\/list\/([^/]+)\/shop$/, build: (m) => ({ name: 'shopping', params: { listId: m[1] } }) },
  { pattern: /^\/list\/([^/]+)$/, build: (m) => ({ name: 'listEdit', params: { listId: m[1] } }) },
];

export function parseHash(hash = window.location.hash) {
  const path = decodeURI(hash.replace(/^#/, '')) || '/';
  for (const route of ROUTES) {
    const match = path.match(route.pattern);
    if (match) return route.build(match);
  }
  return { name: 'notFound', params: { path } };
}

export function navigate(path) {
  const target = `#${path}`;
  if (window.location.hash === target) syncRoute();
  else window.location.hash = target;
}

export function replace(path) {
  window.history.replaceState(null, '', `#${path}`);
  syncRoute();
}

export function back(fallback = '/lists') {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback);
}

function syncRoute() {
  setState({ route: parseHash() });
}

export function startRouter() {
  window.addEventListener('hashchange', syncRoute);
  syncRoute();
}

export const paths = {
  lists: () => '/lists',
  list: (id) => `/list/${encodeURIComponent(id)}`,
  shopping: (id) => `/list/${encodeURIComponent(id)}/shop`,
  recipes: () => '/recipes',
  recipe: (id) => `/recipes/${encodeURIComponent(id)}`,
};
