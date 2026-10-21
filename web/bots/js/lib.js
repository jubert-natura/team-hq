// Small DOM helpers for the AI workspace. User text only ever goes in through text nodes / textContent.
import { safeHttpUrl, botStyle, styleOf } from '/shared/bots-model.js';

/** h('div', { class: 'x', onclick: fn, 'aria-label': 'y' }, 'text', child, [more]) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'href') { el.setAttribute('href', String(v)); }
    else if (k === 'innerHTML') throw new Error('innerHTML is not allowed');
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const clear = el => { while (el.firstChild) el.firstChild.remove(); return el; };

/** External link, only for a validated http(s) URL. Returns null for anything else. */
export function extLink(url, label, cls = '') {
  const href = safeHttpUrl(url);
  if (!href) return null;
  return h('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer' }, label, icon('external', 14), h('span', { class: 'sr-only' }, ' (opens in a new tab)'));
}

// ---- inline SVG icons (static, stroke based) ----
const P = d => ['path', { d }];
const C = (cx, cy, r) => ['circle', { cx, cy, r }];
const ICONS = {
  home: [P('M3 10.5 12 3l9 7.5'), P('M5 9.5V20h5v-6h4v6h5V9.5')],
  users: [C(9, 8, 3.2), P('M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5'), P('M16 4.8a3 3 0 0 1 0 6'), P('M18 14.6c2 .6 3.2 2.5 3.5 5.4')],
  history: [P('M3 12a9 9 0 1 0 2.6-6.4L3 8'), P('M3 3v5h5'), P('M12 7.5V12l3 2')],
  chart: [P('M4 20V10'), P('M10 20V4'), P('M16 20v-7'), P('M21 20H3')],
  book: [P('M3 5.5C5.5 4 8.5 4 12 6c3.5-2 6.5-2 9-.5V19c-2.5-1.5-5.5-1.5-9 .5-3.5-2-6.5-2-9-.5z'), P('M12 6v13.5')],
  file: [P('M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z'), P('M14 3v5h5'), P('M8.5 13h7'), P('M8.5 16.5h7')],
  link: [P('M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1'), P('M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1')],
  settings: [C(12, 12, 3), P('M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z')],
  search: [C(11, 11, 7), P('m20 20-3.6-3.6')],
  plus: [P('M12 5v14'), P('M5 12h14')],
  minus: [P('M5 12h14')],
  fit: [P('M4 9V4h5'), P('M20 9V4h-5'), P('M4 15v5h5'), P('M20 15v5h-5')],
  close: [P('M6 6l12 12'), P('M18 6 6 18')],
  menu: [P('M4 6h16'), P('M4 12h16'), P('M4 18h16')],
  chevronDown: [P('m6 9 6 6 6-6')],
  chevronRight: [P('m9 6 6 6-6 6')],
  arrowRight: [P('M5 12h14'), P('m13 6 6 6-6 6')],
  arrowLeft: [P('M19 12H5'), P('m11 6-6 6 6 6')],
  external: [P('M14 4h6v6'), P('M20 4 10 14'), P('M18 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5.5')],
  check: [P('m5 12.5 4.5 4.5L19 7.5')],
  checkCircle: [C(12, 12, 9), P('m8 12.5 3 3 5-6')],
  alert: [C(12, 12, 9), P('M12 7.5v5.5'), P('M12 16.5v.01')],
  warning: [P('M10.3 4 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z'), P('M12 9.5v4'), P('M12 17v.01')],
  info: [C(12, 12, 9), P('M12 11v5.5'), P('M12 7.8v.01')],
  blocked: [C(12, 12, 9), P('m5.6 5.6 12.8 12.8')],
  clock: [C(12, 12, 9), P('M12 7v5l3.2 2')],
  flask: [P('M9 3h6'), P('M10 3v6L4.8 18.2A1.8 1.8 0 0 0 6.4 21h11.2a1.8 1.8 0 0 0 1.6-2.8L14 9V3'), P('M7.5 15h9')],
  bulb: [P('M9 18h6'), P('M10 21h4'), P('M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z')],
  download: [P('M12 4v11'), P('m7 10 5 5 5-5'), P('M5 20h14')],
  folder: [P('M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z')],
  bot: [['rect', { x: 4, y: 8, width: 16, height: 12, rx: 3 }], P('M12 4v4'), C(12, 3.5, 1), P('M9 13v1.5'), P('M15 13v1.5'), P('M2 13v3'), P('M22 13v3')],
  sort: [P('m8 9 4-4 4 4'), P('m8 15 4 4 4-4')],
  calendar: [['rect', { x: 3.5, y: 5, width: 17, height: 15.5, rx: 2 }], P('M8 3v4'), P('M16 3v4'), P('M3.5 10h17')],
  edit: [P('M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z'), P('m13.5 6.5 4 4')],
  shield: [P('M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6z')],
  lock: [['rect', { x: 5, y: 11, width: 14, height: 10, rx: 2 }], P('M8 11V8a4 4 0 0 1 8 0v3')],
  repo: [P('M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z'), P('M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3'), P('M9 7h6')],
  note: [P('M5 4h14v12l-4 4H5z'), P('M15 20v-4h4'), P('M8.5 9h7'), P('M8.5 12.5h4')],
  play: [P('M7 4.5v15l12-7.5z')],
  undo: [P('M9 14 4 9l5-5'), P('M4 9h10.5a5.5 5.5 0 0 1 0 11H11')],
  rotateLeft: [P('M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4 9.5'), P('M4 4.5v5h5')],
  rotateRight: [P('M19.5 12a7.5 7.5 0 1 1-2.2-5.3L20 9.5'), P('M20 4.5v5h-5')],
  dot: [C(12, 12, 4)],
  grid: [['rect', { x: 3.5, y: 3.5, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 13.5, y: 3.5, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 3.5, y: 13.5, width: 7, height: 7, rx: 1.5 }], ['rect', { x: 13.5, y: 13.5, width: 7, height: 7, rx: 1.5 }]],
  archive: [['rect', { x: 3, y: 4, width: 18, height: 5, rx: 1.5 }], P('M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9'), P('M10 13h4')]
};
const NS = 'http://www.w3.org/2000/svg';
export function icon(name, size = 18, cls = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', ('icon ' + cls).trim());
  for (const [tag, attrs] of ICONS[name] || []) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  }
  return svg;
}

