/**
 * List Edit View (spec §8.2) plus the recipe-building sub-view (spec §8.3).
 *
 * Recipe building is a mode on this screen rather than a separate route, so
 * the standalone items stay visible behind it and the same `AddItemSearch`
 * component is reused — it just gets a different `recipeId` target.
 */

import { h, pluralCount } from '../dom.js';
import { getState, setState, updateState, showToast } from '../state.js';
import { AddItemSearch, resetSearch } from '../components/addItemSearch.js';
import { ItemRow } from '../components/itemRow.js';
import { RecipeCard } from '../components/recipeCard.js';
import { promptText, confirmAction, chooseOption, pickCategory } from '../modal.js';
import * as actions from '../actions.js';
import { navigate, paths } from '../router.js';
import { itemCount, checkedCount } from '../../core/model.js';
import { categoryLabel } from '../../core/categories.js';
import { iconBack, iconCart, iconPlus, iconCheck } from '../icons.js';

export function ListEditScreen({ listId }) {
  const { data, db, building, afterRecipePrompt } = getState();
  const list = data.lists.find((candidate) => candidate.id === listId);

  if (!list) return MissingList();

  const buildingRecipe =
    building && building.listId === listId
      ? list.recipes.find((recipe) => recipe.id === building.recipeInstanceId) ?? null
      : null;

  const total = itemCount(list);
  const checked = checkedCount(list);

  return h(
    'div',
    { className: 'screen' },
    h(
      'header',
      { className: 'app-header' },
      h(
        'div',
        { className: 'app-header-row' },
        h(
          'button',
          {
            className: 'icon-btn icon-btn-lg',
            type: 'button',
            'aria-label': 'Back to lists',
            onClick: () => navigate(paths.lists()),
          },
          iconBack(),
        ),
        h(
          'button',
          {
            className: 'app-title app-title-button',
            type: 'button',
            title: 'Rename list',
            onClick: async () => {
              const name = await promptText({
                title: 'Rename list',
                label: 'List name',
                value: list.name,
              });
              if (name) await actions.renameList(list.id, name);
            },
          },
          list.name,
        ),
      ),
      h(
        'p',
        { className: 'app-subtitle' },
        total === 0 ? 'Empty list' : pluralCount(total, 'item'),
        checked > 0 ? ` · ${checked} checked off` : '',
      ),
    ),

    h(
      'main',
      { className: 'screen-body' },
      buildingRecipe
        ? BuildingBanner(buildingRecipe)
        : afterRecipePrompt?.listId === listId
          ? AfterRecipePrompt(list)
          : null,

      buildingRecipe
        ? null
        : h(
            'div',
            { className: 'add-row' },
            AddItemSearch({
              context: `list:${list.id}`,
              placeholder: 'Add an item…',
              onSelectEntry: (entry) => actions.addItem(list.id, { dbEntry: entry }),
              onCreateCustom: (text) => createCustomItem(list.id, text, null),
            }),
            h(
              'button',
              { className: 'btn btn-secondary', type: 'button', onClick: () => addRecipeFlow(list) },
              iconPlus(),
              'Add recipe',
            ),
          ),

      total === 0 && !buildingRecipe
        ? h(
            'div',
            { className: 'empty-state empty-state-compact' },
            h('span', { className: 'empty-emoji', 'aria-hidden': 'true' }, '🛒'),
            h('p', {}, 'Search the grocery database above, or add a recipe to group ingredients together.'),
          )
        : null,

      list.items.length > 0
        ? h(
            'ul',
            { className: 'item-list' },
            list.items.map((item) =>
              ItemRow({
                item,
                db,
                focusKey: `item:${item.id}`,
                onChange: (patch) => actions.updateItem(list.id, item.id, patch),
                onDelete: () => actions.removeItem(list.id, item.id),
              }),
            ),
          )
        : null,

      list.recipes.map((recipe) => RecipeSection(list, recipe, buildingRecipe)),
    ),

    h(
      'div',
      { className: 'screen-footer' },
      buildingRecipe
        ? h(
            'button',
            {
              className: 'btn btn-primary btn-block',
              type: 'button',
              onClick: () => endRecipe(list, buildingRecipe),
            },
            iconCheck(),
            'End recipe',
          )
        : h(
            'button',
            {
              className: 'btn btn-primary btn-block',
              type: 'button',
              disabled: total === 0,
              onClick: () => navigate(paths.shopping(list.id)),
            },
            iconCart(),
            'Start shopping',
          ),
    ),
  );
}

