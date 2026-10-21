// Walk-to-seat: visual navigation only. When a bot first gets a desk (added, restored or its desk moved), it walks
// in from the entrance along a path around furniture (shared/bots-nav.js), then settles into its chair.
// Nothing here reflects AI execution. Reduced motion, the Settings switch or "Skip" seat everyone instantly.
//
// Frames: robot-actions.png walk rows 4/5 (two-frame cycle), columns 0 and 2 plus mirrors for four headings.
// The pack has no sit-down, stand-up or turning frames, so arrival is a short cross-fade from standing to seated.
// See design/MISSING-ANIMATION-FRAMES.md for the exact frames to request next.
import { h } from './lib.js';
import { findPath, entryFor, robotSpot, pathLength, pointAlong, headingView } from '/shared/bots-nav.js';

const SHEET = { src: '/bots/assets/modular/robot-actions.png', cols: 4, rows: 6, cellW: 340, cellH: 2048 / 6 };
const ANCHOR = { 0: [174.5, 322], 2: [168.5, 325] }; // walk-row foot anchors from atlas.json (row 4)
const WALK = { scale: 0.8, speed: 260, fps: 6, rows: [4, 5] };
const SEEN = 'teamBot.arrived', PREF = 'teamBot.walk';

// In-progress walks survive re-renders (opening the drawer, data refresh), so a walk resumes or reroutes
// from where the bot is instead of restarting.
const walkers = new Map(); // bot id -> { key, pos }

