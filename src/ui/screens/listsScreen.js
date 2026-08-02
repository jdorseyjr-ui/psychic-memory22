/** Lists Overview (spec §8.1). */

import { h } from '../dom.js';
import { getState } from '../state.js';
import { ListCard } from '../components/listCard.js';
import { promptText, confirmAction } from '../modal.js';
import * as actions from '../actions.js';
import { navigate, paths } from '../router.js';
import { itemCount } from '../../core/model.js';
import { iconPlus, iconBook } from '../icons.js';

export function ListsScreen() {
  const { data } = getState();
  const lists = [...data.lists].sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
  );

  const createList = async () => {
    const name = await promptText({
      title: 'New list',
      label: 'List name',
      placeholder: 'Weekly groceries',
      confirmLabel: 'Create',
    });
    if (!name) return;
    const list = await actions.addList(name);
    navigate(paths.list(list.id));
  };

  return h(
    'div',
    { className: 'screen' },
    h(
      'header',
      { className: 'app-header' },
      h(
        'div',
        { className: 'app-header-row' },
        h('h1', { className: 'app-title' }, 'Shopping Lists'),
        h(
          'button',
          {
            className: 'icon-btn icon-btn-lg',
            type: 'button',
            'aria-label': 'Recipe library',
            onClick: () => navigate(paths.recipes()),
          },
          iconBook(),
        ),
      ),
      h(
        'p',
        { className: 'app-subtitle' },
        lists.length === 0
          ? 'Everything is stored on this device.'
          : `${lists.length} list${lists.length === 1 ? '' : 's'} · stored on this device`,
      ),
    ),
    h(
      'main',
      { className: 'screen-body' },
      lists.length === 0
        ? EmptyState(createList)
        : h(
            'ul',
            { className: 'list-cards' },
            lists.map((list) =>
              ListCard({
                list,
                onOpen: () => navigate(paths.list(list.id)),
                onRename: async () => {
                  const name = await promptText({
                    title: 'Rename list',
                    label: 'List name',
                    value: list.name,
                  });
                  if (name) await actions.renameList(list.id, name);
                },
                onDelete: async () => {
                  const count = itemCount(list);
                  const confirmed = await confirmAction({
                    title: `Delete “${list.name}”?`,
                    message:
                      count > 0
                        ? `${count} item${count === 1 ? '' : 's'} will be removed. Saved recipes stay in your library.`
                        : 'This list is empty.',
                    confirmLabel: 'Delete',
                    danger: true,
                  });
                  if (confirmed) await actions.removeList(list.id);
                },
              }),
            ),
          ),
    ),
    h(
      'div',
      { className: 'screen-footer' },
      h(
        'button',
        { className: 'btn btn-primary btn-block', type: 'button', onClick: createList },
        iconPlus(),
        'New list',
      ),
    ),
  );
}

function EmptyState(onCreate) {
  return h(
    'div',
    { className: 'empty-state' },
    h('span', { className: 'empty-emoji', 'aria-hidden': 'true' }, '🧺'),
    h('h2', {}, 'No lists yet'),
    h('p', {}, 'Create a list, add items from the grocery database, then switch to shopping mode in the store.'),
    h('button', { className: 'btn btn-primary', type: 'button', onClick: onCreate }, 'Create your first list'),
  );
}
