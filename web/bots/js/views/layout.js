// Owner-only layout drafting. Nothing is persisted until Save layout succeeds.
import { h, icon } from '../lib.js';
import { station, sharedTable, annexFloor, BACKDROP, TUNE } from '../scene.js';

export function render(ctx) {
  const { M } = ctx, bots = ctx.activeBots(), dataset = ctx.demo ? 'demo' : 'real';
  if (!bots.length) return h('div', { class: 'page' }, h('h1', null, 'Layout editor'), h('p', null, 'Add a bot before editing the office.'), h('a', { href: '#/hq' }, 'Back to Headquarters'));
  let ui = ctx.ui.hq.layoutEditor;
  if (!ui || ui.dataset !== dataset) ui = ctx.ui.hq.layoutEditor = { dataset, drafts: new Map(), undo: [], selected: bots[0].id, part: 'station', zoom: 'fit', snap: true, step: 1 };
  // Roster changes can happen while a draft is open; never save stale archived/removed bots.
  const ids = new Set(bots.map(b => b.id));
  for (const id of ui.drafts.keys()) if (!ids.has(id)) ui.drafts.delete(id);
  if (!ids.has(ui.selected)) ui.selected = bots[0].id;
  // Desk placement is the only draggable object. Bot/chair positions are derived on save.
  ui.part = 'station';
  const initial = M.arrangeDesks(ctx.state.bots), W = initial.width, H = initial.height, worldSize = { W, H };
  let busy = false, drag = null, renderScale = 0.35;
  const workingBots = () => ctx.state.bots.map(b => {
    if (!ui.drafts.has(b.id)) return b;
    const out = { ...b }; if (ui.drafts.get(b.id) === null) delete out.layout; else out.layout = ui.drafts.get(b.id); return out;
  });
  const current = () => {
    const d = M.arrangeDesks(workingBots()).desks.find(x => x.bot.id === ui.selected);
    return M.layoutInput({ ...(d.bot.layout || { x: d.x, y: d.y, view: d.view }), auto_seat: true });
  };
  const remember = () => { ui.undo.push(structuredClone([...ui.drafts])); if (ui.undo.length > 60) ui.undo.shift(); };
  const saveDraft = v => {
    const base = bots.find(b => b.id === ui.selected).layout || null;
    if (JSON.stringify(base) === JSON.stringify(v)) ui.drafts.delete(ui.selected); else ui.drafts.set(ui.selected, v);
  };
  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
  const point = v => ui.part === 'station' ? v : ui.part === 'label' ? v.label : v.parts[ui.part];
  function move(dx, dy, base = current(), snap = false) {
    const v = structuredClone(base), p = point(v), grid = snap && ui.snap ? 8 : 1;
    const bound = ui.part === 'station' ? [128, Math.min(16000, W - 220), 128, Math.min(16000, H - 220)] : [-400, 400, -400, 400];
    p.x = clamp(Math.round((p.x + dx) / grid) * grid, bound[0], bound[1]);
    p.y = clamp(Math.round((p.y + dy) / grid) * grid, bound[2], bound[3]);
    saveDraft(v); draw(); sync();
  }
  const status = h('p', { class: 'layout-status', role: 'status', 'aria-live': 'polite' });
  const save = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
    if (!ui.drafts.size || busy) return;
    busy = true; sync(); status.textContent = 'Saving layout…';
    try {
      await ctx.api('/layout', { method: 'POST', body: { changes: [...ui.drafts].map(([bot, layout]) => ({ bot, layout })) } });
      ctx.ui.hq.layoutEditor = null; await ctx.refresh(); ctx.go('#/hq'); ctx.toast('Desk layout saved. Assigned bots aligned to their desks.');
    } catch (e) { status.textContent = `Could not save: ${e.message} Your edits are still here.`; }
    finally { busy = false; sync(); }
  } }, 'Save layout');
  const cancel = h('button', { class: 'btn', type: 'button', onclick: () => { if (busy) return; ctx.ui.hq.layoutEditor = null; ctx.go('#/hq'); } }, 'Cancel edits');
  const undo = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { if (busy || !ui.undo.length) return; ui.drafts = new Map(ui.undo.pop()); draw(); sync(); status.textContent = 'Last edit undone.'; } }, 'Undo');
  const reset = h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { if (busy) return; remember(); saveDraft(null); draw(); sync(); status.textContent = 'Selected workstation reset in preview. Save to keep it.'; } }, 'Reset selected');
  const select = (label, options, value, change) => {
    const input = h('select', { class: 'select-input', 'aria-label': label, onchange: e => { if (!busy) change(e.target.value); } }, options.map(([v, t]) => h('option', { value: v }, t)));
    input.value = value; return { input, el: h('label', { class: 'layout-field' }, label, input) };
  };
  const bot = select('Desk', bots.map(b => [b.id, `${b.name}'s desk`]), ui.selected, v => { ui.selected = v; draw(); sync(); });
  const direction = value => { if (busy) return; remember(); const v = current(); v.view = value; saveDraft(v); draw(); sync(); status.textContent = 'Desk rotated in preview. The bot aligns after Save.'; };
  const view = select('Desk direction', M.LAYOUT_VIEWS.map(v => [v, v.replaceAll('_', ' ')]), '', direction);
  const rotateLeft = h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'Rotate desk left', onclick: () => direction(M.rotateDeskView(current().view, -1)) }, '↶ Rotate left');
  const rotateRight = h('button', { class: 'btn btn-sm', type: 'button', 'aria-label': 'Rotate desk right', onclick: () => direction(M.rotateDeskView(current().view, 1)) }, '↷ Rotate right');
  const number = (label, change, step = 1) => {
    const input = h('input', { type: 'number', step, 'aria-label': label, onchange: e => {
      if (busy) return; const n = e.target.value.trim() === '' ? NaN : Number(e.target.value);
      if (!Number.isFinite(n)) { status.textContent = 'Enter a valid number.'; sync(); return; }
      change(n);
    } }); return { input, el: h('label', { class: 'layout-field' }, label, input) };
  };
  const x = number('Desk X', value => { remember(); move(value - current().x, 0); });
  const y = number('Desk Y', value => { remember(); move(0, value - current().y); });
  const scale = number('Desk size (%)', value => { remember(); const v = current(); v.parts.desk.scale = clamp(value / 100, 0.5, 1.75); saveDraft(v); draw(); sync(); });
  const step = select('Nudge step', [['1', '1 unit'], ['8', '8 units'], ['16', '16 units']], String(ui.step), v => { ui.step = Number(v); });
  const snap = h('input', { type: 'checkbox', checked: ui.snap, onchange: e => { ui.snap = e.target.checked; } });
  const zoom = select('Zoom', [['fit', 'Fit room'], ['0.35', '35%'], ['0.55', '55%'], ['0.8', '80%'], ['1', '100%'], ['1.4', '140%']], String(ui.zoom), v => { ui.zoom = v; size(); });
  const stage = h('div', { class: 'layout-stage', 'aria-label': 'Scrollable layout canvas' });
  const world = h('div', { class: 'layout-world', tabindex: '0', role: 'region', 'aria-label': 'Editable office. Drag a desk or use arrow keys. Bots stay in place until Save.' });
  const canvas = h('div', { class: 'layout-canvas' }, world); stage.append(canvas);
  function size() {
    renderScale = ui.zoom === 'fit' ? (stage.clientWidth && stage.clientHeight ? Math.max(0.1, Math.min(stage.clientWidth / W, stage.clientHeight / H)) : 0.35) : Number(ui.zoom);
    canvas.style.width = W * renderScale + 'px'; canvas.style.height = H * renderScale + 'px'; Object.assign(world.style, { width: W + 'px', height: H + 'px', transform: `scale(${renderScale})` });
  }
  function draw() {
    const layout = M.arrangeDesks(workingBots());
    world.replaceChildren(h('img', { class: 'layout-backdrop', src: BACKDROP, alt: '', draggable: 'false', width: M.OFFICE.w, height: M.OFFICE.h }));
    if (layout.annex) world.append(...annexFloor(layout.annex, worldSize, M.project, M.SCENE));
    world.append(...sharedTable(layout.table, worldSize));
    for (const d of layout.desks) {
      const selected = d.bot.id === ui.selected, scene = station(d, M.botStyle(d.bot), worldSize, { selected });
      const original = initial.desks.find(x => x.bot.id === d.bot.id), frozen = station(original, M.botStyle(original.bot), worldSize);
      // Render the saved bot and chair; the desk and the rug under it come from the draft, so they move, rotate
      // and resize together. The bot and chair align to the new seat only after Save.
      const followsDesk = el => el.dataset.part === 'desk' || el.dataset.part === 'rug';
      for (const el of frozen.nodes) { if (followsDesk(el)) continue; el.dataset.actor = d.bot.id; el.classList.add('layout-fixed'); world.append(el); }
      const rug = scene.nodes.find(el => el.dataset.part === 'rug');
      if (rug) { rug.dataset.bot = d.bot.id; world.append(rug); }
      const desk = scene.nodes.find(el => el.dataset.part === 'desk');
      desk.dataset.bot = d.bot.id; if (selected) desk.classList.add('layout-part-selected'); world.append(desk);
      if (selected) {
        const seat = M.deskSeat(d, TUNE.deskDrop);
        world.append(h('span', { class: 'layout-seat-target', role: 'img', 'aria-label': `Automatic seat for ${d.bot.name} after save`, style: { left: seat.x + 'px', top: seat.y + 'px' } }, 'Seat'));
      }
      const label = d.bot.layout?.label || { x: 0, y: 0 };
      world.append(h('button', { class: 'layout-name' + (selected ? ' selected' : ''), type: 'button', dataset: { bot: d.bot.id, part: 'label' }, style: { left: d.x + label.x + 'px', top: d.y - TUNE.labelLift + label.y + 'px' }, 'aria-label': `Select ${d.bot.name} desk` }, `${d.bot.name}'s desk`));
      world.append(h('button', { class: 'layout-handle' + (selected ? ' selected' : ''), type: 'button', dataset: { bot: d.bot.id }, style: { left: d.x + 'px', top: d.y + 'px' }, 'aria-label': `Move ${d.bot.name} desk`, title: 'Drag to move the desk only' }, '✥'));
    }
  }
  function sync() {
    const v = current(); bot.input.value = ui.selected; view.input.value = v.view;
    x.input.value = v.x; y.input.value = v.y; scale.input.value = Math.round(v.parts.desk.scale * 100);
    for (const el of [bot.input, view.input, x.input, y.input, scale.input, rotateLeft, rotateRight, reset, cancel]) el.disabled = busy;
    save.disabled = busy || !ui.drafts.size; undo.disabled = busy || !ui.undo.length;
    dirty.textContent = ui.drafts.size ? `${ui.drafts.size} unsaved desk${ui.drafts.size === 1 ? '' : 's'}` : 'No unsaved changes';
  }
  function nudge(dx, dy) { if (busy) return; remember(); move(dx * ui.step, dy * ui.step); status.textContent = 'Position adjusted in preview.'; }
  const dirty = h('span', { class: 'layout-dirty' });
  const panel = h('aside', { class: 'layout-controls', 'aria-label': 'Alignment controls' },
    h('h2', null, 'Place and rotate desks'), bot.el,
    h('div', { class: 'layout-rotation', role: 'group', 'aria-label': 'Desk rotation' }, rotateLeft, rotateRight), view.el,
    h('div', { class: 'layout-numbers' }, x.el, y.el), scale.el,
    h('p', { class: 'layout-follow-note' }, 'The desk and its rug move, rotate and resize together. After Save, the assigned bot and chair align to the new seat. Four perspective views are available.'),
    step.el, h('div', { class: 'layout-nudges', role: 'group', 'aria-label': 'Nudge selected desk' },
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Nudge left', onclick: () => nudge(-1, 0) }, '←'),
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Nudge up', onclick: () => nudge(0, -1) }, '↑'),
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Nudge down', onclick: () => nudge(0, 1) }, '↓'),
      h('button', { class: 'btn', type: 'button', 'aria-label': 'Nudge right', onclick: () => nudge(1, 0) }, '→')),
    h('label', { class: 'layout-check' }, snap, 'Snap dragging to 8-unit grid'), zoom.el,
    h('div', { class: 'row gap-sm wrap' }, undo, reset), status,
    h('p', { class: 'small muted' }, 'Drag a desk, its rug or the ✥ handle. Arrow keys nudge; Shift + arrow moves 10 units. Bots stay still during editing. The seat marker shows where the assigned bot will sit after Save.'));
  const root = h('section', { class: 'layout-editor' },
    h('header', { class: 'layout-toolbar' }, h('div', null, h('h1', null, 'Layout editor'), dirty), h('div', { class: 'row gap-sm wrap' }, cancel, save)),
    h('div', { class: 'layout-viewport' }, stage, panel));
  world.addEventListener('pointerdown', e => {
    if (busy || e.button !== 0 || !e.isPrimary) return;
    const target = e.target.closest('[data-bot]'); if (!target) return;
    ui.selected = target.dataset.bot; remember();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, zoom: renderScale, base: current(), moved: false };
    world.setPointerCapture(e.pointerId); draw(); sync(); e.preventDefault(); world.focus({ preventScroll: true });
  });
  world.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = (e.clientX - drag.x) / drag.zoom, dy = (e.clientY - drag.y) / drag.zoom;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true; move(dx, dy, drag.base, true);
  });
  const endDrag = e => { if (!drag || drag.id !== e.pointerId) return; if (!drag.moved) ui.undo.pop(); drag = null; sync(); status.textContent = 'Selection ready. Drag or nudge to align it.'; };
  world.addEventListener('pointerup', endDrag); world.addEventListener('pointercancel', endDrag);
  world.addEventListener('keydown', e => {
    if (busy || e.ctrlKey || e.metaKey || e.altKey) return;
    const vectors = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }, v = vectors[e.key];
    if (!v) return; e.preventDefault(); remember(); const amount = e.shiftKey ? 10 : 1; move(v[0] * amount, v[1] * amount);
  });
  // Screen-reader/keyboard activation of a named station also selects it.
  world.addEventListener('click', e => { const target = e.target.closest('[data-bot]'); if (!target || busy) return; ui.selected = target.dataset.bot; draw(); sync(); });
  const beforeUnload = e => { if (ui.drafts.size) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  const resize = new ResizeObserver(size); resize.observe(stage);
  size(); draw(); sync();
  return { el: root, cleanup: () => { resize.disconnect(); window.removeEventListener('beforeunload', beforeUnload); drag = null; } };
}