// --- Recipe sections -------------------------------------------------------

function RecipeSection(list, recipe, buildingRecipe) {
  const { db, collapsedRecipes } = getState();
  const isBuilding = buildingRecipe?.id === recipe.id;

  return RecipeCard({
    recipe,
    db,
    collapsed: collapsedRecipes.has(recipe.id),
    isBuilding,
    onToggleCollapse: () =>
      updateState((state) => {
        if (state.collapsedRecipes.has(recipe.id)) state.collapsedRecipes.delete(recipe.id);
        else state.collapsedRecipes.add(recipe.id);
      }),
    onRename: async () => {
      const name = await promptText({
        title: 'Rename recipe',
        label: 'Recipe name',
        value: recipe.name,
      });
      if (name) await actions.renameRecipeInstance(list.id, recipe.id, name);
    },
    onAddItems: () => {
      resetSearch(`recipe:${recipe.id}`);
      setState({
        building: { listId: list.id, recipeInstanceId: recipe.id, isNew: false },
        afterRecipePrompt: null,
      });
    },
    onDelete: async () => {
      const confirmed = await confirmAction({
        title: `Remove “${recipe.name}” from this list?`,
        message:
          recipe.items.length > 0
            ? `Its ${pluralCount(recipe.items.length, 'ingredient')} will be removed too. The saved recipe stays in your library.`
            : 'The saved recipe stays in your library.',
        confirmLabel: 'Remove',
        danger: true,
      });
      if (confirmed) {
        if (buildingRecipe?.id === recipe.id) setState({ building: null });
        await actions.removeRecipeInstance(list.id, recipe.id);
      }
    },
    onItemChange: (itemId, patch) => actions.updateItem(list.id, itemId, patch),
    onItemDelete: (itemId) => actions.removeItem(list.id, itemId),
    children: isBuilding
      ? h(
          'div',
          { className: 'add-row add-row-nested' },
          AddItemSearch({
            context: `recipe:${recipe.id}`,
            placeholder: `Add an ingredient to ${recipe.name}…`,
            onSelectEntry: (entry) => actions.addItem(list.id, { dbEntry: entry, recipeId: recipe.id }),
            onCreateCustom: (text) => createCustomItem(list.id, text, recipe.id),
          }),
        )
      : null,
  });
}

function BuildingBanner(recipe) {
  return h(
    'div',
    { className: 'banner' },
    h('span', { className: 'banner-emoji', 'aria-hidden': 'true' }, '🍲'),
    h(
      'div',
      {},
      h('strong', {}, `Building “${recipe.name}”`),
      h('p', {}, 'Items you add now go inside this recipe. Press “End recipe” when you’re done.'),
    ),
  );
}

/** The lightweight two-button choice after "End Recipe" (spec §5.2). */
function AfterRecipePrompt(list) {
  const dismiss = () => setState({ afterRecipePrompt: null });

  return h(
    'div',
    { className: 'banner banner-choice' },
    h('p', { className: 'banner-question' }, 'Recipe saved. What next?'),
    h(
      'div',
      { className: 'banner-buttons' },
      h(
        'button',
        {
          className: 'btn btn-secondary',
          type: 'button',
          onClick: () => {
            dismiss();
            focusListSearch(list.id);
          },
        },
        'Add another item',
      ),
      h(
        'button',
        {
          className: 'btn btn-secondary',
          type: 'button',
          onClick: () => {
            dismiss();
            addRecipeFlow(list, { forceNew: true });
          },
        },
        'Start another recipe',
      ),
      h('button', { className: 'btn btn-ghost', type: 'button', onClick: dismiss }, 'Done'),
    ),
  );
}

