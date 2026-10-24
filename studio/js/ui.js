/**
 * The Studio's small DOM toolkit: build elements, toasts, dialogs, a busy
 * overlay, and the formatting every view shares. No framework - the Studio is
 * a handful of screens, and every one of them is easier to read as plain DOM.
 */

/**
 * h('button.btn.primary', { onclick, disabled: true }, 'Save')
 *
 * The tag may carry .classes and a #id. Props starting with "on" are
 * listeners; `dataset`, `style` (object) and `attrs` are merged in; anything
 * else is set as a property. Children may be strings, nodes, arrays, or
 * null/false (skipped).
 */
export function h(spec, props, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(spec);
  const node = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    m[2].replace(/([.#])([\w-]+)/g, (_, kind, name) => {
      if (kind === '.') node.classList.add(name); else node.id = name;
      return '';
    });
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key === 'attrs') for (const [a, v] of Object.entries(value)) node.setAttribute(a, v);
    else if (key === 'class') node.className += ' ' + value;
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export const $ = (selector, root = document) => root.querySelector(selector);

/** An icon from the sprite in studio/index.html. */
export function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ico ' + cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#s-' + name);
  svg.appendChild(use);
  return svg;
}

// ------------------------------------------------------------------ toasts
let toastHost = null;

export function toast(message, kind = 'info', ms = 4200) {
  if (!toastHost) {
    toastHost = h('div.toasts', { attrs: { role: 'status', 'aria-live': 'polite' } });
    document.body.appendChild(toastHost);
  }
  const node = h('div.toast.' + kind, message);
  toastHost.appendChild(node);
  setTimeout(() => node.classList.add('out'), ms);
  setTimeout(() => node.remove(), ms + 400);
  return node;
}

/** Turn an error from Firebase or anywhere else into one readable sentence. */
export function explain(err) {
  const code = err && err.code;
  const friendly = {
    'permission-denied': 'Your account is not allowed to do that.',
    'storage/unauthorized': 'Your account is not allowed to upload that.',
    'unavailable': 'Firebase could not be reached. Check the connection and try again.',
    'auth/popup-closed-by-user': 'The sign-in window was closed before finishing.',
    'auth/network-request-failed': 'The network dropped during sign-in.',
    'auth/unauthorized-domain': 'This site is not on the project\'s list of authorised domains (Authentication > Settings > Authorised domains).',
    'storage/canceled': 'The upload was cancelled.',
    'storage/quota-exceeded': 'The storage quota is used up.',
  }[code];
  if (friendly) return friendly;
  return String((err && err.message) || err || 'Something went wrong.').replace(/^Firebase:\s*/, '');
}

// ------------------------------------------------------------------ dialogs
/**
 * A modal with a body and buttons. Resolves with the value of the button
 * pressed, or null when dismissed. `build(body, close)` fills the body.
 */
