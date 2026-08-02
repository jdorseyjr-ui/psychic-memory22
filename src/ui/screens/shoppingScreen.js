/**
 * Shopping Mode View (spec §6, §8.5).
 *
 * Aisle-grouped, duplicate-merged, one big tap target per line. Checked lines
 * dim and strike through *in place* so the layout never jumps while you shop.
 */

import { h } from '../dom.js';
import { getState } from '../state.js';
import { buildShoppingView, allItems } from '../../core/model.js';
import { formatQuantity } from '../../core/units.js';
import { confirmAction } from '../modal.js';
import * as actions from '../actions.js';
import { navigate, paths } from '../router.js';
import { iconBack, iconCheck } from '../icons.js';

export function ShoppingScreen({ listId }) {
  const { data, db } = getState();
  const list = data.lists.find((candidate) => candidate.id === listId);

  if (!list) {
    navigate(paths.lists());
    return h('div', { className: 'screen' });
  }

  const sections = buildShoppingView(list, db);
  const items = allItems(list);
  const checked = items.filter((item) => item.checked).length;
  const progress = items.length === 0 ? 0 : Math.round((checked / items.length) * 100);
  const done = items.length > 0 && checked === items.length;

  return h(
    'div',
    { className: 'screen screen-shopping' },
    h(
      'header',
      { className: 'app-header app-header-shopping' },
      h(
        'div',
        { className: 'app-header-row' },
        h(
          'button',
          {
            className: 'icon-btn icon-btn-lg',
            type: 'button',
            'aria-label': 'Back to list',
            onClick: () => navigate(paths.list(list.id)),
          },
          iconBack(),
        ),
        h('h1', { className: 'app-title' }, list.name),
        checked > 0
          ? h(
              'button',
              {
                className: 'btn btn-ghost btn-small',
                type: 'button',
                onClick: async () => {
                  const confirmed = await confirmAction({
                    title: 'Uncheck everything?',
                    message: 'Useful when you start a fresh trip with the same list.',
                    confirmLabel: 'Uncheck all',
                  });
                  if (confirmed) await actions.setAllChecked(list.id, false);
                },
              },
              'Reset',
            )
          : null,
      ),
      h(
        'div',
        { className: 'progress' },
        h('div', { className: 'progress-bar' }, h('div', { className: 'progress-fill', style: { width: `${progress}%` } })),
        h(
          'span',
          { className: 'progress-label' },
          done ? 'All picked up 🎉' : `${checked} of ${items.length} picked up`,
        ),
      ),
    ),

    h(
      'main',
      { className: 'screen-body' },
      sections.length === 0
        ? h(
            'div',
            { className: 'empty-state' },
            h('span', { className: 'empty-emoji', 'aria-hidden': 'true' }, '🛒'),
            h('h2', {}, 'Nothing to shop for'),
            h('p', {}, 'Add items to this list first.'),
          )
        : sections.map((section) => AisleSection(list, section)),
    ),

    h(
      'div',
      { className: 'screen-footer' },
      h(
        'button',
        {
          className: 'btn btn-secondary btn-block',
          type: 'button',
          onClick: () => navigate(paths.list(list.id)),
        },
        'Exit shopping mode',
      ),
    ),
  );
}

function AisleSection(list, section) {
  return h(
    'section',
    { className: 'aisle', style: { '--category-color': section.color } },
    h(
      'h2',
      { className: 'aisle-header' },
      h('span', { className: 'aisle-name' }, section.label),
      h('span', { className: 'aisle-count' }, `${section.checkedCount}/${section.lines.length}`),
    ),
    h(
      'ul',
      { className: 'shop-list' },
      section.lines.map((line) => ShopLine(list, line)),
    ),
  );
}

function ShopLine(list, line) {
  // Checking a merged line checks every item behind it (spec §6).
  const toggle = () => actions.setItemsChecked(list.id, line.itemIds, !line.checked);

  return h(
    'li',
    { className: `shop-line${line.checked ? ' is-checked' : ''}` },
    h(
      'button',
      {
        className: 'shop-line-button',
        type: 'button',
        role: 'checkbox',
        'aria-checked': line.checked ? 'true' : 'false',
        onClick: toggle,
      },
      h(
        'span',
        { className: 'checkbox', 'aria-hidden': 'true' },
        line.checked ? iconCheck() : null,
      ),
      h('span', { className: 'shop-emoji', 'aria-hidden': 'true' }, line.emoji ?? '🛒'),
      h(
        'span',
        { className: 'shop-text' },
        h('span', { className: 'shop-name' }, line.name),
        line.sources.length > 0
          ? h('span', { className: 'shop-sources' }, line.sources.join(' · '))
          : null,
      ),
      h(
        'span',
        { className: 'shop-qty' },
        formatQuantity(line.quantity, line.unit, line.unitLabel),
        line.itemIds.length > 1
          ? h('span', { className: 'shop-merge-badge' }, `${line.itemIds.length}×`)
          : null,
      ),
    ),
  );
}