// --- Flows -----------------------------------------------------------------

async function addRecipeFlow(list, { forceNew = false } = {}) {
  const { data } = getState();
  const saved = data.recipes;

  let choice = 'new';
  if (!forceNew && saved.length > 0) {
    choice = await chooseOption({
      title: 'Add a recipe',
      options: [
        { value: 'new', label: 'Build a new recipe', description: 'Name it, then add ingredients', emoji: '🍲' },
        {
          value: 'saved',
          label: 'Choose from saved',
          description: pluralCount(saved.length, 'recipe', 'recipes') + ' in your library',
          emoji: '📖',
        },
      ],
    });
    if (!choice) return;
  }

  if (choice === 'saved') {
    const recipeId = await chooseOption({
      title: 'Saved recipes',
      message: 'Its ingredients are copied onto this list.',
      options: saved.map((definition) => ({
        value: definition.id,
        label: definition.name,
        description: pluralCount(definition.ingredients.length, 'ingredient'),
        emoji: '📗',
      })),
    });
    if (!recipeId) return;
    const definition = saved.find((candidate) => candidate.id === recipeId);
    const instance = await actions.addSavedRecipe(list.id, definition);
    showToast(`Added “${instance.name}”`);
    return;
  }

  const name = await promptText({
    title: 'New recipe',
    label: 'Recipe name',
    placeholder: 'Chicken tacos',
    confirmLabel: 'Start',
  });
  if (!name) return;

  const instance = await actions.startRecipe(list.id, name);
  resetSearch(`recipe:${instance.id}`);
  setState({
    building: { listId: list.id, recipeInstanceId: instance.id, isNew: true },
    afterRecipePrompt: null,
  });
  focusSearch(`recipe:${instance.id}`);
}

async function endRecipe(list, recipe) {
  const { building } = getState();

  // An abandoned, empty recipe would just be clutter on the list.
  if (recipe.items.length === 0) {
    setState({ building: null, afterRecipePrompt: null });
    if (building?.isNew) await actions.removeRecipeInstance(list.id, recipe.id);
    return;
  }

  // Only the original build session writes to the library, so later edits on
  // this list stay local to the list (spec §5.3).
  if (building?.isNew) await actions.saveRecipeToLibrary(list.id, recipe.id);

  setState({
    building: null,
    afterRecipePrompt: building?.isNew ? { listId: list.id } : null,
  });
  if (!building?.isNew) showToast(`Updated “${recipe.name}” on this list`);
}

/**
 * Freeform item: save it to the database under a category the user picks, so
 * it autocompletes next time (spec §4.3).
 */
async function createCustomItem(listId, text, recipeId) {
  const category = await pickCategory({
    title: `Where does “${text}” live?`,
    message: 'It gets saved to your grocery database so it autocompletes next time.',
    selected: 'other',
  });
  if (!category) return;

  const entry = await actions.addCustomEntry(text, category);
  await actions.addItem(listId, { dbEntry: entry, recipeId });
  showToast(`Saved “${entry.name}” to ${categoryLabel(category)}`);
  focusSearch(recipeId ? `recipe:${recipeId}` : `list:${listId}`);
}

function focusListSearch(listId) {
  focusSearch(`list:${listId}`);
}

function focusSearch(context) {
  requestAnimationFrame(() => {
    document.querySelector(`[data-focus-key="search:${context}"]`)?.focus();
  });
}

function MissingList() {
  return h(
    'div',
    { className: 'screen' },
    h(
      'main',
      { className: 'screen-body' },
      h(
        'div',
        { className: 'empty-state' },
        h('span', { className: 'empty-emoji', 'aria-hidden': 'true' }, '🤷'),
        h('h2', {}, 'List not found'),
        h('p', {}, 'It may have been deleted on this device.'),
        h(
          'button',
          { className: 'btn btn-primary', type: 'button', onClick: () => navigate(paths.lists()) },
          'Back to lists',
        ),
      ),
    ),
  );
}