// ---- pills ----
export const TONE = {
  working: 'green', waiting: 'amber', blocked: 'red', queued: 'indigo', idle: 'grey',
  in_progress: 'green', completed: 'green', cancelled: 'grey',
  not_requested: 'grey', pending: 'indigo', passed: 'green', changes_requested: 'amber',
  proposed: 'amber', testing: 'indigo', validated: 'green', pass: 'green', fail: 'red',
  disconnected: 'grey', demo: 'amber', manual: 'grey'
};
export function pill(kind, label, extra = '') {
  return h('span', { class: `pill pill-${TONE[kind] || 'grey'} ${extra}`.trim() }, h('span', { class: 'pill-dot', 'aria-hidden': 'true' }), label);
}

/**
 * A bot portrait: a quadrant of the 2x2 sheet in the bot's character style (hue-shifted for the extra styles).
 * Decorative: the name is always shown as text beside it. Pass a style id instead of a bot for a style preview.
 */
export function portrait(b, size = 40, cls = '') {
  const s = typeof b === 'string' ? styleOf(b) : botStyle(b);
  const dims = size ? { width: size + 'px', height: size + 'px' } : {}; // size 0: CSS decides
  return h('span', { class: `portrait ${cls}`.trim(), 'aria-hidden': 'true', style: { ...dims, backgroundPosition: s.sheet, '--bot': s.color, filter: s.hue ? `hue-rotate(${s.hue}deg)` : '' } });
}
export const botColor = b => botStyle(b).color;

// ---- API ----
let dataset = 'real';
export const setDataset = d => { dataset = d === 'demo' ? 'demo' : 'real'; };
export const getDataset = () => dataset;
export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch('/api/bots' + path, {
      method, credentials: 'same-origin',
      headers: { 'X-Bot-Dataset': dataset, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch { throw Object.assign(new Error('Could not reach the server. Check that HQ is running.'), { status: 0 }); }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data || data.ok === false) {
    const msg = (data && data.error) || (res.status === 401 ? 'Signed out. Reload to sign in again.' : `Request failed (${res.status}).`);
    throw Object.assign(new Error(msg), { status: res.status, field: data && data.field });
  }
  return data;
}

// ---- toast ----
let toastT;
export function toast(msg, tone = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg; el.dataset.tone = tone; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 4200);
}

