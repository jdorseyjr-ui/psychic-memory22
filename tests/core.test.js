/**
 * Tests for the DOM-free core: text normalization, database matching, and the
 * shopping-mode merge/grouping logic. Run with `npm test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalize, singularize, pluralize, expandTerms } from '../src/core/text.js';
import {
  buildDatabase,
  matchEntry,
  searchEntries,
  createCustomEntry,
  defaultUnitFor,
  categoryOf,
  getEntry,
} from '../src/core/groceryDb.js';
import { SEED_ENTRIES } from '../src/data/groceryData.js';
import {
  createList,
  createItem,
  createRecipeInstance,
  createRecipeDefinition,
  instantiateRecipe,
  buildShoppingView,
  allItems,
  itemCount,
  findItem,
  toIngredient,
} from '../src/core/model.js';
import { formatQuantity } from '../src/core/units.js';
import { CATEGORIES } from '../src/core/categories.js';

const db = buildDatabase();

// --- text ------------------------------------------------------------------

test('normalize lowercases, trims, and strips punctuation and accents', () => {
  assert.equal(normalize('  Green   Onions! '), 'green onions');
  assert.equal(normalize('Jalapeño'), 'jalapeno');
  assert.equal(normalize(null), '');
});

test('singularize handles regular, -es, -ies and irregular plurals', () => {
  assert.equal(singularize('apples'), 'apple');
  assert.equal(singularize('tomatoes'), 'tomato');
  assert.equal(singularize('berries'), 'berry');
  assert.equal(singularize('loaves'), 'loaf');
  assert.equal(singularize('boxes'), 'box');
  assert.equal(singularize('green onions'), 'green onion');
});

test('singularize leaves uncountable and already-singular words alone', () => {
  assert.equal(singularize('rice'), 'rice');
  assert.equal(singularize('hummus'), 'hummus');
  assert.equal(singularize('asparagus'), 'asparagus');
  assert.equal(singularize('cheese'), 'cheese');
  assert.equal(singularize('apple'), 'apple');
});

test('pluralize is the inverse for the forms we ship', () => {
  assert.equal(pluralize('apple'), 'apples');
  assert.equal(pluralize('tomato'), 'tomatoes');
  assert.equal(pluralize('berry'), 'berries');
  assert.equal(pluralize('loaf'), 'loaves');
  assert.equal(pluralize('rice'), 'rice');
});

test('expandTerms yields both singular and plural forms', () => {
  const terms = expandTerms('Tomato');
  assert.ok(terms.includes('tomato'));
  assert.ok(terms.includes('tomatoes'));
});

// --- grocery database ------------------------------------------------------

test('seed database is large enough and internally consistent', () => {
  assert.ok(SEED_ENTRIES.length >= 150, `expected 150+ entries, got ${SEED_ENTRIES.length}`);

  const ids = new Set();
  const categories = new Set(CATEGORIES.map((category) => category.id));
  for (const entry of SEED_ENTRIES) {
    assert.ok(!ids.has(entry.id), `duplicate id: ${entry.id}`);
    ids.add(entry.id);
    assert.ok(entry.name.length > 0);
    assert.ok(entry.matchTerms.length > 0, `${entry.name} has no match terms`);
    assert.ok(categories.has(entry.category), `${entry.name} has unknown category`);
    assert.equal(entry.isCustom, false);
  }
});

test('singular and plural input resolve to the same entry', () => {
  assert.equal(matchEntry(db, 'apple').id, matchEntry(db, 'apples').id);
  assert.equal(matchEntry(db, 'Tomatoes').id, matchEntry(db, 'tomato').id);
  assert.equal(matchEntry(db, ' LOAF of bread ').name, 'Bread');
});

test('synonyms resolve to the canonical entry', () => {
  assert.equal(matchEntry(db, 'scallions').name, 'Green Onion');
  assert.equal(matchEntry(db, 'mayo').name, 'Mayonnaise');
  assert.equal(matchEntry(db, 'garbanzo beans').name, 'Chickpeas');
});

test('unmatched text returns null so the UI can offer a custom item', () => {
  assert.equal(matchEntry(db, 'dragonfruit smoothie mix'), null);
  assert.equal(matchEntry(db, ''), null);
});

test('search ranks starts-with above contains', () => {
  const names = searchEntries(db, 'app').map((entry) => entry.name);
  assert.equal(names[0], 'Apple');
  assert.ok(names.includes('Apple Juice'));

  const milk = searchEntries(db, 'milk').map((entry) => entry.name);
  assert.equal(milk[0], 'Milk');
  assert.ok(milk.includes('Almond Milk'), 'contains-matches should still appear');
  assert.ok(milk.indexOf('Milk') < milk.indexOf('Almond Milk'));
});

test('search is limited and empty for blank queries', () => {
  assert.deepEqual(searchEntries(db, '   '), []);
  assert.ok(searchEntries(db, 'a', 5).length <= 5);
});

test('per-item and per-category default units are applied', () => {
  assert.equal(defaultUnitFor(matchEntry(db, 'ground beef')), 'lb'); // per-item override
  assert.equal(defaultUnitFor(matchEntry(db, 'apple')), 'count'); // produce default
  assert.equal(defaultUnitFor(matchEntry(db, 'cheddar cheese')), 'oz');
  assert.equal(defaultUnitFor(null), 'count');
});

test('custom entries are searchable once merged into the database', () => {
  const entry = createCustomEntry('Dragonfruit Smoothie Mix', 'frozen');
  assert.equal(entry.isCustom, true);
  assert.equal(entry.category, 'frozen');
  assert.equal(entry.name, 'Dragonfruit Smoothie Mix');

  const merged = buildDatabase([entry]);
  assert.equal(matchEntry(merged, 'dragonfruit smoothie mixes').id, entry.id);
  assert.equal(searchEntries(merged, 'dragon')[0].id, entry.id);
});

test('custom entries default to the Other aisle', () => {
  assert.equal(createCustomEntry('Something Odd').category, 'other');
});

// --- model -----------------------------------------------------------------

test('records carry a stable id and timestamps from v1', () => {
  const list = createList('Weekly');
  assert.match(list.id, /^[0-9a-f-]{36}$/i);
  assert.ok(list.createdAt);
  assert.ok(list.updatedAt);

  const definition = createRecipeDefinition({ name: 'Tacos', ingredients: [] });
  assert.ok(definition.id && definition.createdAt && definition.updatedAt);
});

test('items adopt their database entry name, category, and default unit', () => {
  const item = createItem({ dbEntry: matchEntry(db, 'ground beef') });
  assert.equal(item.name, 'Ground Beef');
  assert.equal(item.unit, 'lb');
  assert.equal(item.quantity, 1);
  assert.equal(item.checked, false);
  assert.equal(item.recipeId, null);
  assert.equal(categoryOf(db, item), 'meat');
});

test('items carry a category/emoji snapshot from their database entry', () => {
  // Denormalized so another device can render the item without owning the
  // database entry it points at.
  const item = createItem({ dbEntry: matchEntry(db, 'ground beef') });
  assert.equal(item.category, 'meat');
  assert.equal(item.emoji, '🥩');
});

test('an item referencing an unknown entry still lands in the right aisle', () => {
  // Exactly what happens when the other person adds a custom item: their
  // database entry never syncs, only the item does.
  const theirEntry = createCustomEntry('Dragonfruit Powder', 'pantry');
  const item = createItem({ dbEntry: theirEntry });
  const myDb = buildDatabase([]); // I have never seen their custom entry

  assert.equal(getEntry(myDb, item.dbEntryId), null, 'the entry really is unknown here');
  assert.equal(categoryOf(myDb, item), 'pantry', 'aisle comes from the snapshot');
  assert.equal(item.name, 'Dragonfruit Powder');
});

test('this device\'s database entry outranks the snapshot', () => {
  // So recategorizing an item locally takes effect instead of being pinned.
  const item = { ...createItem({ dbEntry: matchEntry(db, 'apple') }), category: 'frozen' };
  assert.equal(categoryOf(db, item), 'produce');
});

test('freeform items fall back to the Other aisle', () => {
  const item = createItem({ name: 'Birthday candles' });
  assert.equal(item.dbEntryId, null);
  assert.equal(categoryOf(db, item), 'other');
});

test('recipe ingredients are nested under the instance, not the list', () => {
  const recipe = createRecipeInstance({
    name: 'Tacos',
    items: [createItem({ dbEntry: matchEntry(db, 'tortilla') })],
  });
  assert.equal(recipe.items[0].recipeId, recipe.id);

  const list = createList('Weekly');
  list.items.push(createItem({ dbEntry: matchEntry(db, 'apple') }));
  list.recipes.push(recipe);

  assert.equal(list.items.length, 1, 'nested items must not leak into list.items');
  assert.equal(itemCount(list), 2);
  assert.equal(allItems(list).length, 2);
  assert.equal(findItem(list, recipe.items[0].id).recipe.id, recipe.id);
});

test('instantiating a saved recipe keeps each ingredient linked to its database entry', () => {
  // Without the link, a recipe's tortillas and a manually added tortilla show
  // as two separate lines in shopping mode instead of merging (spec §6).
  const tortilla = matchEntry(db, 'tortilla');
  const definition = createRecipeDefinition({
    name: 'Tacos',
    ingredients: [toIngredient(createItem({ dbEntry: tortilla, quantity: 8 }))],
  });
  const instance = instantiateRecipe(definition);

  assert.equal(instance.items[0].dbEntryId, tortilla.id);
  assert.equal(instance.items[0].category, 'bakery');
});

test('a saved recipe\'s ingredient merges with the same item added by hand', () => {
  const tortilla = matchEntry(db, 'tortilla');
  const definition = createRecipeDefinition({
    name: 'Tacos',
    ingredients: [toIngredient(createItem({ dbEntry: tortilla, quantity: 8 }))],
  });

  const list = createList('Weekly');
  list.items.push(createItem({ dbEntry: tortilla, quantity: 2 }));
  list.recipes.push(instantiateRecipe(definition));

  const lines = buildShoppingView(list, db).flatMap((section) => section.lines);
  assert.equal(lines.length, 1, 'one merged line, not two');
  assert.equal(lines[0].quantity, 10);
  assert.equal(lines[0].itemIds.length, 2);
});

test('instantiating a saved recipe copies ingredients without sharing ids', () => {
  const definition = createRecipeDefinition({
    name: 'Tacos',
    ingredients: [
      { dbEntryId: 'seed:tortilla', name: 'Tortilla', quantity: 8, unit: 'count', unitLabel: null },
    ],
  });
  const first = instantiateRecipe(definition);
  const second = instantiateRecipe(definition);

  assert.equal(first.recipeDefId, definition.id);
  assert.equal(first.items[0].quantity, 8);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.items[0].id, second.items[0].id);

  first.items[0].quantity = 99;
  assert.equal(definition.ingredients[0].quantity, 8, 'definition must not be mutated');
});

// --- shopping view ---------------------------------------------------------

function listWithEggs() {
  const eggs = matchEntry(db, 'eggs');
  const list = createList('Weekly');

  list.items.push(createItem({ dbEntry: eggs, quantity: 12 }));
  const recipe = createRecipeInstance({
    name: 'Pancakes',
    items: [createItem({ dbEntry: eggs, quantity: 2 })],
  });
  list.recipes.push(recipe);
  return { list, recipe };
}

test('same item and unit merge into one line with a combined quantity', () => {
  const { list } = listWithEggs();
  const sections = buildShoppingView(list, db);
  const dairy = sections.find((section) => section.category === 'dairy');

  assert.equal(dairy.lines.length, 1);
  assert.equal(dairy.lines[0].quantity, 14);
  assert.equal(dairy.lines[0].itemIds.length, 2);
  assert.deepEqual(dairy.lines[0].sources, ['Pancakes']);
});

test('same item in different units stays separate but adjacent', () => {
  const { list } = listWithEggs();
  list.items.push(createItem({ dbEntry: matchEntry(db, 'eggs'), quantity: 1, unit: 'pkg' }));

  const dairy = buildShoppingView(list, db).find((section) => section.category === 'dairy');
  assert.equal(dairy.lines.length, 2);
  assert.equal(dairy.lines[0].name, dairy.lines[1].name, 'lines sort adjacently by name');
  assert.deepEqual(dairy.lines.map((line) => line.quantity).sort(), [1, 14]);
});

test('freeform items merge on normalized name, and only within the same unit', () => {
  const list = createList('Weekly');
  list.items.push(createItem({ name: 'Birthday Candles' }));
  list.items.push(createItem({ name: 'birthday candles', quantity: 3 }));
  list.items.push(createItem({ name: 'Birthday Candles', quantity: 2, unit: 'pkg' }));

  const other = buildShoppingView(list, db).find((section) => section.category === 'other');
  assert.equal(other.lines.length, 2);
  assert.equal(other.lines.find((line) => line.unit === 'count').quantity, 4);
});

test('"other" units only merge when the free-text label matches', () => {
  const list = createList('Weekly');
  const kale = matchEntry(db, 'kale');
  list.items.push(createItem({ dbEntry: kale, quantity: 1, unit: 'other', unitLabel: 'bunch' }));
  list.items.push(createItem({ dbEntry: kale, quantity: 2, unit: 'other', unitLabel: 'Bunch' }));
  list.items.push(createItem({ dbEntry: kale, quantity: 1, unit: 'other', unitLabel: 'bag' }));

  const produce = buildShoppingView(list, db).find((section) => section.category === 'produce');
  assert.equal(produce.lines.length, 2);
  assert.equal(produce.lines.find((line) => line.unitLabel === 'bunch').quantity, 3);
});

test('a merged line is checked only when every underlying item is checked', () => {
  const { list, recipe } = listWithEggs();

  let dairy = buildShoppingView(list, db).find((section) => section.category === 'dairy');
  assert.equal(dairy.lines[0].checked, false);

  list.items[0].checked = true;
  dairy = buildShoppingView(list, db).find((section) => section.category === 'dairy');
  assert.equal(dairy.lines[0].checked, false, 'half-checked merged line is not done');

  recipe.items[0].checked = true;
  dairy = buildShoppingView(list, db).find((section) => section.category === 'dairy');
  assert.equal(dairy.lines[0].checked, true);
  assert.equal(dairy.checkedCount, 1);
});

test('sections follow aisle order, not insertion order', () => {
  const list = createList('Weekly');
  list.items.push(createItem({ dbEntry: matchEntry(db, 'ice cream') })); // frozen
  list.items.push(createItem({ dbEntry: matchEntry(db, 'apple') })); // produce
  list.items.push(createItem({ dbEntry: matchEntry(db, 'rice') })); // pantry
  list.items.push(createItem({ dbEntry: matchEntry(db, 'bagel') })); // bakery

  const order = buildShoppingView(list, db).map((section) => section.category);
  assert.deepEqual(order, ['produce', 'bakery', 'frozen', 'pantry']);
});

test('lines are alphabetical within a section', () => {
  const list = createList('Weekly');
  for (const name of ['zucchini', 'apple', 'carrot']) {
    list.items.push(createItem({ dbEntry: matchEntry(db, name) }));
  }
  const produce = buildShoppingView(list, db).find((section) => section.category === 'produce');
  assert.deepEqual(produce.lines.map((line) => line.name), ['Apple', 'Carrot', 'Zucchini']);
});

test('an empty list produces no sections', () => {
  assert.deepEqual(buildShoppingView(createList('Empty'), db), []);
});

// --- units -----------------------------------------------------------------

test('quantities format per unit, with float noise trimmed', () => {
  assert.equal(formatQuantity(3, 'count'), '3');
  assert.equal(formatQuantity(2, 'lb'), '2 lb');
  assert.equal(formatQuantity(0.1 + 0.2, 'cup'), '0.3 cup');
  assert.equal(formatQuantity(1, 'other', 'bunch'), '1 bunch');
  assert.equal(formatQuantity(1, 'other', ''), '1');
});
