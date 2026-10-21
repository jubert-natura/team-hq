// Building blocks shared by the views.
import { h, icon } from '../lib.js';

export function pageHead(ctx, { title, sub, sub2, actions = [] }) {
  return h('header', { class: 'page-head' },
    h('div', { class: 'page-title' },
      h('div', { class: 'title-row' }, h('h1', null, title), ctx.demo ? h('span', { class: 'badge badge-amber' }, 'Demo data') : null),
      sub ? h('p', { class: 'lede' }, sub) : null,
      sub2 ? h('p', { class: 'lede-2' }, sub2) : null),
    actions.length ? h('div', { class: 'page-actions' }, actions) : null);
}

/** tone: blue | green | amber | red | indigo */
export function statCard({ label, value, iconName, tone = 'blue', sub, id }) {
  return h('div', { class: `stat stat-${tone}` },
    h('span', { class: 'stat-icon' }, icon(iconName, 22)),
    h('div', null,
      h('p', { class: 'stat-label', id }, label),
      h('p', { class: 'stat-value' }, String(value)),
      sub ? h('p', { class: 'stat-sub' }, sub) : null));
}

export function empty(text, action) {
  return h('div', { class: 'empty' }, h('p', null, text), action || null);
}

export function panel(title, body, { actions, cls = '', level = 'h2', id } = {}) {
  return h('section', { class: `panel ${cls}`.trim(), 'aria-labelledby': id || null },
    title ? h('div', { class: 'panel-head' }, h(level, { id }, title), actions || null) : null,
    body);
}

export function select({ label, value, options, onchange, iconName, fkey, hideLabel = true }) {
  const id = 'sel-' + Math.random().toString(36).slice(2, 8);
  const s = h('select', { id, class: 'select-input', dataset: fkey ? { fkey } : null, onchange: e => onchange(e.target.value) },
    options.map(([v, l]) => (Array.isArray(l) ? h('optgroup', { label: v }, l.map(([v2, l2]) => h('option', { value: v2 }, l2))) : h('option', { value: v }, l))));
  s.value = value;
  return h('div', { class: 'select' },
    h('label', { for: id, class: hideLabel ? 'sr-only' : 'label' }, label),
    iconName ? icon(iconName, 18, 'select-icon') : null, s, icon('chevronDown', 16, 'select-chevron'));
}

export const manualNote = ctx => ctx.demo
  ? 'Demo fixture: these records illustrate the screens and are not real activity.'
  : ctx.state.runtime?.adapter ? 'Manual updates and AI runtime events are labeled in each task timeline. AI drafts require human review.' : 'No bot is connected. Everything here was recorded manually by the owner.';

/** Days preset -> { from, to } local dates, or null for all time. */
export function presetRange(M, preset, now = new Date()) {
  if (preset === 'all') return null;
  const days = +preset, start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return { from: M.localDate(start), to: M.localDate(now), tz: now.getTimezoneOffset() };
}
export function filterByPreset(M, tasks, preset) {
  const r = presetRange(M, preset);
  if (!r) return tasks;
  const b = M.rangeBounds(r.from, r.to, r.tz);
  return M.tasksInRange(tasks, b.start, b.end);
}
export const RANGE_OPTIONS = [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days'], ['all', 'All time']];
