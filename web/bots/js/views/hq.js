// Headquarters: a composed isometric office. The empty room is a fixed backdrop; every active bot gets a
// workstation built from the shared modular atlases (see ../scene.js) at a stable desk slot (M.arrangeDesks).
// Past eight desks an annex floor grows outside the room. Statuses come only from recorded tasks; a drawn robot
// is never evidence of activity, and typing motion is shown only for verified or demo bots.
import { h, icon, pill, portrait, extLink, trapFocus, botColor, actionMenu } from '../lib.js';
import { manualNote } from './common.js';
import { botSwitch } from '../bot-config.js';
import { station, sharedTable, openDesk, annexFloor, animate, BACKDROP, TUNE } from '../scene.js';
import { runArrivals } from '../walk.js';
import { render3d, hqMode, modeSwitch } from './hq3d.js';

const ZMAX = 3, STEP = 1.25, PAN = 80;
const NARROW = '(max-width: 720px)';

export function render(ctx, param) {
  if (hqMode() === '3d') return render3d(ctx, param, { renderDrawer, chrome });
  const { M } = ctx, st = ctx.state;
  const active = ctx.activeBots();
  const sel = active.find(b => b.id === param) || null;
  const layout = M.arrangeDesks(st.bots);
  const W = layout.width, H = layout.height, OW = M.OFFICE.w, OH = M.OFFICE.h;
  const world0 = { W, H };
  const v = ctx.ui.hq.view || (ctx.ui.hq.view = { z: 1, x: null, y: null });
  const narrow = matchMedia(NARROW).matches;
  const status = Object.fromEntries(active.map(b => [b.id, M.botStatus(st.tasks, b.id, b)]));
  const counts = M.teamCounts(st.tasks, active);
  const px = (u, of) => (u / of * 100) + '%';

  // ---- world: backdrop, annex floor, shared table, workstations, labels ----
  // Typing motion only where activity is verified (connected) or explicitly demo; manual records idle and blink.
  const motionOk = b => b.connection === 'connected' || b.connection === 'demo';
  const robots = [], sprites = [], seats = [];
  for (const d of layout.desks) {
    const typing = status[d.bot.id].status === 'working' && motionOk(d.bot);
    const s = station(d, M.botStyle(d.bot), world0, { typing, selected: !!(sel && sel.id === d.bot.id) });
    sprites.push(...s.nodes);
    if (s.robot && M.isEnabled(d.bot)) robots.push({ el: s.robot, typing, phase: (d.slot * 977) % 3400, row: typing ? 2 : 0 });
    seats.push({ d, robot: s.robot, style: M.botStyle(d.bot), enabled: M.isEnabled(d.bot) });
  }
  const demoMotion = robots.some(r => r.typing) && ctx.demo;
  const labels = layout.desks.map(d => {
    const b = d.bot, s = status[b.id], on = !!(sel && sel.id === b.id);
    return h('button', {
      type: 'button', class: 'bot-label' + (on ? ' selected' : ''), style: { left: px(d.x + (b.layout?.label?.x || 0), W), top: px(d.y - TUNE.labelLift + (b.layout?.label?.y || 0), H), '--bot': botColor(b) },
      'aria-expanded': String(on), 'aria-controls': on ? 'bot-drawer' : null, dataset: { fkey: 'label-' + b.id },
      'aria-label': `${b.name}, ${b.role}, desk ${d.slot + 1}. ${M.BOT_STATUS[s.status]}. ${b.connection_label}.`,
      onclick: () => ctx.go(on ? '#/hq' : `#/hq/${b.id}`)
    }, portrait(b, 30), h('span', { class: 'bot-label-text' }, h('span', { class: 'bot-label-name' }, b.name), pill(s.status, M.BOT_STATUS[s.status], 'pill-xs')));
  });
  const o = layout.open;
  labels.push(openDesk(o, world0), h('button', {
    type: 'button', class: 'bot-label open-desk', style: { left: px(o.x, W), top: px(o.y - 60, H) },
    'aria-label': `Open desk ${o.slot + 1}. Add a bot to the team.`, onclick: () => ctx.addBot()
  }, icon('plus', 16), h('span', { class: 'bot-label-name' }, 'Open desk')));
  const world = h('div', { class: 'world no-anim' },
    h('img', { class: 'world-img', src: BACKDROP, alt: `Office with ${active.length} workstation${active.length === 1 ? '' : 's'} around a shared table.`, width: OW, height: OH, draggable: 'false', style: { width: px(OW, W), height: px(OH, H) } }),
    layout.annex ? annexFloor(layout.annex, world0, M.project, M.SCENE) : null,
    sharedTable(layout.table, world0), sprites, labels);
  const scene = h('div', { class: 'scene', tabindex: '0', role: 'region', 'aria-label': `Office map with ${active.length} bot desk${active.length === 1 ? '' : 's'}`, 'aria-describedby': 'scene-help' }, world);
  const stopMotion = animate(robots);
  // Walk-to-seat (visual only): bots new to a desk walk in from the entrance; "Skip" seats them at once.
  const skipBtn = h('button', { class: 'btn btn-sm', type: 'button', hidden: true, onclick: () => walks.skip() }, 'Seat everyone');
  const walks = runArrivals({
    layout, stations: seats, world: world0, worldEl: world,
    label: d => `${d.bot.name} · going to desk ${d.slot + 1}`,
    onChange: n => { skipBtn.hidden = !n; walkNote.hidden = !n; }
  });
  const walkNote = h('p', { class: 'hq-hint walk-note', hidden: !walks.active }, icon('info', 16), 'Bots are finding their desks. This is animation only, not work.');
  skipBtn.hidden = !walks.active;

  // ---- overlays ----
  const zin = h('button', { class: 'ctrl', type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in (+)', onclick: () => zoomBy(STEP) }, icon('plus', 20));
  const zout = h('button', { class: 'ctrl', type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out (−)', onclick: () => zoomBy(1 / STEP) }, icon('minus', 20));
  const zfit = h('button', { class: 'ctrl', type: 'button', 'aria-label': 'Reset view to the main office', title: 'Reset view (0)', onclick: reset }, icon('fit', 20));
  const zall = layout.rooms ? h('button', { class: 'ctrl', type: 'button', 'aria-label': 'Show every desk', title: 'Show every desk (A)', onclick: fitAll }, icon('grid', 20)) : null;
  const ctrls = h('div', { class: 'hq-ctrls hq-ui', role: 'group', 'aria-label': 'Map view' }, zin, zout, zfit, zall);

  const hint = demoMotion ? 'Demo data · typing motion is illustrative' : counts.connected ? 'Select a bot to view activity' : 'No bots connected · statuses come from manual records';
  const { title, statusBar } = chrome(ctx, { active, sel, counts, hint, extra: [walkNote, skipBtn] });
  const help = h('p', { id: 'scene-help', class: 'sr-only' }, 'Drag, or use the arrow keys, to move around the office. Plus and minus zoom, 0 resets the view, A shows every desk. Select a bot label to see its details.');

  let drawer = null, untrap = null;
  if (sel) {
    drawer = renderDrawer(ctx, sel, status[sel.id], narrow, close);
    if (narrow) untrap = trapFocus(drawer, close);
  }
  const scrim = sel && narrow ? h('div', { class: 'drawer-scrim', onclick: close }) : null;
  const root = h('section', { class: 'hq' + (sel ? ' has-drawer' : '') }, scene, title, ctrls, statusBar, help, scrim, drawer);

  function close() {
    if (untrap) untrap();
    ctx.ui.hq.returnFocus = sel ? 'label-' + sel.id : null;
    ctx.go('#/hq');
  }

  // ---- pan / zoom. k = pixels per office unit at zoom 1 ----
  let k = 1, cw = 0, ch = 0, visW = 0;
  const zmin = () => Math.min(1, visW / (W * k), ch / (H * k));
  function measure() {
    cw = scene.clientWidth; ch = scene.clientHeight;
    const wide = !matchMedia(NARROW).matches, A = OW / OH; // the fixed room, not the grown world, sets the base scale
    // wide: the main office covers the canvas; narrow: a little wider than the screen so bots stay readable
    const officePx = wide ? Math.max(cw, ch * A) : Math.max(cw * 1.35, Math.min(ch * A, cw * 1.6));
    k = officePx / OW;
    visW = drawer && wide ? Math.max(cw * 0.45, cw - drawer.offsetWidth - 32) : cw;
    world.style.width = W * k + 'px'; world.style.height = H * k + 'px';
  }
  function clampView() {
    v.z = Math.min(ZMAX, Math.max(zmin(), v.z));
    const sw = W * k * v.z, sh = H * k * v.z;
    v.x = sw <= visW ? (visW - sw) / 2 : Math.min(0, Math.max(visW - sw, v.x));
    v.y = sh <= ch ? (ch - sh) / 2 : Math.min(0, Math.max(ch - sh, v.y));
  }
  function apply() {
    clampView();
    world.style.transform = `translate3d(${v.x}px, ${v.y}px, 0) scale(${v.z})`;
    world.style.setProperty('--z', v.z);
    zin.disabled = v.z >= ZMAX - 1e-6; zout.disabled = v.z <= zmin() + 1e-6;
  }
  function zoomAt(nz, x, y) {
    nz = Math.min(ZMAX, Math.max(zmin(), nz));
    v.x = x - (x - v.x) * (nz / v.z); v.y = y - (y - v.y) * (nz / v.z); v.z = nz;
    apply();
  }
  function zoomBy(f) { zoomAt(v.z * f, visW / 2, ch / 2); }
  function lookAt(ux, uy) { v.x = visW / 2 - ux * k * v.z; v.y = ch / 2 - uy * k * v.z; }
  function reset() { v.z = 1; lookAt(OW / 2, OH / 2); apply(); }
  function fitAll() { v.z = zmin(); lookAt(W / 2, H / 2); apply(); }
  function show(b) {
    const d = layout.desks.find(x => x.bot && x.bot.id === b.id); if (!d) return apply();
    const sx = v.x + d.x * k * v.z, sy = v.y + d.y * k * v.z, m = 90;
    if (sx < m || sx > visW - m || sy < m || sy > ch - m) lookAt(d.x, d.y);
    apply();
  }

  let first = true;
  const ro = new ResizeObserver(() => {
    if (!scene.isConnected) return;
    measure();
    if (v.x === null) { v.z = 1; lookAt(OW / 2, OH / 2); }
    if (first && sel && ctx.ui.hq.lastSel !== sel.id) show(sel); else apply();
    if (first) {
      first = false; ctx.ui.hq.lastSel = sel ? sel.id : null;
      requestAnimationFrame(() => requestAnimationFrame(() => world.classList.remove('no-anim')));
      const rf = ctx.ui.hq.returnFocus; ctx.ui.hq.returnFocus = null;
      if (rf) { const el = root.querySelector(`[data-fkey="${rf}"]`); if (el) el.focus({ preventScroll: true }); }
      else if (sel && narrow) { const c = drawer.querySelector('.drawer-close'); if (c) c.focus(); }
    }
  });
  ro.observe(scene);

  // drag to pan (mouse, pen or one finger). A drag never counts as a click on a label.
  let drag = null, suppress = false;
  scene.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.isPrimary) return;
    drag = { sx: e.clientX, sy: e.clientY, x: v.x, y: v.y, id: e.pointerId, moved: false };
  });
  scene.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      drag.moved = true; world.classList.add('dragging'); scene.classList.add('grabbing');
      try { scene.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }
    v.x = drag.x + dx; v.y = drag.y + dy; apply();
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) { suppress = true; setTimeout(() => { suppress = false; }, 0); }
    world.classList.remove('dragging'); scene.classList.remove('grabbing'); drag = null;
  };
  scene.addEventListener('pointerup', endDrag);
  scene.addEventListener('pointercancel', endDrag);
  scene.addEventListener('click', e => { if (suppress) { e.stopPropagation(); e.preventDefault(); } }, true);
  let wheelT;
  scene.addEventListener('wheel', e => {
    e.preventDefault();
    const r = scene.getBoundingClientRect();
    world.classList.add('dragging'); clearTimeout(wheelT); wheelT = setTimeout(() => world.classList.remove('dragging'), 160);
    zoomAt(v.z * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  scene.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key; let used = true;
    if (key === 'ArrowLeft') v.x += PAN; else if (key === 'ArrowRight') v.x -= PAN;
    else if (key === 'ArrowUp') v.y += PAN; else if (key === 'ArrowDown') v.y -= PAN;
    else if (key === '+' || key === '=') { zoomBy(STEP); e.preventDefault(); return; }
    else if (key === '-' || key === '_') { zoomBy(1 / STEP); e.preventDefault(); return; }
    else if (key === '0') { reset(); e.preventDefault(); return; }
    else if (key === 'a' || key === 'A') { fitAll(); e.preventDefault(); return; }
    else if (key === 'd' || key === 'D') { world.classList.toggle('debug'); e.preventDefault(); return; } // anchor points, for tuning
    else if (key === 'Escape' && sel) { close(); e.preventDefault(); return; }
    else used = false;
    if (used) { e.preventDefault(); apply(); }
  });
  if (drawer && !narrow) drawer.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });

  return { el: root, cleanup: () => { ro.disconnect(); stopMotion(); walks.stop(); if (untrap) untrap(); } };
}

