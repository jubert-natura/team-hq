// Team Bot AI workspace: shell, routing, data loading, demo mode, search and the shared "assign task" dialog.
import * as M from '/shared/bots-model.js';
import { h, clear, icon, api, setDataset, getDataset, toast, trapFocus, formDialog } from './lib.js';
import * as hq from './views/hq.js';
import * as overview from './views/overview.js';
import * as tasks from './views/tasks.js';
import * as performance from './views/performance.js';
import * as learning from './views/learning.js';
import * as reports from './views/reports.js';
import * as connections from './views/connections.js';
import * as settings from './views/settings.js';
import * as layoutEditor from './views/layout.js';
import { botDialog, archiveDialog, restoreBot } from './roster.js';
import * as theme from './theme.js';

const ROUTES = {
  hq: { label: 'Headquarters', icon: 'home', view: hq },
  overview: { label: 'Team overview', icon: 'users', view: overview },
  tasks: { label: 'Task history', icon: 'history', view: tasks },
  performance: { label: 'Performance', icon: 'chart', view: performance },
  learning: { label: 'Learning history', icon: 'book', view: learning },
  reports: { label: 'Reports', icon: 'file', view: reports },
  connections: { label: 'Connections', icon: 'link', view: connections, foot: true },
  settings: { label: 'Settings', icon: 'settings', view: settings, foot: true },
  layout: { label: 'Layout editor', icon: 'edit', view: layoutEditor, foot: true }
};

const $ = id => document.getElementById(id);
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { return null; } return null; };

const ctx = {
  M,
  state: null,
  error: null,
  // per-view UI state survives re-renders and navigation
  ui: {
    tasks: { bot: '', status: '', range: '30', q: '', sort: 'created', dir: 'desc' },
    perf: { range: '30' },
    learning: { sort: 'newest' },
    reports: { week: 0, snapshot: null, checked: new Set() },
    hq: { view: null }
  },
  get demo() { return getDataset() === 'demo'; },
  go(hash) { if (location.hash === hash) render(); else location.hash = hash; },
  refresh,
  toast,
  api,
  assignTask,
  // the roster comes from stored configuration; archived bots keep their history
  activeBots() { return M.activeBots(this.state.bots); },
  availableBots() { return M.availableBots(this.state.bots); },
  archivedBots() { return M.archivedBots(this.state.bots); },
  bot(id) { return M.botById(this.state.bots, id); },
  botName(id) { const b = this.bot(id); return b ? b.name + (M.isActive(b) ? '' : ' (archived)') : 'Unknown bot'; },
  addBot(preset) { botDialog(ctx, null, preset); },
  editBot(b) { botDialog(ctx, b); },
  configureBot(b) { ctx.go(`#/settings/${b.id}`); },
  archiveBot(b) { archiveDialog(ctx, b); },
  restoreBot(b) { restoreBot(ctx, b); }
};

setDataset(store('teamBot.dataset') === 'demo' ? 'demo' : 'real');

// ---- data ----
async function load() {
  try { ctx.state = await api('/state'); ctx.error = null; }
  catch (e) { ctx.state = null; ctx.error = e; }
}
async function refresh() { await load(); render(); }
export async function setDemo(on) {
  setDataset(on ? 'demo' : 'real');
  store('teamBot.dataset', on ? 'demo' : 'real');
  ctx.ui.reports.snapshot = null; ctx.ui.reports.checked.clear();
  await refresh();
  toast(on ? 'Showing demo data. Your real workspace is untouched.' : 'Back to your real workspace.');
}
ctx.setDemo = setDemo;

