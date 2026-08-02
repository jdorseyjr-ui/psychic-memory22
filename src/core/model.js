/**
 * Record factories and the derived views described in spec §3 and §6.
 *
 * Pure functions only — no storage, no DOM. `buildShoppingView` is the one
 * piece of real logic here: it flattens the structured list into merged,
 * aisle-grouped lines for shopping mode.
 */

import { uuid, now } from './id.js';
import { normalize } from './text.js';
import { categoryOf, emojiOf, getEntry, defaultUnitFor } from './groceryDb.js';
import { aisleIndex, categoryLabel, categoryColor } from './categories.js';
import { DEFAULT_UNIT } from './units.js';

// --- Factories -------------------------------------------------------------

export function createList(name) {
  const timestamp = now();
  return {
    id: uuid(),
    name: name.trim() || 'Untitled list',
    items: [],
    recipes: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    /** Set once the list is shared; the secret that grants access (§ sharing). */
    shareCode: null,
  };
}

export function createItem({
  dbEntry = null,
  name = '',
  quantity = 1,
  unit = null,
  unitLabel = null,
  recipeId = null,
} = {}) {
  return {
    id: uuid(),
    dbEntryId: dbEntry ? dbEntry.id : null,
    name: dbEntry ? dbEntry.name : name.trim(),
    quantity: Number(quantity) || 1,
    unit: unit ?? (dbEntry ? defaultUnitFor(dbEntry) : DEFAULT_UNIT),
    unitLabel: unitLabel ?? null,
    checked: false,
    recipeId,
    updatedAt: now(),
    deleted: false,
  };
}

export function createRecipeInstance({ name, recipeDefId = null, items = [] }) {
  const id = uuid();
  return {
    id,
    recipeDefId,
    name: name.trim() || 'Untitled recipe',
    items: items.map((item) => ({
      ...item,
      id: uuid(),
      recipeId: id,
      checked: false,
      updatedAt: now(),
      deleted: false,
    })),
    updatedAt: now(),
    deleted: false,
  };
}

export function createRecipeDefinition({ name, ingredients = [] }) {
  const timestamp = now();
  return {
    id: uuid(),
    name: name.trim() || 'Untitled recipe',
    ingredients: ingredients.map(toIngredient),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** A `RecipeDefinition` ingredient is a `ListItem` minus its instance state. */
export function toIngredient(item) {
  return {
    dbEntryId: item.dbEntryId ?? null,
    name: item.name,
    quantity: Number(item.quantity) || 1,
    unit: item.unit ?? DEFAULT_UNIT,
    unitLabel: item.unitLabel ?? null,
  };
}

/** Materialize a saved definition into a list instance (spec §5.3). */
export function instantiateRecipe(definition) {
  return createRecipeInstance({
    name: definition.name,
    recipeDefId: definition.id,
    items: definition.ingredients.map((ingredient) => createItem({ ...ingredient })),
  });
}

// --- Derived views ---------------------------------------------------------

/**
 * Deleted records are kept as tombstones so a delete on one device isn't
 * resurrected by another device's stale copy. Everything user-facing goes
 * through these filters; only the sync layer sees tombstones.
 */
export function isLive(record) {
  return !record.deleted;
}

/** Standalone items still on the list. */
export function visibleItems(list) {
  return list.items.filter(isLive);
}

/** Recipes still on the list. */
export function visibleRecipes(list) {
  return list.recipes.filter(isLive);
}

/** A recipe's surviving ingredients. */
export function visibleRecipeItems(recipe) {
  return recipe.items.filter(isLive);
}

/** Every live item on a list: standalone first, then each recipe's ingredients. */
export function allItems(list) {
  return [
    ...visibleItems(list),
    ...visibleRecipes(list).flatMap((recipe) => visibleRecipeItems(recipe)),
  ];
}

/** Every record including tombstones — for the sync layer only. */
export function allRecords(list) {
  return {
    items: [...list.items, ...list.recipes.flatMap((recipe) => recipe.items)],
    recipes: list.recipes,
  };
}

export function itemCount(list) {
  return allItems(list).length;
}

export function checkedCount(list) {
  return allItems(list).filter((item) => item.checked).length;
}

/** Find a live item anywhere on the list, along with its owning recipe (if any). */
export function findItem(list, itemId) {
  const standalone = list.items.find((item) => item.id === itemId && isLive(item));
  if (standalone) return { item: standalone, recipe: null };
  for (const recipe of list.recipes) {
    if (!isLive(recipe)) continue;
    const found = recipe.items.find((item) => item.id === itemId && isLive(item));
    if (found) return { item: found, recipe };
  }
  return { item: null, recipe: null };
}

/**
 * Shopping-mode view (spec §6): merge duplicates, group by aisle.
 *
 * Merging is unit-aware and deliberately conservative — lines only combine
 * when the item *and* the unit match exactly. "2 eggs" and "1 dozen eggs" stay
 * separate, but sort adjacently because they share a name.
 */
export function buildShoppingView(list, db) {
  const sourceNames = new Map(list.recipes.map((recipe) => [recipe.id, recipe.name]));
  const lines = new Map();

  for (const item of allItems(list)) {
    const key = mergeKey(item);
    let line = lines.get(key);

    if (!line) {
      line = {
        key,
        name: displayName(db, item),
        emoji: emojiOf(db, item),
        category: categoryOf(db, item),
        unit: item.unit,
        unitLabel: item.unitLabel ?? null,
        quantity: 0,
        checked: true,
        itemIds: [],
        sources: [],
      };
      lines.set(key, line);
    }

    line.quantity += Number(item.quantity) || 0;
    line.itemIds.push(item.id);
    line.checked = line.checked && Boolean(item.checked);

    const source = item.recipeId ? sourceNames.get(item.recipeId) : null;
    if (source && !line.sources.includes(source)) line.sources.push(source);
  }

  const sections = new Map();
  for (const line of lines.values()) {
    if (!sections.has(line.category)) {
      sections.set(line.category, {
        category: line.category,
        label: categoryLabel(line.category),
        color: categoryColor(line.category),
        lines: [],
      });
    }
    sections.get(line.category).lines.push(line);
  }

  const ordered = [...sections.values()].sort(
    (a, b) => aisleIndex(a.category) - aisleIndex(b.category),
  );
  for (const section of ordered) {
    section.lines.sort(
      (a, b) => a.name.localeCompare(b.name) || String(a.unit).localeCompare(String(b.unit)),
    );
    section.checkedCount = section.lines.filter((line) => line.checked).length;
  }

  return ordered;
}

/**
 * Two items merge when they are the same product in the same unit. Items
 * resolved to a database entry merge on that entry's id, so "apples" typed on
 * one line and "Apple" picked from search collapse together; freeform items
 * fall back to their normalized name.
 */
function mergeKey(item) {
  const identity = item.dbEntryId ? `db:${item.dbEntryId}` : `free:${normalize(item.name)}`;
  const unit = item.unit === 'other' ? `other:${normalize(item.unitLabel ?? '')}` : item.unit;
  return `${identity}|${unit}`;
}

function displayName(db, item) {
  const entry = getEntry(db, item.dbEntryId);
  return entry ? entry.name : item.name;
}