/** Title (with the 2D / 3D switch) and status bar, shared by the 2D map and the 3D office. */
function chrome(ctx, { active, sel, counts, hint, extra = [], editLayout = true }) {
  const countItems = [['working', 'working'], ['waiting', 'waiting'], ['blocked', 'blocked'], ['queued', 'queued'], ['idle', 'no assignment'], ['off', 'off']]
    .filter(([k]) => k !== 'queued' || counts.queued)
    .map(([k, label]) => h('li', { class: 'count' }, h('span', { class: `dot dot-${k}`, 'aria-hidden': 'true' }), h('b', null, String(counts[k])), ' ', label));
  const statusBar = h('div', { class: 'hq-status hq-ui' },
    h('ul', { class: 'counts', 'aria-label': 'Bot status counts' }, countItems),
    h('p', { class: 'hq-hint' }, icon('info', 16), hint),
    extra,
    h('div', { class: 'hq-chips', role: 'group', 'aria-label': 'Bots' }, active.map(b => h('button', { type: 'button', class: 'chip' + (sel && sel.id === b.id ? ' on' : ''), 'aria-pressed': String(!!(sel && sel.id === b.id)), onclick: () => ctx.go(sel && sel.id === b.id ? '#/hq' : `#/hq/${b.id}`) }, portrait(b, 20), b.name)),
      h('button', { type: 'button', class: 'chip', onclick: () => ctx.addBot() }, icon('plus', 16), 'Add bot')));
  const title = h('div', { class: 'hq-title hq-ui' },
    h('div', null, h('h1', null, 'Headquarters'), h('p', null, `Your AI team, in one workspace · ${active.length} bot${active.length === 1 ? '' : 's'}`)),
    modeSwitch(ctx),
    editLayout ? h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ctx.go('#/layout') }, icon('edit', 16), 'Edit layout') : null,
    h('button', { class: 'btn btn-sm', type: 'button', dataset: { fkey: 'hq-add' }, onclick: () => ctx.addBot() }, icon('plus', 16), 'Add bot'));
  return { title, statusBar };
}