// ---- routing ----
function parse() {
  const [, name = 'hq', param = ''] = (location.hash || '#/hq').match(/^#\/([a-z]+)(?:\/([A-Za-z0-9_-]+))?/) || [];
  return { name: ROUTES[name] ? name : 'hq', param: decodeURIComponent(param || '') };
}
let current = null;
function render() {
  const route = parse(), def = ROUTES[route.name];
  const view = $('view');
  // remember focus so a re-render after an action keeps the keyboard position
  const fkey = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fkey : null;
  const sameRoute = current && current.name === route.name;
  const scrollTop = view.scrollTop;
  if (current && current.cleanup) current.cleanup();
  current = { name: route.name, cleanup: null };
  document.title = `${def.label} · Team Bot`;
  $('crumb').textContent = def.label;
  renderNav(route.name);
  renderChrome();
  clear(view);
  view.dataset.route = route.name;
  if (ctx.error) { view.append(errorPanel(ctx.error)); return; }
  if (!ctx.state) { view.append(h('p', { class: 'loading' }, 'Loading…')); return; }
  const out = def.view.render(ctx, route.param);
  view.append(out.el || out);
  current.cleanup = out.cleanup || null;
  if (sameRoute) view.scrollTop = scrollTop; // a re-render after an action keeps the reading position
  if (fkey && sameRoute) { const el = view.querySelector(`[data-fkey="${CSS.escape(fkey)}"]`); if (el) el.focus({ preventScroll: true }); }
}
window.addEventListener('hashchange', () => {
  const before = current && current.name;
  closeMenu(false);
  render();
  if (parse().name === before) return; // same page, new selection: keep the keyboard where it is
  $('view').scrollTop = 0;
  // a new page: move focus to its heading so screen reader users hear where they are
  const h1 = $('view').querySelector('h1'); if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
});

function navItem(name) {
  const r = ROUTES[name];
  return h('li', null, h('a', { href: `#/${name}`, class: 'nav-link', dataset: { route: name } }, icon(r.icon, 20), h('span', null, r.label)));
}
function renderNav(active) {
  const main = $('navMain'), foot = $('navFoot');
  if (!main.childElementCount) {
    for (const n of Object.keys(ROUTES)) (ROUTES[n].foot ? foot : main).append(navItem(n));
  }
  for (const a of document.querySelectorAll('.nav-link')) {
    if (a.dataset.route === active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}
function renderChrome() {
  const demo = ctx.demo;
  $('demoChip').hidden = !demo;
  $('avatar').textContent = ctx.state ? ctx.state.viewer.initials : '··';
  $('avatar').setAttribute('aria-label', 'Signed in as the HQ owner');
  const b = $('demoBanner');
  b.hidden = !demo;
  clear(b);
  if (demo) b.append(
    h('span', { class: 'demo-banner-text' }, icon('info', 18), h('span', null, h('b', null, 'Demo data. '), 'Examples from a fixture, not real work. Changes stay in server memory only and are discarded on restart or reset. Your real workspace is untouched.')),
    h('span', { class: 'demo-banner-actions' },
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { try { await api('/demo/reset', { method: 'POST', body: {} }); await refresh(); toast('Demo data reset.'); } catch (e) { toast(e.message, 'error'); } } }, 'Reset demo'),
      h('button', { class: 'btn btn-sm btn-primary', type: 'button', dataset: { fkey: 'exit-demo' }, onclick: () => setDemo(false) }, 'Exit demo')));
}
function errorPanel(e) {
  const owner = e.status === 403;
  return h('section', { class: 'page' }, h('div', { class: 'panel error-panel', role: 'alert' },
    h('h1', null, owner ? 'Owner only' : 'The AI workspace could not load'),
    h('p', null, e.message),
    owner ? h('p', null, h('a', { href: '/' }, 'Go to the human team HQ')) : h('div', { class: 'row gap' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: refresh }, 'Try again'),
      ctx.demo ? h('button', { class: 'btn', type: 'button', onclick: () => setDemo(false) }, 'Exit demo')
        : (e.status === 503 ? h('button', { class: 'btn', type: 'button', onclick: () => setDemo(true) }, 'View demo data instead') : null))));
}

// ---- mobile menu: a real button, focus moves into the menu and back ----
const side = $('side'), menuBtn = $('menuBtn'), scrim = $('scrim');
let untrap = null;
function openMenu() {
  side.classList.add('open'); scrim.hidden = false; menuBtn.setAttribute('aria-expanded', 'true');
  untrap = trapFocus(side, () => closeMenu(true));
  const a = side.querySelector('[aria-current="page"]') || side.querySelector('a'); a && a.focus();
}
function closeMenu(returnFocus = true) {
  if (!side.classList.contains('open')) return;
  side.classList.remove('open'); scrim.hidden = true; menuBtn.setAttribute('aria-expanded', 'false');
  if (untrap) { untrap(); untrap = null; }
  if (returnFocus) menuBtn.focus();
}
menuBtn.addEventListener('click', () => (side.classList.contains('open') ? closeMenu() : openMenu()));
$('sideClose').addEventListener('click', () => closeMenu());
scrim.addEventListener('click', () => closeMenu());
matchMedia('(min-width: 961px)').addEventListener('change', e => { if (e.matches) closeMenu(false); });

// ---- theme: header toggle (the Light / Dark / System choice lives in Settings) ----
const themeBtn = $('themeToggle');
const syncThemeButton = t => {
  const dark = t === 'dark';
  themeBtn.setAttribute('aria-pressed', String(dark));
  themeBtn.title = dark ? 'Dark theme is on' : 'Dark theme is off';
};
syncThemeButton(theme.current());
theme.onChange(t => syncThemeButton(t));
themeBtn.addEventListener('click', () => { theme.toggle(); toast(theme.current() === 'dark' ? 'Dark theme on.' : 'Light theme on.'); });
theme.apply();