const readSeen = () => { try { return JSON.parse(localStorage.getItem(SEEN) || '{}') || {}; } catch { return {}; } };
const writeSeen = s => { try { localStorage.setItem(SEEN, JSON.stringify(s)); } catch { /* per-visit only */ } };
// Each entry remembers the arrival key and the seat the bot settled in, so a saved desk move walks from the old seat.
// Older entries were plain key strings; both forms are read.
const mark = (key, seat) => ({ key, x: Math.round(seat.x), y: Math.round(seat.y) });
const seenKey = v => (typeof v === 'string' ? v : v && v.key) || null;
const seenPos = v => (v && typeof v === 'object' && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export function walkingAllowed() {
  let on = true;
  try { on = localStorage.getItem(PREF) !== 'off'; } catch { /* default on */ }
  return on && !reduced();
}
export function setWalking(on) { try { localStorage.setItem(PREF, on ? 'on' : 'off'); } catch { /* ignore */ } }
export const walkingPreference = () => { try { return localStorage.getItem(PREF) !== 'off'; } catch { return true; } };

/** What a bot has already walked to: its desk, desk position and view, and how many times it was restored. */
export function arrivalKey(d) {
  const restored = (d.bot.history || []).filter(x => x.kind === 'restored').length;
  return [d.slot, Math.round(d.x), Math.round(d.y), d.view, restored, d.bot.layout?.auto_seat ? 'auto' : 'manual'].join('|');
}

const pct = (u, of) => (u / of * 100) + '%';
const zOf = y => 1000 + Math.round(y) * 4;

/**
 * Start walks for stations that need one. `stations`: [{ d, robot (seated element), style, enabled }].
 * Returns { active, skip, stop } — stop() is the cleanup (keeps positions for resuming), skip() seats everyone.
 */
export function runArrivals({ layout, stations, world, worldEl, label = () => '', onChange = () => { } }) {
  const seen = readSeen(), allowed = walkingAllowed(), runs = [];
  for (const s of stations) {
    const id = s.d.bot.id, key = arrivalKey(s.d), w = walkers.get(id), goal = robotSpot(s.d);
    const settled = seenKey(seen[id]) === key && !(w && w.key !== key);
    if (!allowed || !s.enabled || !s.robot) { seen[id] = mark(key, goal); walkers.delete(id); continue; }
    if (settled && !w) continue;
    // start where the bot is: mid-walk, else the seat it last sat in (a saved desk move), else the entrance
    // (a restored bot returning to the same seat walks in from the entrance instead)
    const prev = seenPos(seen[id]);
    const from = w ? w.pos : (prev && Math.hypot(prev.x - goal.x, prev.y - goal.y) > 8 ? prev : entryFor(s.d, layout));
    const path = findPath(layout, id, from, goal);
    if (!path || pathLength(path) < 8) { seen[id] = mark(key, goal); walkers.delete(id); continue; } // unreachable or already there: seat directly
    runs.push({ id, key, path, len: pathLength(path), dist: 0, s, el: null, tag: null, flip: false, col: 0 });
  }
  writeSeen(seen);
  if (!runs.length) return { active: 0, skip() { }, stop() { } };

  for (const r of runs) {
    r.s.robot.classList.add('awaiting'); // the seated robot appears when the walk ends
    r.el = h('span', { class: 'sprite walker', 'aria-hidden': 'true', style: {
      backgroundImage: `url("${SHEET.src}")`, backgroundSize: `${SHEET.cols * 100}% ${SHEET.rows * 100}%`,
      width: pct(SHEET.cellW * WALK.scale, world.W), height: pct(SHEET.cellH * WALK.scale, world.H),
      filter: r.s.style.robotHue ? `hue-rotate(${r.s.style.robotHue}deg)` : ''
    } });
    r.tag = h('span', { class: 'walk-tag', 'aria-hidden': 'true' }, label(r.s.d));
    worldEl.append(r.el, r.tag);
    walkers.set(r.id, { key: r.key, pos: { ...r.path[0] } });
  }

  let raf = 0, last = performance.now(), t = 0, stopped = false;
  const place = (r, p) => {
    const hv = headingView(p.dx, p.dy), a = ANCHOR[hv.col], sc = WALK.scale;
    const ax = hv.flip ? SHEET.cellW - a[0] : a[0];
    const row = WALK.rows[Math.floor(t * WALK.fps / 1000) % 2];
    Object.assign(r.el.style, {
      left: pct(p.x - ax * sc, world.W), top: pct(p.y - a[1] * sc, world.H), zIndex: String(zOf(p.y) + 2),
      backgroundPosition: `${hv.col / (SHEET.cols - 1) * 100}% ${row / (SHEET.rows - 1) * 100}%`,
      transform: hv.flip ? 'scaleX(-1)' : ''
    });
    Object.assign(r.tag.style, { left: pct(p.x, world.W), top: pct(p.y - 300, world.H) });
    walkers.get(r.id).pos = { x: p.x, y: p.y };
  };
  const arrive = r => {
    r.done = true;
    const seen2 = readSeen(); seen2[r.id] = mark(r.key, r.path[r.path.length - 1]); writeSeen(seen2);
    walkers.delete(r.id);
    r.s.robot.classList.remove('awaiting');
    r.el.classList.add('arrived'); r.tag.remove();
    setTimeout(() => r.el.remove(), 300); // cross-fade: no sit-down frames exist yet
  };
  const frame = now => {
    if (stopped) return;
    const dt = Math.min(64, now - last); last = now;
    if (!document.hidden) {
      t += dt;
      for (const r of runs) {
        if (r.done) continue;
        r.dist += WALK.speed * dt / 1000;
        const p = pointAlong(r.path, r.dist);
        place(r, p);
        if (p.done) arrive(r);
      }
    }
    if (runs.some(r => !r.done)) raf = requestAnimationFrame(frame); else onChange(0);
  };
  for (const r of runs) place(r, pointAlong(r.path, 0));
  raf = requestAnimationFrame(frame);

  return {
    active: runs.length,
    /** Seat everyone now. */
    skip() { stopped = true; cancelAnimationFrame(raf); for (const r of runs) if (!r.done) arrive(r); onChange(0); },
    /** Leaving the view: stop drawing but keep each bot's position so the walk resumes or reroutes next time. */
    stop() { stopped = true; cancelAnimationFrame(raf); for (const r of runs) { if (!r.done) { r.el.remove(); r.tag.remove(); } } }
  };
}