// ---- focus handling ----
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export const focusables = root => [...root.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement);
/** Keep Tab inside `root` until the returned function is called. */
export function trapFocus(root, onEscape) {
  const key = e => {
    if (e.key === 'Escape' && onEscape) { e.preventDefault(); onEscape(); return; }
    if (e.key !== 'Tab') return;
    const f = focusables(root); if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  root.addEventListener('keydown', key);
  return () => root.removeEventListener('keydown', key);
}

// ---- form dialogs (native <dialog>: modal, Escape closes, focus returns to the opener) ----
let fieldSeq = 0;
/**
 * fields: [{ name, label, type: text|textarea|select|url|radio, options: [[value,label]], required, maxlength, hint, value, placeholder }]
 * onSubmit(values) may throw an Error with .field to mark the field.
 */
export function formDialog({ title, description, fields, submitLabel = 'Save', onSubmit, note }) {
  const opener = document.activeElement;
  const err = h('p', { class: 'form-error', role: 'alert' });
  const inputs = {};
  const rows = fields.map(f => {
    const id = `f${++fieldSeq}`, hintId = f.hint ? id + '-hint' : null;
    let input;
    if (f.type === 'textarea') input = h('textarea', { id, name: f.name, rows: f.rows || 3, maxlength: f.maxlength, required: !!f.required, placeholder: f.placeholder, 'aria-describedby': hintId });
    else if (f.type === 'select') input = h('select', { id, name: f.name, required: !!f.required, 'aria-describedby': hintId }, f.options.map(([v, l]) => h('option', { value: v }, l)));
    else if (f.type === 'radio') {
      input = h('div', { class: `radios ${f.cls || ''}`.trim(), role: 'radiogroup', 'aria-labelledby': id + '-l', 'aria-describedby': hintId }, f.options.map(([v, l], i) => h('label', { class: 'radio' },
        h('input', { type: 'radio', name: f.name, value: v, checked: (f.value ? f.value === v : i === 0) }), l)));
    } else input = h('input', { id, name: f.name, type: f.type === 'url' ? 'url' : 'text', maxlength: f.maxlength, required: !!f.required, placeholder: f.placeholder, autocomplete: 'off', 'aria-describedby': hintId, inputmode: f.type === 'url' ? 'url' : null });
    if (f.value !== undefined && f.type !== 'radio') input.value = f.value;
    inputs[f.name] = input;
    return h('div', { class: 'field' },
      f.type === 'radio' ? h('span', { class: 'label', id: id + '-l' }, f.label) : h('label', { for: id, class: 'label' }, f.label, f.required ? null : h('span', { class: 'optional' }, ' (optional)')),
      input, f.hint ? h('p', { class: 'hint', id: hintId }, f.hint) : null);
  });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, submitLabel);
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel');
  const titleId = `d${++fieldSeq}`;
  const form = h('form', { class: 'dialog-form', novalidate: true },
    h('div', { class: 'dialog-head' }, h('h2', { id: titleId }, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => dlg.close() }, icon('close'))),
    description ? h('p', { class: 'dialog-desc' }, description) : null,
    rows, note ? h('p', { class: 'dialog-note' }, icon('info', 16), note) : null, err,
    h('div', { class: 'dialog-actions' }, cancel, submit));
  const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': titleId }, form);
  form.addEventListener('submit', async e => {
    e.preventDefault();
    err.textContent = '';
    for (const i of Object.values(inputs)) i.removeAttribute('aria-invalid');
    const values = {};
    for (const f of fields) {
      if (f.type === 'radio') { const c = form.querySelector(`input[name="${f.name}"]:checked`); values[f.name] = c ? c.value : ''; }
      else values[f.name] = inputs[f.name].value;
      if (f.required && !String(values[f.name]).trim()) { err.textContent = `${f.label} is required.`; inputs[f.name].setAttribute('aria-invalid', 'true'); inputs[f.name].focus(); return; }
    }
    submit.disabled = true; submit.setAttribute('aria-busy', 'true');
    try { await onSubmit(values); dlg.close(); }
    catch (x) {
      err.textContent = x.message || 'Could not save.';
      const bad = x.field && inputs[x.field];
      if (bad) { bad.setAttribute('aria-invalid', 'true'); (bad.querySelector ? bad.querySelector('input') || bad : bad).focus(); }
    } finally { submit.disabled = false; submit.removeAttribute('aria-busy'); }
  });
  dlg.addEventListener('close', () => { dlg.remove(); if (opener && opener.isConnected) opener.focus(); });
  document.body.append(dlg);
  dlg.showModal();
  const first = fields.find(f => f.type !== 'radio');
  (first ? inputs[first.name] : submit).focus();
  return dlg;
}

