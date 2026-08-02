/**
 * Recipe Library (spec §5.3, §8.4): view, rename, delete, and edit a saved
 * recipe's ingredients. Edits here change the definition only — instances
 * already sitting on lists are untouched, and vice versa.
 */

import { h, relativeDate, pluralCount } from '../dom.js';
import { getState } from '../state.js';
import { AddItemSearch } from '../components/addItemSearch.js';
import { ItemRow } from '../components/itemRow.js';
import { promptText, confirmAction, chooseOption, pickCategory } from '../modal.js';
import * as actions from '../actions.js';
import { navigate, paths, back } from '../router.js';
import { iconBack, iconChevronRight, iconTrash, iconPencil, iconPlus } from '../icons.js';

export function RecipeLibraryScreen() {
  const { data } = getState();
  const recipes = [...data.recipes].sort((a, b) => a.name.localeCompare(b.name));

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
            'aria-label': 'Back',
            onClick: () => navigate(paths.lists()),
          },
          iconBack(),
        ),
        h('h1', { className: 'app-title' }, 'Recipe Library'),
      ),
      h(
        'p',
        { className: 'app-subtitle' },
        recipes.length === 0
          ? 'Recipes you build on a list are saved here automatically.'
          : `${pluralCount(recipes.length, 'recipe', 'recipes')} · reusable on any list`,
      ),
    ),
    h(
      'main',
      { className: 'screen-body' },
      recipes.length === 0
        ? h(
            'div',
            { className: 'empty-state' },
            h('span', { className: 'empty-emoji', 'aria-hidden': 'true' }, '📖'),
            h('h2', {}, 'No saved recipes'),
            h('p', {}, 'Open a list, tap “Add recipe”, and everything you build is saved here for next time.'),
          )
        : h(
            'ul',
            { className: 'list-cards' },
            recipes.map((recipe) =>
              h(
                'li',
                { className: 'list-card' },
                h(
                  'button',
                  {
                    className: 'list-card-main',
                    type: 'button',
                    onClick: () => navigate(paths.recipe(recipe.id)),
                  },
                  h(
                    'span',
                    { className: 'list-card-text' },
                    h('span', { className: 'list-card-name' }, recipe.name),
                    h(
                      'span',
                      { className: 'list-card-meta' },
                      pluralCount(recipe.ingredients.length, 'ingredient'),
                      ' · ',
                      `updated ${relativeDate(recipe.updatedAt)}`,
                    ),
                  ),
                  iconChevronRight(),
                ),
                h(
                  'div',
                  { className: 'list-card-actions' },
                  h(
                    'button',
                    {
                      className: 'icon-btn',
                      type: 'button',
                      'aria-label': `Rename ${recipe.name}`,
                      onClick: async () => {
                        const name = await promptText({
                          title: 'Rename recipe',
                          label: 'Recipe name',
                          value: recipe.name,
                        });
                        if (name) await actions.renameRecipeDefinition(recipe.id, name);
                      },
                    },
                    iconPencil(),
                  ),
                  h(
                    'button',
                    {
                      className: 'icon-btn icon-btn-danger',
                      type: 'button',
                      'aria-label': `Delete ${recipe.name}`,
                      onClick: () => deleteRecipeFlow(recipe),
                    },
                    iconTrash(),
                  ),
                ),
              ),
            ),
          ),
    ),
    h(
      'div',
      { className: 'screen-footer' },
      h(
        'button',
        {
          className: 'btn btn-secondary btn-block',
          type: 'button',
          onClick: () => addRecipeToListFlow(recipes),
          disabled: recipes.length === 0 || data.lists.length === 0,
        },
        iconPlus(),
        'Add a saved recipe to a list',
      ),
    ),
  );
}

