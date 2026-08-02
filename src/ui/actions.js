/**
 * Every mutation the UI can perform. Components call these; they never call
 * `dataStore` directly. Each action reads the current record, produces a
 * modified copy, and writes it back — `dataStore` stamps `updatedAt` and
 * schedules the autosave (spec §4.1).
 */

import * as dataStore from '../core/dataStore.js';
import {
  createList,
  createItem,
  createRecipeInstance,
  createRecipeDefinition,
  instantiateRecipe,
  toIngredient,
  findItem,
  allRecords,
  isLive,
  visibleRecipeItems,
} from '../core/model.js';
import { now } from '../core/id.js';
import { createCustomEntry, defaultUnitFor } from '../core/groceryDb.js';
import { OTHER_CATEGORY } from '../core/categories.js';

// --- Lists -----------------------------------------------------------------

export async function addList(name) {
  const list = createList(name);
  await dataStore.saveList(list);
  return list;
}

export async function renameList(listId, name) {
  return withList(listId, (list) => {
    list.name = name.trim() || list.name;
  });
}

/** Attach a share code, marking the list as synced (see `core/sync/`). */
export async function setListShareCode(listId, shareCode) {
  return withList(listId, (list) => {
    list.shareCode = shareCode;
  });
}

export async function removeList(listId) {
  await dataStore.deleteList(listId);
}

/**
 * Create the local half of a list joined from a share link. The server's list
 * id is reused so both devices address the same rows; contents arrive on the
 * first sync.
 */
export async function adoptSharedList({ id, name, shareCode, updatedAt }) {
  const list = {
    ...createList(name),
    id,
    shareCode,
    updatedAt: updatedAt ?? now(),
  };
  await dataStore.saveList(list);
  return list;
}

function currentList(listId) {
  return dataStore.snapshot().lists.find((list) => list.id === listId) ?? null;
}

/** Clone → mutate → save. Returns the saved record, or null if it's gone. */
async function withList(listId, mutator) {
  const existing = currentList(listId);
  if (!existing) return null;
  const draft = structuredClone(existing);
  mutator(draft);
  return dataStore.saveList(draft);
}

// --- Items -----------------------------------------------------------------

/**
 * Add an item at the list's top level, or nested under `recipeId` when the
 * user is in recipe-building mode.
 */
export async function addItem(listId, { dbEntry = null, name = '', recipeId = null }) {
  const item = createItem({ dbEntry, name, recipeId });
  await withList(listId, (list) => {
    if (recipeId) {
      const recipe = list.recipes.find((candidate) => candidate.id === recipeId);
      if (recipe) recipe.items.push(item);
      else list.items.push({ ...item, recipeId: null });
    } else {
      list.items.push(item);
    }
  });
  return item;
}

export async function updateItem(listId, itemId, patch) {
  return withList(listId, (list) => {
    const { item } = findItem(list, itemId);
    if (!item) return;
    Object.assign(item, patch);
    if (patch.unit && patch.unit !== 'other') item.unitLabel = null;
    item.updatedAt = now();
  });
}

/**
 * Soft delete. The record stays as a tombstone so the other device learns the
 * item is gone instead of pushing its own copy back (see `model.isLive`).
 */
export async function removeItem(listId, itemId) {
  return withList(listId, (list) => {
    const { item } = findItem(list, itemId);
    if (!item) return;
    item.deleted = true;
    item.updatedAt = now();
  });
}

/** Check/uncheck every item behind a (possibly merged) shopping-mode line. */
export async function setItemsChecked(listId, itemIds, checked) {
  const targets = new Set(itemIds);
  return withList(listId, (list) => {
    for (const item of allRecords(list).items) {
      if (targets.has(item.id) && item.checked !== checked) {
        item.checked = checked;
        item.updatedAt = now();
      }
    }
  });
}

export async function setAllChecked(listId, checked) {
  return withList(listId, (list) => {
    for (const item of allRecords(list).items) {
      if (isLive(item) && item.checked !== checked) {
        item.checked = checked;
        item.updatedAt = now();
      }
    }
  });
}

