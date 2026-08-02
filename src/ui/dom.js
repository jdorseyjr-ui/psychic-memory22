/**
 * Tiny DOM helpers. The app re-renders a whole screen on every state change,
 * which keeps the render path trivial to reason about; `captureFocus` /
 * `restoreFocus` are what make that safe while the user is typing.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * h('button', { className: 'btn', onClick: fn }, 'Add')
 * Props: `className`, `style` (object), `dataset` (object), `on*` handlers,
 * anything else becomes an attribute (or a property for form values).
 */
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  applyProps(el, props);
  append(el, children);
  return el;
}

/** Same as `h`, for SVG icons. */
export function svg(tag, props = null, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props, true);
  append(el, children);
  return el;
}

function applyProps(el, props, isSvg = false) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'className') {
      if (isSvg) el.setAttribute('class', value);
      else el.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      for (const [prop, propValue] of Object.entries(value)) {
        // Custom properties need setProperty; Object.assign silently drops them.
        if (prop.startsWith('--')) el.style.setProperty(prop, propValue);
        else el.style[prop] = propValue;
      }
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'value' || key === 'checked' || key === 'disabled') {
      el[key] = value;
    } else if (value === true) {
      el.setAttribute(key, '');
    } else {
      el.setAttribute(key, value);
    }
  }
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

/** Replace an element's children in one shot. */
export function mount(root, ...children) {
  root.replaceChildren();
  append(root, children);
  return root;
}

/**
 * Remember which field is focused (by its `data-focus-key`) and where the
 * caret sits, so a re-render mid-typing doesn't steal focus.
 */
export function captureFocus() {
  const el = document.activeElement;
  const key = el?.dataset?.focusKey;
  if (!key) return null;

  let selection = null;
  try {
    selection = { start: el.selectionStart, end: el.selectionEnd };
  } catch {
    selection = null; // number inputs throw on selectionStart in some browsers
  }
  return { key, selection };
}

export function restoreFocus(snapshot) {
  if (!snapshot) return;
  const el = document.querySelector(`[data-focus-key="${cssEscape(snapshot.key)}"]`);
  if (!el) return;

  el.focus({ preventScroll: true });
  if (snapshot.selection && typeof el.setSelectionRange === 'function') {
    try {
      el.setSelectionRange(snapshot.selection.start, snapshot.selection.end);
    } catch {
      /* not a text-selectable input */
    }
  }
}

function cssEscape(value) {
  return typeof CSS !== 'undefined' && CSS.escape
    ? CSS.escape(value)
    : String(value).replace(/["\\]/g, '\\$&');
}

/** "today" / "yesterday" / "3 days ago" / a date, for list cards. */
export function relativeDate(iso) {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000);

  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function pluralCount(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