// ---- search: bots, tasks and lessons ----
const sInput = $('searchInput'), sBox = $('searchResults');
function searchResults(q) {
  const s = q.trim().toLowerCase(); if (!s || !ctx.state) return [];
  const hit = (...xs) => xs.some(x => String(x || '').toLowerCase().includes(s));
  const out = [];
  for (const b of ctx.state.bots) if (hit(b.name, b.role, b.focus, ...(b.capabilities || []))) {
    const live = M.isActive(b);
    out.push({ kind: 'Bot', label: b.name + (live ? '' : ' (archived)'), sub: `${b.role}${b.focus ? ' · ' + b.focus : ''}`, href: live ? `#/hq/${b.id}` : '#/overview' });
  }
  for (const t of ctx.state.tasks) if (hit(t.title, t.project, M.taskKey(t), ctx.botName(t.bot))) out.push({ kind: 'Task', label: t.title, sub: `${M.taskKey(t)} · ${ctx.botName(t.bot)}`, href: `#/tasks/${t.id}` });
  for (const l of ctx.state.lessons) if (hit(l.title, l.lesson, l.instruction)) out.push({ kind: 'Lesson', label: l.title, sub: `${M.LESSON[l.status]} · ${ctx.botName(l.bot)}`, href: `#/learning/${l.id}` });
  return out.slice(0, 8);
}
function showSearch() {
  const res = searchResults(sInput.value);
  clear(sBox);
  if (!sInput.value.trim()) { sBox.hidden = true; sInput.setAttribute('aria-expanded', 'false'); return; }
  sBox.append(h('p', { class: 'search-count', role: 'status' }, res.length ? `${res.length} result${res.length === 1 ? '' : 's'}` : 'No matches'));
  if (res.length) sBox.append(h('ul', null, res.map(r => h('li', null, h('a', { href: r.href, class: 'search-item', onclick: () => { sInput.value = ''; showSearch(); } },
    h('span', { class: 'search-kind' }, r.kind), h('span', { class: 'search-label' }, r.label), h('span', { class: 'search-sub' }, r.sub))))));
  sBox.hidden = false; sInput.setAttribute('aria-expanded', 'true');
}
sInput.addEventListener('input', showSearch);
sInput.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { const a = sBox.querySelector('a'); if (a) { e.preventDefault(); a.focus(); } }
  if (e.key === 'Escape') { sInput.value = ''; showSearch(); }
  if (e.key === 'Enter') { e.preventDefault(); ctx.ui.tasks.q = sInput.value.trim(); ctx.ui.tasks.range = 'all'; sInput.value = ''; showSearch(); ctx.go('#/tasks'); }
});
sBox.addEventListener('keydown', e => {
  const items = [...sBox.querySelectorAll('a')], i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' && i < items.length - 1) { e.preventDefault(); items[i + 1].focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? items[i - 1] : sInput).focus(); }
  if (e.key === 'Escape') { sInput.focus(); sInput.value = ''; showSearch(); }
});
document.addEventListener('click', e => { if (!$('search').contains(e.target)) { sBox.hidden = true; sInput.setAttribute('aria-expanded', 'false'); } });

// ---- shared: assign a task (creates a record; nothing is dispatched to a bot) ----
function assignTask(preset = {}) {
  const bots = ctx.availableBots();
  if (!bots.length) { toast('Add or turn on a bot in Settings before assigning work.', 'error'); return; }
  if (preset.bot && !bots.some(b => b.id === preset.bot)) { toast('This bot is off or archived. Turn it on in Settings before assigning work.', 'error'); return; }
  formDialog({
    title: 'Assign task',
    description: ctx.state.runtime.adapter ? `Create a queued task, then choose Run with ${ctx.state.runtime.provider} in its details. Selected shared notes and enabled bot skills are included when it runs.` : 'Creates a task record for a bot. Record its progress here by hand until a runtime is connected.',
    fields: [
      { name: 'title', label: 'Title', required: true, maxlength: M.LIMITS.title, placeholder: 'Build responsive navigation' },
      { name: 'bot', label: 'Assigned bot', type: 'select', required: true, options: bots.map(b => [b.id, `${b.name} · ${b.role}`]), value: bots.some(b => b.id === preset.bot) ? preset.bot : bots[0].id },
      { name: 'project', label: 'Project', required: true, maxlength: M.LIMITS.project, placeholder: 'Website redesign', value: preset.project || '' },
      { name: 'criteria', label: 'Acceptance criteria', type: 'textarea', rows: 4, required: true, maxlength: M.LIMITS.criteria, hint: 'How a reviewer will decide this is done. Be specific: what must be true, at which sizes, with which checks.', placeholder: 'Navigation works at 390, 768 and 1440 px with no overlap.' },
      { name: 'output_url', label: 'Output link', type: 'url', maxlength: M.LIMITS.url, hint: 'Only a real http:// or https:// link you already have, such as a pull request.' }
    ],
    submitLabel: 'Create task',
    onSubmit: async v => {
      const r = await api('/tasks', { method: 'POST', body: v });
      await load();
      ctx.go(`#/tasks/${r.task.id}`);
      toast(`${M.taskKey(r.task)} created for ${ctx.botName(r.task.bot)}.`);
    }
  });
}

await load();
render();

// Refresh actual job status without interrupting forms, dialogs or layout editing.
setInterval(async () => {
  if (document.hidden || ctx.demo || !ctx.state?.tasks.some(t => t.run?.status === 'running') || document.querySelector('dialog[open]') || document.activeElement?.matches('input,textarea,select') || parse().name === 'layout') return;
  await refresh();
}, 3000);