// --- Recipes on a list -----------------------------------------------------

/** Start a brand-new recipe on a list; returns the created instance. */
export async function startRecipe(listId, name) {
  const instance = createRecipeInstance({ name });
  await withList(listId, (list) => {
    list.recipes.push(instance);
  });
  return instance;
}

/** Drop a copy of a saved recipe onto a list (spec §5.3). */
export async function addSavedRecipe(listId, definition) {
  const instance = instantiateRecipe(definition);
  await withList(listId, (list) => {
    list.recipes.push(instance);
  });
  return instance;
}

export async function renameRecipeInstance(listId, recipeId, name) {
  return withList(listId, (list) => {
    const recipe = list.recipes.find((candidate) => candidate.id === recipeId);
    if (!recipe) return;
    recipe.name = name.trim() || recipe.name;
    recipe.updatedAt = now();
  });
}

/**
 * Remove a recipe and its nested items; the library definition is untouched
 * (spec §5.4). Tombstoned rather than spliced, and the ingredients are
 * tombstoned individually so a device that only knows the items still drops
 * them.
 */
export async function removeRecipeInstance(listId, recipeId) {
  return withList(listId, (list) => {
    const recipe = list.recipes.find((candidate) => candidate.id === recipeId);
    if (!recipe) return;
    const timestamp = now();
    recipe.deleted = true;
    recipe.updatedAt = timestamp;
    for (const item of recipe.items) {
      item.deleted = true;
      item.updatedAt = timestamp;
    }
  });
}

/**
 * Persist a just-built recipe into the library (spec §5.3). Called when the
 * user presses "End Recipe" on a recipe they created from scratch; recipes
 * added *from* the library are skipped so later edits stay list-local.
 */
export async function saveRecipeToLibrary(listId, recipeId) {
  const list = currentList(listId);
  const recipe = list?.recipes.find((candidate) => candidate.id === recipeId);
  if (!recipe || visibleRecipeItems(recipe).length === 0) return null;

  const definition = createRecipeDefinition({
    name: recipe.name,
    ingredients: visibleRecipeItems(recipe).map(toIngredient),
  });
  await dataStore.saveRecipe(definition);
  await withList(listId, (draft) => {
    const target = draft.recipes.find((candidate) => candidate.id === recipeId);
    if (target) target.recipeDefId = definition.id;
  });
  return definition;
}

// --- Recipe library --------------------------------------------------------

export async function renameRecipeDefinition(recipeId, name) {
  const definition = dataStore.snapshot().recipes.find((recipe) => recipe.id === recipeId);
  if (!definition) return null;
  return dataStore.saveRecipe({ ...structuredClone(definition), name: name.trim() || definition.name });
}

export async function removeRecipeDefinition(recipeId) {
  await dataStore.deleteRecipe(recipeId);
}

export async function updateRecipeIngredients(recipeId, mutator) {
  const definition = dataStore.snapshot().recipes.find((recipe) => recipe.id === recipeId);
  if (!definition) return null;
  const draft = structuredClone(definition);
  mutator(draft);
  return dataStore.saveRecipe(draft);
}

export async function addIngredientToDefinition(recipeId, { dbEntry = null, name = '' }) {
  return updateRecipeIngredients(recipeId, (draft) => {
    draft.ingredients.push({
      dbEntryId: dbEntry ? dbEntry.id : null,
      name: dbEntry ? dbEntry.name : name.trim(),
      quantity: 1,
      unit: defaultUnitFor(dbEntry),
      unitLabel: null,
    });
  });
}

// --- Custom database entries ----------------------------------------------

/** Save freeform text as a reusable database entry (spec §4.3). */
export async function addCustomEntry(name, category = OTHER_CATEGORY) {
  const entry = createCustomEntry(name, category);
  await dataStore.saveCustomEntry(entry);
  return entry;
}

export async function removeCustomEntry(entryId) {
  await dataStore.deleteCustomEntry(entryId);
}
