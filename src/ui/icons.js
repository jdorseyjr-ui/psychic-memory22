/** Simple line icons for controls (spec §7: emoji for items, line art for UI). */

import { svg } from './dom.js';

function icon(className, ...paths) {
  return svg(
    'svg',
    {
      className: `icon ${className}`,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    },
    ...paths,
  );
}

const path = (d) => svg('path', { d });

export const iconCheck = () => icon('icon-check', path('M4 12.5 9.5 18 20 6.5'));
export const iconTrash = () =>
  icon(
    'icon-trash',
    path('M4 7h16'),
    path('M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'),
    path('M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12'),
  );
export const iconChevronRight = () => icon('icon-chevron', path('M9 5l7 7-7 7'));
export const iconChevronDown = () => icon('icon-chevron', path('M5 9l7 7 7-7'));
export const iconPlus = () => icon('icon-plus', path('M12 5v14'), path('M5 12h14'));
export const iconBack = () => icon('icon-back', path('M15 5l-7 7 7 7'));
export const iconCart = () =>
  icon(
    'icon-cart',
    path('M3 4h2l2.6 11.2a2 2 0 0 0 2 1.6h7.2a2 2 0 0 0 2-1.5L21 8H6'),
    svg('circle', { cx: '10', cy: '20', r: '1' }),
    svg('circle', { cx: '17', cy: '20', r: '1' }),
  );
export const iconBook = () =>
  icon(
    'icon-book',
    path('M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z'),
    path('M4 19a2 2 0 0 1 2-2h13'),
  );
export const iconMore = () =>
  icon(
    'icon-more',
    svg('circle', { cx: '12', cy: '5', r: '1' }),
    svg('circle', { cx: '12', cy: '12', r: '1' }),
    svg('circle', { cx: '12', cy: '19', r: '1' }),
  );
export const iconPencil = () =>
  icon('icon-pencil', path('M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z'), path('M14.5 6.5l3 3'));
export const iconClose = () => icon('icon-close', path('M6 6l12 12'), path('M18 6L6 18'));