function renderDrawer(ctx, b, s, narrow, close) {
  const { M } = ctx, st = ctx.state, t = s.task;
  const events = M.recentEvents(st.tasks, { bot: b.id, limit: 5 });
  const demo = b.connection === 'demo';
  const out = t && t.output_url ? extLink(t.output_url, 'Open output', 'btn btn-outline btn-block') : null;
  return h('aside', { id: 'bot-drawer', class: 'drawer hq-ui', role: narrow ? 'dialog' : 'complementary', 'aria-modal': narrow ? 'true' : null, 'aria-labelledby': 'drawer-title' },
    h('div', { class: 'drawer-head' },
      portrait(b, 64, 'portrait-lg'),
      h('div', { class: 'drawer-id' },
        h('h2', { id: 'drawer-title' }, b.name),
        h('p', { class: 'muted' }, b.focus ? `${b.role} · ${b.focus}` : b.role),
        h('div', { class: 'row gap-sm wrap' }, pill(s.status, M.BOT_STATUS[s.status]), pill(b.connection, b.connection_label))),
      h('button', { class: 'icon-btn drawer-close', type: 'button', 'aria-label': `Close ${b.name} details`, onclick: close }, icon('close', 20))),
    h('div', { class: 'drawer-body' },
      h('div', { class: 'callout callout-' + (demo ? 'amber' : 'grey') }, icon(demo ? 'info' : 'lock', 16),
        h('p', null, demo ? 'Demo fixture. This is not a live connection and the bot is not running.' : 'Disconnected until a connection is verified. No runtime adapter exists, so HQ cannot send work to this bot or receive live status. The status above comes from tasks you recorded manually.')),
      b.capabilities && b.capabilities.length ? h('div', null, h('h3', { class: 'drawer-h' }, 'Capabilities'), h('ul', { class: 'caps' }, b.capabilities.map(c => h('li', null, c)))) : null,
      h('h3', { class: 'drawer-h' }, 'Current assignment'),
      t ? h('div', { class: 'kv' },
        h('p', { class: 'kv-row' }, icon('file', 18), h('span', null, t.title, h('span', { class: 'muted small block' }, `${M.taskKey(t)} · assigned ${M.fmtAgo(t.created_at)}`))),
        h('p', { class: 'kv-row' }, icon('folder', 18), h('span', null, t.project)))
        : h('p', { class: 'muted' }, 'No assignment recorded.'),
      t ? h('div', { class: 'two-col' },
        h('div', null, h('h3', { class: 'drawer-h' }, 'Execution'), pill(t.execution, M.EXEC[t.execution])),
        h('div', null, h('h3', { class: 'drawer-h' }, 'Review'), pill(t.review, M.REVIEW[t.review]))) : null,
      h('h3', { class: 'drawer-h' }, 'Recent events'),
      events.length ? h('ul', { class: 'events' }, events.map(e => h('li', null,
        h('span', { class: `dot dot-${eventTone(e)}`, 'aria-hidden': 'true' }),
        h('span', null, e.text, h('span', { class: 'muted small block' }, `${M.fmtAgo(e.at)} · ${e.source === 'manual' ? 'Manual record' : 'Demo'}`)))))
        : h('p', { class: 'muted' }, 'No events recorded.'),
      h('p', { class: 'muted small' }, manualNote(ctx)),
      h('div', { class: 'row between drawer-tools' },
        botSwitch(ctx, b),
        actionMenu({ label: 'Actions', ariaLabel: `Actions for ${b.name}`, items: [
          { label: 'Prompt & skills', icon: 'book', onSelect: () => ctx.configureBot(b) },
          { label: 'Edit bot', icon: 'edit', onSelect: () => ctx.editBot(b) },
          { label: 'Archive', icon: 'archive', danger: true, onSelect: () => ctx.archiveBot(b) }
        ] }))),
    h('div', { class: 'drawer-foot' },
      t ? h('a', { class: 'btn btn-primary btn-block', href: `#/tasks/${t.id}` }, icon('external', 18), 'View task')
        : h('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: !M.isEnabled(b), onclick: () => ctx.assignTask({ bot: b.id }) }, icon('plus', 18), M.isEnabled(b) ? `Assign a task to ${b.name}` : 'Bot is off'),
      out));
}

export function eventTone(e) {
  if (e.kind === 'review') return e.to === 'passed' ? 'working' : e.to === 'changes_requested' ? 'waiting' : 'queued';
  if (e.kind === 'execution') return e.to === 'blocked' ? 'blocked' : e.to === 'waiting' ? 'waiting' : e.to === 'cancelled' ? 'idle' : 'working';
  return 'queued';
}