export function RecipeDetailScreen({ recipeId }) {
  const { data, db } = getState();
  const recipe = data.recipes.find((candidate) => candidate.id === recipeId);

  if (!recipe) {
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
          h('h2', {}, 'Recipe not found'),
          h(
            'button',
            { className: 'btn btn-primary', type: 'button', onClick: () => navigate(paths.recipes()) },
            'Back to library',
          ),
        ),
      ),
    );
  }

  // Definition ingredients have no id of their own; index is a stable enough
  // key for a single render pass and keeps the stored shape spec-exact.
  const rows = recipe.ingredients.map((ingredient, index) => ({
    ...ingredient,
    id: `${recipe.id}:${index}`,
    checked: false,
  }));

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
          { className: 'icon-btn icon-btn-lg', type: 'button', 'aria-label': 'Back', onClick: () => back(paths.recipes()) },
          iconBack(),
        ),
        h(
          'button',
          {
            className: 'app-title app-title-button',
            type: 'button',
            title: 'Rename recipe',
            onClick: async () => {
              const name = await promptText({
                title: 'Rename recipe',
                label: 'Recipe name',
                value: recipe.name,
              });
              if (name) await actions.renameRecipeDefinition(recipe.id, name);
            },
          },
          recipe.name,
        ),
      ),
      h('p', { className: 'app-subtitle' }, pluralCount(recipe.ingredients.length, 'ingredient')),
    ),
    h(
      'main',
      { className: 'screen-body' },
      h(
        'div',
        { className: 'add-row' },
        AddItemSearch({
          context: `recipeDef:${recipe.id}`,
          placeholder: 'Add an ingredient…',
          onSelectEntry: (entry) => actions.addIngredientToDefinition(recipe.id, { dbEntry: entry }),
          onCreateCustom: async (text) => {
            const category = await pickCategory({
              title: `Where does “${text}” live?`,
              message: 'It gets saved to your grocery database too.',
            });
            if (!category) return;
            const entry = await actions.addCustomEntry(text, category);
            await actions.addIngredientToDefinition(recipe.id, { dbEntry: entry });
          },
        }),
      ),
      rows.length === 0
        ? h(
            'div',
            { className: 'empty-state empty-state-compact' },
            h('p', {}, 'No ingredients yet — add some above.'),
          )
        : h(
            'ul',
            { className: 'item-list' },
            rows.map((row, index) =>
              ItemRow({
                item: row,
                db,
                focusKey: `ingredient:${recipe.id}:${index}`,
                onChange: (patch) =>
                  actions.updateRecipeIngredients(recipe.id, (draft) => {
                    Object.assign(draft.ingredients[index], patch);
                    if (patch.unit && patch.unit !== 'other') draft.ingredients[index].unitLabel = null;
                  }),
                onDelete: () =>
                  actions.updateRecipeIngredients(recipe.id, (draft) => {
                    draft.ingredients.splice(index, 1);
                  }),
              }),
            ),
          ),
    ),
    h(
      'div',
      { className: 'screen-footer' },
      h(
        'button',
        { className: 'btn btn-danger btn-block', type: 'button', onClick: () => deleteRecipeFlow(recipe, true) },
        iconTrash(),
        'Delete recipe',
      ),
    ),
  );
}

async function deleteRecipeFlow(recipe, returnToLibrary = false) {
  const confirmed = await confirmAction({
    title: `Delete “${recipe.name}”?`,
    message: 'Lists that already use this recipe keep their copy.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!confirmed) return;
  await actions.removeRecipeDefinition(recipe.id);
  if (returnToLibrary) navigate(paths.recipes());
}

async function addRecipeToListFlow(recipes) {
  const { data } = getState();

  const recipeId = await chooseOption({
    title: 'Which recipe?',
    options: recipes.map((recipe) => ({
      value: recipe.id,
      label: recipe.name,
      description: pluralCount(recipe.ingredients.length, 'ingredient'),
      emoji: '📗',
    })),
  });
  if (!recipeId) return;

  const listId = await chooseOption({
    title: 'Add to which list?',
    options: data.lists.map((list) => ({
      value: list.id,
      label: list.name,
      description: `updated ${relativeDate(list.updatedAt)}`,
      emoji: '🧺',
    })),
  });
  if (!listId) return;

  const definition = recipes.find((recipe) => recipe.id === recipeId);
  await actions.addSavedRecipe(listId, definition);
  navigate(paths.list(listId));
}