/** Download text as a file, built in the browser. */
export function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const srOnly = t => h('span', { class: 'sr-only' }, t);

/**
 * Slider switch (role="switch"). `label` names it for assistive tech; the visible On/Off text sits beside it.
 * onToggle(next) receives the new value.
 */
export function slider({ checked, label, onToggle, fkey, disabled = false, small = true }) {
  const btn = h('button', {
    class: 'switch' + (small ? ' switch-sm' : ''), type: 'button', role: 'switch', 'aria-checked': String(!!checked), 'aria-label': label,
    disabled, dataset: fkey ? { fkey } : null, onclick: () => onToggle(!checked)
  }, h('span', { class: 'switch-knob', 'aria-hidden': 'true' }));
  return h('span', { class: 'slider-field' }, btn, h('span', { class: 'slider-text', 'aria-hidden': 'true' }, checked ? 'On' : 'Off'));
}

let openMenu = null;
const closeOpenMenu = (focusButton = false) => { if (openMenu) openMenu(focusButton); };
document.addEventListener('click', e => { if (openMenu && !e.target.closest('.menu-wrap.open')) closeOpenMenu(); });
/**
 * Actions dropdown: a button that opens a menu of commands.
 * items: [{ label, icon, onSelect, danger }] (falsy entries are skipped). Keyboard: Enter/Space/↓ open,
 * ↑/↓/Home/End move, Escape closes and returns focus, Tab closes.
 */
export function actionMenu({ label = 'Actions', ariaLabel, items }) {
  const list = items.filter(Boolean);
  const btn = h('button', { class: 'btn btn-sm menu-btn-trigger', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': ariaLabel || label },
    h('span', null, label), icon('chevronDown', 16));
  const menu = h('ul', { class: 'menu', role: 'menu', hidden: true }, list.map(it => h('li', { role: 'none' },
    h('button', { class: 'menu-item' + (it.danger ? ' danger' : ''), type: 'button', role: 'menuitem', tabindex: '-1',
      onclick: () => { close(true); it.onSelect(); } }, it.icon ? icon(it.icon, 16) : null, it.label))));
  const wrap = h('div', { class: 'menu-wrap' }, btn, menu);
  const entries = () => [...menu.querySelectorAll('.menu-item')];
  function open(focusIndex = 0) {
    closeOpenMenu();
    menu.hidden = false; wrap.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
    openMenu = close;
    const e = entries(); if (e.length) e[(focusIndex + e.length) % e.length].focus();
  }
  function close(focusButton) {
    if (menu.hidden) return;
    menu.hidden = true; wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false');
    if (openMenu === close) openMenu = null;
    if (focusButton && btn.isConnected) btn.focus();
  }
  btn.addEventListener('click', e => { e.stopPropagation(); menu.hidden ? open() : close(); });
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); open(0); }
    if (e.key === 'ArrowUp') { e.preventDefault(); open(-1); }
  });
  menu.addEventListener('keydown', e => {
    const e2 = entries(), i = e2.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); e2[(i + 1) % e2.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e2[(i - 1 + e2.length) % e2.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); e2[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); e2[e2.length - 1].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); } // don't also close a drawer/dialog
    else if (e.key === 'Tab') close(false);
  });
  btn.addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); e.stopPropagation(); close(true); } });
  return wrap;
}
