/** Row on the lists overview: name, item count, last edited (spec §8.1). */

import { h, relativeDate, pluralCount } from '../dom.js';
import { itemCount, checkedCount } from '../../core/model.js';
import { iconChevronRight, iconTrash, iconPencil } from '../icons.js';

export function ListCard({ list, onOpen, onRename, onDelete }) {
  const total = itemCount(list);
  const checked = checkedCount(list);
  const inProgress = checked > 0 && checked < total;

  return h(
    'li',
    { className: 'list-card' },
    h(
      'button',
      { className: 'list-card-main', type: 'button', onClick: onOpen },
      h(
        'span',
        { className: 'list-card-text' },
        h('span', { className: 'list-card-name' }, list.name),
        h(
          'span',
          { className: 'list-card-meta' },
          total === 0 ? 'Empty' : pluralCount(total, 'item'),
          ' · ',
          `edited ${relativeDate(list.updatedAt)}`,
          inProgress ? h('span', { className: 'list-card-progress' }, `${checked}/${total} picked up`) : null,
        ),
      ),
      iconChevronRight(),
    ),
    h(
      'div',
      { className: 'list-card-actions' },
      h(
        'button',
        { className: 'icon-btn', type: 'button', 'aria-label': `Rename ${list.name}`, onClick: onRename },
        iconPencil(),
      ),
      h(
        'button',
        {
          className: 'icon-btn icon-btn-danger',
          type: 'button',
          'aria-label': `Delete ${list.name}`,
          onClick: onDelete,
        },
        iconTrash(),
      ),
    ),
  );
}