export function dialog({ title, build, buttons = [{ label: 'Close', value: null }], wide = false }) {
  return new Promise((resolve) => {
    const body = h('div.dialog-body');
    const close = (value) => {
      document.removeEventListener('keydown', onKey);
      backdrop.classList.add('out');
      setTimeout(() => backdrop.remove(), 180);
      resolve(value === undefined ? null : value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    const foot = h('div.dialog-foot', buttons.map((b) =>
      h('button.btn' + (b.kind ? '.' + b.kind : ''), {
        type: 'button',
        onclick: async () => {
          if (b.validate && !(await b.validate(body))) return;
          close(typeof b.value === 'function' ? b.value(body) : b.value);
        },
      }, b.label)));
    const card = h('div.dialog' + (wide ? '.wide' : ''), { attrs: { role: 'dialog', 'aria-modal': 'true' } },
      h('header.dialog-head', h('h2', title),
        h('button.icon-btn', { type: 'button', onclick: () => close(null), attrs: { 'aria-label': 'Close' } }, icon('close'))),
      body, foot);
    const backdrop = h('div.backdrop', { onclick: (e) => { if (e.target === backdrop) close(null); } }, card);
    document.body.appendChild(backdrop);
    document.addEventListener('keydown', onKey);
    if (build) build(body, close);
    const first = body.querySelector('input, textarea, select');
    if (first) setTimeout(() => first.focus(), 30);
  });
}

export function confirm(title, message, { ok = 'Confirm', danger = false } = {}) {
  return dialog({
    title,
    build: (body) => append(body, [h('p', message)]),
    buttons: [{ label: 'Cancel', value: false }, { label: ok, value: true, kind: danger ? 'danger' : 'primary' }],
  }).then((v) => !!v);
}

// ------------------------------------------------------------------ busy
let busyNode = null;

/** A blocking progress overlay for long jobs. Returns { set(fraction, text), done() }. */
export function busy(title, text = '') {
  if (busyNode) busyNode.remove();
  const bar = h('div.busy-fill');
  const label = h('p.busy-text', text);
  busyNode = h('div.backdrop.busy', h('div.dialog.busy-card',
    h('div.spinner'), h('h2', title), label, h('div.busy-meter', bar)));
  document.body.appendChild(busyNode);
  const node = busyNode;
  return {
    set(fraction, message) {
      if (typeof fraction === 'number') bar.style.transform = `scaleX(${Math.max(0, Math.min(1, fraction))})`;
      if (message !== undefined) label.textContent = message;
    },
    done() { node.remove(); if (busyNode === node) busyNode = null; },
  };
}

// ------------------------------------------------------------------ formats
export function bytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
}

export function when(value) {
  const d = toDate(value);
  if (!d) return '—';
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  return null;
}

export function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function debounce(fn, ms) {
  let t = null;
  const run = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  run.flush = (...args) => { clearTimeout(t); return fn(...args); };
  return run;
}

/** A labelled field row: label above, control, optional hint below. */
export function field(label, control, hint) {
  return h('label.field', h('span.field-label', label), control, hint ? h('span.field-hint', hint) : null);
}

/** <input type=number> that reports a finite number, or the fallback. */
export function numberInput(value, { step = 0.01, min, max, onchange, oninput, width } = {}) {
  const input = h('input.num', { type: 'number', step, value: round(value, step) });
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  if (width) input.style.width = width;
  const read = () => {
    const v = parseFloat(input.value);
    return Number.isFinite(v) ? v : value;
  };
  if (onchange) input.addEventListener('change', () => onchange(read()));
  if (oninput) input.addEventListener('input', () => { const v = parseFloat(input.value); if (Number.isFinite(v)) oninput(v); });
  input.setValue = (v) => { if (document.activeElement !== input) input.value = round(v, step); };
  return input;
}

export function round(v, step = 0.01) {
  if (!Number.isFinite(v)) return 0;
  const digits = Math.max(0, Math.min(6, Math.ceil(-Math.log10(step))));
  return Number(v.toFixed(digits));
}

/** A row of mutually exclusive buttons. */
export function segmented(options, value, onchange) {
  const host = h('div.segmented');
  const draw = (current) => {
    clear(host);
    options.forEach(([v, label]) => host.appendChild(h('button' + (v === current ? '.on' : ''), {
      type: 'button', onclick: () => { draw(v); onchange(v); },
    }, label)));
  };
  draw(value);
  host.setValue = draw;
  return host;
}

export function toggle(on, onchange, label) {
  const input = h('input', { type: 'checkbox', checked: !!on, onchange: () => onchange(input.checked) });
  return h('label.toggle', input, h('span.track'), label ? h('span.toggle-label', label) : null);
}

/** Pick a file with the system dialog. Resolves a File, or null. */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

/** Make a node a drop target for files. */
export function dropTarget(node, onFile) {
  node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('drag'); });
  node.addEventListener('dragleave', () => node.classList.remove('drag'));
  node.addEventListener('drop', (e) => {
    e.preventDefault();
    node.classList.remove('drag');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) onFile(file);
  });
}

/** Copy text, falling back to a prompt where the clipboard is blocked. */
export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to the clipboard.', 'ok'); }
  catch { window.prompt('Copy this:', text); }
}
