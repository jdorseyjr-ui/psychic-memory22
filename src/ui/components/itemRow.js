/**
 * A single item row (spec §4.4). Shared by the list level, recipe nesting, and
 * the recipe library's ingredient editor — the caller supplies the callbacks.
 */

import { h } from '../dom.js';
import { UNITS } from '../../core/units.js';
import { categoryOf, emojiOf } from '../../core/groceryDb.js';
import { categoryLabel, categoryColor } from '../../core/categories.js';
import { iconTrash } from '../icons.js';

/**
 * @param {object} options
 * @param {object} options.item        ListItem (or a definition ingredient with an `id`).
 * @param {object} options.db
 * @param {string} options.focusKey    Stable key for caret preservation across re-renders.
 * @param {(patch: object) => void} options.onChange
 * @param {() => void} options.onDelete
 */
export function ItemRow({ item, db, focusKey, onChange, onDelete }) {
  const category = categoryOf(db, item);
  const emoji = emojiOf(db, item);
  const isOther = item.unit === 'other';

  return h(
    'li',
    {
      className: `item-row${item.checked ? ' is-checked' : ''}`,
      style: { '--category-color': categoryColor(category) },
    },
    h('span', { className: 'item-emoji', 'aria-hidden': 'true' }, emoji ?? '🛒'),
    h(
      'div',
      { className: 'item-main' },
      h('span', { className: 'item-name' }, item.name),
      h('span', { className: 'item-category' }, categoryLabel(category)),
    ),
    h(
      'div',
      { className: 'item-controls' },
      h('input', {
        className: 'qty-input',
        type: 'number',
        min: '0',
        step: 'any',
        inputmode: 'decimal',
        value: item.quantity,
        'aria-label': `Quantity of ${item.name}`,
        dataset: { focusKey: `${focusKey}:qty` },
        onInput: (event) => {
          const value = Number(event.target.value);
          if (event.target.value === '' || Number.isNaN(value)) return;
          onChange({ quantity: value });
        },
        onBlur: (event) => {
          if (event.target.value === '') onChange({ quantity: 1 });
        },
      }),
      h(
        'select',
        {
          className: 'unit-select',
          'aria-label': `Unit for ${item.name}`,
          dataset: { focusKey: `${focusKey}:unit` },
          onChange: (event) => onChange({ unit: event.target.value }),
        },
        UNITS.map((unit) =>
          h('option', { value: unit.id, selected: unit.id === item.unit }, unit.label),
        ),
      ),
      isOther
        ? h('input', {
            className: 'unit-label-input',
            type: 'text',
            value: item.unitLabel ?? '',
            placeholder: 'bunch, can…',
            'aria-label': `Custom unit for ${item.name}`,
            dataset: { focusKey: `${focusKey}:unitLabel` },
            onInput: (event) => onChange({ unitLabel: event.target.value }),
          })
        : null,
      h(
        'button',
        {
          className: 'icon-btn icon-btn-danger',
          type: 'button',
          'aria-label': `Delete ${item.name}`,
          onClick: onDelete,
        },
        iconTrash(),
      ),
    ),
  );
}
