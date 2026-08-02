/**
 * Share and join flows.
 *
 * Sharing a list mints a 128-bit code, registers the list on the server, and
 * hands back a link. Opening that link on another device adopts the list —
 * same code, same server rows, so both devices converge from then on.
 */

import { h } from './dom.js';
import { getState, showToast } from './state.js';
import { confirmAction } from './modal.js';
import * as actions from './actions.js';
import * as transport from '../core/sync/transport.js';
import { navigate, paths } from './router.js';
import { isSharingConfigured } from '../config.js';

/** The URL to text to the other person. */
export function shareLink(shareCode) {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#/join/${shareCode}`;
}

/**
 * Share a list. Returns the link, or null if the user cancelled or the
 * network refused — in which case the list stays local and unchanged.
 */
export async function shareList(list, { engine }) {
  if (list.shareCode) return shareLink(list.shareCode);

  const confirmed = await confirmAction({
    title: `Share “${list.name}”?`,
    message:
      'You get a private link to send to one person. Anyone with the link can view and edit this list, so treat it like a house key.',
    confirmLabel: 'Create link',
  });
  if (!confirmed) return null;

  const shareCode = transport.generateShareCode();
  try {
    await transport.createSharedList({ listId: list.id, shareCode, name: list.name });
  } catch (error) {
    showToast(
      error.retryable
        ? 'No connection — try sharing again once you’re online.'
        : 'Couldn’t create the share link.',
    );
    return null;
  }

  await actions.setListShareCode(list.id, shareCode);
  engine?.syncNow();
  return shareLink(shareCode);
}

/**
 * Adopt a shared list from a link. If this device already has it, just open
 * it rather than creating a duplicate.
 */
export async function joinList(shareCode, { engine }) {
  const existing = getState().data.lists.find((list) => list.shareCode === shareCode);
  if (existing) {
    navigate(paths.list(existing.id));
    return existing;
  }

  let remote;
  try {
    remote = await transport.pullList(shareCode);
  } catch (error) {
    showToast(
      error.retryable ? 'No connection — open the link again when you’re online.' : 'Couldn’t open that link.',
    );
    return null;
  }

  if (!remote) {
    showToast('That share link is no longer valid.');
    navigate(paths.lists());
    return null;
  }

  // Adopt the server's list id so both devices address the same rows.
  const list = await actions.adoptSharedList({
    id: remote.id,
    name: remote.name,
    shareCode,
    updatedAt: remote.updatedAt,
  });

  await engine?.syncNow();
  showToast(`Joined “${remote.name}”`);
  navigate(paths.list(list.id));
  return list;
}

/** Copy helper that degrades to a selectable input when the API is blocked. */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * A compact status line for a shared list: whether the other device's changes
 * have landed, and whether we're currently cut off.
 */
export function SyncBadge({ list, sync }) {
  if (!isSharingConfigured() || !list.shareCode) return null;

  const { status } = sync ?? {};
  const label =
    status === 'offline'
      ? 'Offline — changes saved here'
      : status === 'syncing'
        ? 'Syncing…'
        : status === 'error'
          ? 'Sync problem'
          : 'Shared · up to date';

  return h(
    'span',
    { className: `sync-badge sync-badge-${status ?? 'idle'}` },
    h('span', { className: 'sync-dot', 'aria-hidden': 'true' }),
    label,
  );
}
