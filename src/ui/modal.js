/**
 * Promise-based dialogs. Native `prompt`/`confirm` are blocked in some mobile
 * browsers and can't be styled, so these are small in-app sheets instead.
 * Each resolves with the user's answer, or null when dismissed.
 */

import { h, mount } from './dom.js';
import { CATEGORIES, categoryLabel } from '../core/categories.js';

const root = () => document.getElementById('modal-root');

function openSheet(build) {
  return new Promise((resolve) => {
    let settled = false;
    const close = (value) => {
      if (settled) return;
      settled = true;
      document.removeEventListener('keydown', onKeyDown, true);
      mount(root());
      document.body.classList.remove('modal-open');
      resolve(value);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(null);
      }
    };

    const panel = h('div', { className: 'sheet', role: 'dialog', 'aria-modal': 'true' });
    const backdrop = h('div', {
      className: 'sheet-backdrop',
      onClick: (event) => {
        if (event.target === event.currentTarget) close(null);
      },
    }, panel);

    build(panel, close);
    document.addEventListener('keydown', onKeyDown, true);
    document.body.classList.add('modal-open');
    mount(root(), backdrop);

    const focusTarget = panel.querySelector('[data-autofocus]');
    if (focusTarget) requestAnimationFrame(() => focusTarget.focus());
  });
}

/** Single-field text prompt. Resolves with the trimmed string, or null. */
export function promptText({ title, label = '', value = '', placeholder = '', confirmLabel = 'Save' }) {
  return openSheet((panel, close) => {
    const input = h('input', {
      className: 'field',
      type: 'text',
      value,
      placeholder,
      'data-autofocus': true,
      autocomplete: 'off',
      onKeydown: (event) => {
        if (event.key === 'Enter') submit();
      },
    });

    const submit = () => {
      const text = input.value.trim();
      if (text) close(text);
      else input.focus();
    };

    panel.append(
      h('h2', { className: 'sheet-title' }, title),
      label ? h('label', { className: 'sheet-label' }, label) : null,
      input,
      h(
        'div',
        { className: 'sheet-actions' },
        h('button', { className: 'btn btn-ghost', type: 'button', onClick: () => close(null) }, 'Cancel'),
        h('button', { className: 'btn btn-primary', type: 'button', onClick: submit }, confirmLabel),
      ),
    );
  });
}

/** Yes/no confirmation. Resolves true/false. */
export function confirmAction({ title, message = '', confirmLabel = 'Confirm', danger = false }) {
  return openSheet((panel, close) => {
    panel.append(
      h('h2', { className: 'sheet-title' }, title),
      message ? h('p', { className: 'sheet-message' }, message) : null,
      h(
        'div',
        { className: 'sheet-actions' },
        h('button', { className: 'btn btn-ghost', type: 'button', onClick: () => close(false) }, 'Cancel'),
        h(
          'button',
          {
            className: `btn ${danger ? 'btn-danger' : 'btn-primary'}`,
            type: 'button',
            'data-autofocus': true,
            onClick: () => close(true),
          },
          confirmLabel,
        ),
      ),
    );
  }).then((value) => value === true);
}

/** Vertical list of choices. Resolves with the chosen option's `value`. */
export function chooseOption({ title, message = '', options }) {
  return openSheet((panel, close) => {
    panel.append(
      h('h2', { className: 'sheet-title' }, title),
      message ? h('p', { className: 'sheet-message' }, message) : null,
      h(
        'div',
        { className: 'sheet-options' },
        options.map((option, index) =>
          h(
            'button',
            {
              className: 'sheet-option',
              type: 'button',
              'data-autofocus': index === 0 || undefined,
              onClick: () => close(option.value),
            },
            option.emoji ? h('span', { className: 'sheet-option-emoji' }, option.emoji) : null,
            h(
              'span',
              { className: 'sheet-option-text' },
              h('span', { className: 'sheet-option-label' }, option.label),
              option.description
                ? h('span', { className: 'sheet-option-description' }, option.description)
                : null,
            ),
          ),
        ),
      ),
      h(
        'div',
        { className: 'sheet-actions' },
        h('button', { className: 'btn btn-ghost', type: 'button', onClick: () => close(null) }, 'Cancel'),
      ),
    );
  });
}

/**
 * Quick category picker for custom items (spec §4.3) — a grid of chips
 * defaulting to "Other".
 */
export function pickCategory({ title = 'Which aisle?', message = '', selected = 'other' } = {}) {
  return openSheet((panel, close) => {
    panel.append(
      h('h2', { className: 'sheet-title' }, title),
      message ? h('p', { className: 'sheet-message' }, message) : null,
      h(
        'div',
        { className: 'category-grid' },
        CATEGORIES.map((category) =>
          h(
            'button',
            {
              className: `category-chip${category.id === selected ? ' is-selected' : ''}`,
              type: 'button',
              style: { '--category-color': category.color },
              'data-autofocus': category.id === selected || undefined,
              onClick: () => close(category.id),
            },
            category.label,
          ),
        ),
      ),
      h(
        'div',
        { className: 'sheet-actions' },
        h('button', { className: 'btn btn-ghost', type: 'button', onClick: () => close(null) }, 'Cancel'),
        h(
          'button',
          { className: 'btn btn-primary', type: 'button', onClick: () => close(selected) },
          `Use ${categoryLabel(selected)}`,
        ),
      ),
    );
  });
}
