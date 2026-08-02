/**
 * Collapsible recipe card with indented ingredients (spec §5.1) — the
 * task → subtask nesting the brief asks for.
 */

import { h, pluralCount } from '../dom.js';
import { ItemRow } from './itemRow.js';
import { visibleRecipeItems } from '../../core/model.js';
import { iconChevronDown, iconChevronRight, iconTrash, iconPlus, iconPencil } from '../icons.js';

/**
 * @param {object} options
 * @param {object} options.recipe      RecipeInstance
 * @param {object} options.db
 * @param {boolean} options.collapsed
 * @param {boolean} options.isBuilding True while this recipe is the active build target.
 */
export function RecipeCard({
  recipe,
  db,
  collapsed,
  isBuilding = false,
  onToggleCollapse,
  onRename,
  onDelete,
  onAddItems,
  onItemChange,
  onItemDelete,
  children = null,
}) {
  const open = isBuilding || !collapsed;
  const items = visibleRecipeItems(recipe);

  return h(
    'section',
    { className: `recipe-card${isBuilding ? ' is-building' : ''}` },
    h(
      'header',
      { className: 'recipe-header' },
      h(
        'button',
        {
          className: 'recipe-toggle',
          type: 'button',
          'aria-expanded': open ? 'true' : 'false',
          onClick: onToggleCollapse,
        },
        open ? iconChevronDown() : iconChevronRight(),
        h(
          'span',
          { className: 'recipe-title' },
          h('span', { className: 'recipe-name' }, recipe.name),
          h(
            'span',
            { className: 'recipe-meta' },
            items.length === 0
              ? 'no ingredients yet'
              : pluralCount(items.length, 'ingredient'),
          ),
        ),
      ),
      h(
        'div',
        { className: 'recipe-actions' },
        onRename
          ? h(
              'button',
              {
                className: 'icon-btn',
                type: 'button',
                'aria-label': `Rename ${recipe.name}`,
                onClick: onRename,
              },
              iconPencil(),
            )
          : null,
        !isBuilding && onAddItems
          ? h(
              'button',
              {
                className: 'icon-btn',
                type: 'button',
                'aria-label': `Add ingredients to ${recipe.name}`,
                onClick: onAddItems,
              },
              iconPlus(),
            )
          : null,
        h(
          'button',
          {
            className: 'icon-btn icon-btn-danger',
            type: 'button',
            'aria-label': `Delete ${recipe.name}`,
            onClick: onDelete,
          },
          iconTrash(),
        ),
      ),
    ),
    open
      ? h(
          'div',
          { className: 'recipe-body' },
          items.length > 0
            ? h(
                'ul',
                { className: 'item-list item-list-nested' },
                items.map((item) =>
                  ItemRow({
                    item,
                    db,
                    focusKey: `item:${item.id}`,
                    onChange: (patch) => onItemChange(item.id, patch),
                    onDelete: () => onItemDelete(item.id),
                  }),
                ),
              )
            : h('p', { className: 'recipe-empty' }, 'Add ingredients below.'),
          children,
        )
      : null,
  );
}
