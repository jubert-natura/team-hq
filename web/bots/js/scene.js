// Office scene composer for the modular Higgsfield pack in web/bots/assets/modular (see its README, atlas.json
// and REFERENCE-ASSET-AUDIT.md). Every bot reuses the same desk, chair and seated-robot atlases; colour comes
// from the bot's character style. Originals are drawn unchanged with normal alpha blending.
//
// Layer order per station: floor → rug → furniture/character → labels. Occlusion comes from draw order, not masks:
//   facing the viewer (robot behind the desk):   chair → robot → desk   (the desk hides the legs)
//   facing away     (robot in front of the desk): desk → robot → chair  (the chair back covers the robot's back)
// All placement numbers are in office units (the backdrop is 2048 × 1360) and live in TUNE / VIEWS below.
// Press D on the map to show anchor points while tuning.
import { h } from './lib.js';
import { deskSeat, rugPlacement } from '/shared/bots-model.js';

const A = '/bots/assets/modular/';
export const SHEETS = {
  desk: { src: A + 'desk-views.png', cols: 2, rows: 2, cell: 1024 },
  chair: { src: A + 'chair-views.png', cols: 2, rows: 2, cell: 1024 },
  seated: { src: A + 'robot-seated.png', cols: 4, rows: 4, cell: 512 },
  support: { src: A + 'scene-support.png', cols: 4, rows: 4, cell: 512 }
};
export const BACKDROP = A + 'office-empty.png';
export const FLOOR = A + 'floor-texture.png';

// Foot anchors (cell-local px) from atlas.json initial_foot_anchor. The seated robot uses its row-0 anchor for every
// frame of a column, so idle/blink/typing frames share one foot point and do not jitter.
const ANCHOR = {
  desk: { '0,0': [536.5, 945], '0,1': [489, 942], '1,0': [554.5, 860], '1,1': [489.5, 857] },
  chair: { '0,0': [575, 932], '0,1': [452, 933], '1,0': [570.5, 850], '1,1': [481.5, 849] },
  seated: { 0: [256.5, 489], 1: [242, 491], 2: [256, 490], 3: [229, 490] },
  // support cells: table (rear, with laptop), owner (front), plants by foot; rugs by the centre of their content box
  table: [249.5, 454], owner: [271, 459], tallPlant: [255.5, 402], smallPlant: [255.5, 375], lavenderRug: [256.5, 238], coralRug: [256.5, 241]
};

/**
 * Station views, keyed by M.stationView(). desk/chair are [row, col] cells; robot is the seated column.
 * seat = chair foot position relative to the station point. Pairings follow the artwork: a desk whose screens face
 * a direction is matched with the chair and robot facing back into those screens.
 */
// The rug art's long side runs down-right, like desk column 0. Views using desk column 1 (front_left, rear_left)
// run down-left, so M.RUG_MIRRORED_VIEWS mirrors their rug to lie along the desk.
export const VIEWS = {
  front_left: { desk: [1, 1], chair: [0, 0], robot: 0, seat: [-92, -38], order: ['chair', 'robot', 'desk'] },
  front_right: { desk: [1, 0], chair: [0, 1], robot: 1, seat: [92, -38], order: ['chair', 'robot', 'desk'] },
  rear_right: { desk: [0, 0], chair: [1, 0], robot: 2, seat: [96, 96], order: ['desk', 'robot', 'chair'] },
  rear_left: { desk: [0, 1], chair: [1, 1], robot: 3, seat: [-96, 96], order: ['desk', 'robot', 'chair'] }
};
export const TUNE = {
  desk: 0.42, chair: 0.24, robot: 0.5, rug: 0.84, table: 0.78, ownerScale: 0.56, plant: 0.5,
  deskDrop: 70,     // desk foot sits this far below the station point
  robotLift: 6,     // robot feet sit this far above the chair foot (pelvis on the seat)
  labelLift: 318,   // name label bottom, above the station point
  ownerOffset: [150, -40] // the owner stands this far from the shared table
};

const ROBOT_FRAMES = { idle: 0, blink: 1, typingA: 2, typingB: 3 };

/** A sprite: one atlas cell placed so its anchor lands on (x, y). Positions are percentages of the world. */
function sprite(sheet, row, col, x, y, scale, anchor, z, world, extra = {}) {
  const s = SHEETS[sheet], size = s.cell * scale;
  return h('span', {
    class: `sprite sprite-${sheet} ${extra.cls || ''}`.trim(), 'aria-hidden': 'true', dataset: extra.data || null,
    style: {
      left: pct(x - anchor[0] * scale, world.W), top: pct(y - anchor[1] * scale, world.H),
      width: pct(size, world.W), height: pct(size, world.H), zIndex: String(z),
      backgroundImage: `url("${s.src}")`, backgroundSize: `${s.cols * 100}% ${s.rows * 100}%`,
      backgroundPosition: `${col / (s.cols - 1) * 100}% ${row / (s.rows - 1) * 100}%`,
      filter: extra.filter || ''
    }
  });
}
const pct = (u, of) => (u / of * 100) + '%';
const zOf = y => 1000 + Math.round(y) * 4;

/**
 * The rug under a desk. It belongs to the desk: it follows the desk's position, its offset and size (automatic
 * seating), and lies along the desk for every view (mirrored for the down-left desk orientation).
 */
export function rugSprite(d, style, world) {
  const p = rugPlacement(d); // shared rule (tested): follows the desk, mirrored for down-left desks
  const el = sprite('support', 3, 2, p.x, p.y, TUNE.rug * p.scale, ANCHOR.lavenderRug, 10, world,
    { cls: 'rug', data: { part: 'rug' }, filter: `hue-rotate(${style.rugHue}deg) saturate(1.15)` });
  if (p.flip) el.style.transform = 'scaleX(-1)'; // mirrored about its own centre, which is the anchor
  return el;
}

/**
 * One workstation: rug, desk, chair and seated robot for a bot at desk `d` (from M.arrangeDesks).
 * Returns the nodes and, for the animator, the robot element.
 */
export function station(d, style, world, { typing = false, selected = false } = {}) {
  const v = VIEWS[d.view] || VIEWS.front_left, z = zOf(d.y), nodes = [];
  const parts = d.bot?.layout?.parts || {}, adjust = name => parts[name] || { x: 0, y: 0, scale: 1 };
  const automatic = d.bot?.layout?.auto_seat === true;
  nodes.push(rugSprite(d, style, world));
  if (selected) nodes.push(h('span', { class: 'station-ring', 'aria-hidden': 'true', style: { left: pct(d.x, world.W), top: pct(d.y, world.H), width: pct(330, world.W), '--bot': style.color } }));
  const seat = automatic ? deskSeat(d, TUNE.deskDrop) : { x: d.x + v.seat[0], y: d.y + v.seat[1] };
  const seatX = seat.x, seatY = seat.y;
  const layer = {
    desk: () => sprite('desk', v.desk[0], v.desk[1], d.x, d.y + TUNE.deskDrop, TUNE.desk, ANCHOR.desk[v.desk.join(',')], 0, world),
    chair: () => sprite('chair', v.chair[0], v.chair[1], seatX, seatY, TUNE.chair, ANCHOR.chair[v.chair.join(',')], 0, world),
    robot: () => sprite('seated', typing ? ROBOT_FRAMES.typingA : ROBOT_FRAMES.idle, v.robot, seatX, seatY - TUNE.robotLift, TUNE.robot, ANCHOR.seated[v.robot], 0, world,
      { cls: 'robot', filter: style.robotHue ? `hue-rotate(${style.robotHue}deg)` : '' })
  };
  let robot = null;
  v.order.forEach((name, i) => {
    const el = layer[name]();
    const saved = adjust(name), p = automatic && name !== 'desk' ? { x: 0, y: 0, scale: saved.scale } : saved, s = SHEETS[name === 'robot' ? 'seated' : name];
    const anchor = name === 'desk' ? ANCHOR.desk[v.desk.join(',')] : name === 'chair' ? ANCHOR.chair[v.chair.join(',')] : ANCHOR.seated[v.robot];
    const base = name === 'desk' ? { x: d.x, y: d.y + TUNE.deskDrop } : { x: seatX, y: seatY - (name === 'robot' ? TUNE.robotLift : 0) };
    const scale = TUNE[name] * p.scale;
    Object.assign(el.style, { left: pct(base.x + p.x - anchor[0] * scale, world.W), top: pct(base.y + p.y - anchor[1] * scale, world.H), width: pct(s.cell * scale, world.W), height: pct(s.cell * scale, world.H) });
    el.dataset.part = name;
    el.style.zIndex = String(z + i);
    if (name === 'robot') robot = el;
    nodes.push(el);
  });
  nodes.push(h('span', { class: 'anchor-dot', 'aria-hidden': 'true', style: { left: pct(d.x, world.W), top: pct(d.y, world.H) } }),
    h('span', { class: 'anchor-dot seat', 'aria-hidden': 'true', style: { left: pct(seatX, world.W), top: pct(seatY, world.H) } }));
  return { nodes, robot };
}

/** The shared table in the centre of the room, with the owner standing beside it. */
export function sharedTable(t, world) {
  const ox = t.x + TUNE.ownerOffset[0], oy = t.y + TUNE.ownerOffset[1];
  return [
    sprite('support', 3, 3, t.x, t.y, TUNE.rug * 1.15, ANCHOR.coralRug, 10, world, { cls: 'rug' }),
    sprite('support', 0, 2, t.x, t.y + 60, TUNE.table, ANCHOR.table, zOf(t.y + 60), world),
    sprite('support', 1, 0, ox, oy, TUNE.ownerScale, ANCHOR.owner, zOf(oy), world),
    h('span', { class: 'you-tag', 'aria-hidden': 'true', style: { left: pct(ox, world.W), top: pct(oy - 250, world.H) } }, 'You')
  ];
}

/** An open desk: a dashed outline where the next bot will sit. */
export function openDesk(d, world) {
  return h('span', { class: 'open-spot', 'aria-hidden': 'true', style: { left: pct(d.x, world.W), top: pct(d.y, world.H), width: pct(300, world.W) } });
}

const SVG = 'http://www.w3.org/2000/svg';
const el = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
/**
 * The annex floor outside the room: a code-generated isometric slab filled with the repeating floor texture,
 * with faint grid joints and two plants. `project` is M.project; `annex` comes from M.arrangeDesks.
 */
export function annexFloor(annex, world, project, scene) {
  const [back, right, front, left] = annex.corners, slab = scene.slab;
  const pts = ps => ps.map(p => `${p.x},${p.y}`).join(' ');
  const svg = el('svg', { class: 'annex-floor', viewBox: `0 0 ${world.W} ${world.H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
  const defs = el('defs', {});
  const pat = el('pattern', { id: 'floorTex', patternUnits: 'userSpaceOnUse', width: 512, height: 512 });
  pat.append(el('image', { href: FLOOR, width: 512, height: 512, preserveAspectRatio: 'none' }));
  defs.append(pat); svg.append(defs);
  const down = p => ({ x: p.x, y: p.y + slab });
  svg.append(
    el('polygon', { points: pts([left, front, down(front), down(left)]), fill: '#EFE8DD' }),
    el('polygon', { points: pts([front, right, down(right), down(front)]), fill: '#E3DACC' }),
    el('polygon', { points: pts([back, right, front, left]), fill: 'url(#floorTex)', stroke: '#E8DFD1', 'stroke-width': 6 }));
  const c0 = scene.annexCol - 0.5, rows = scene.annexRows;
  for (let i = 1; i < annex.cols; i++) { const a = project(c0 + i, -0.5), b = project(c0 + i, rows - 0.5); svg.append(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'joint' })); }
  for (let r = 1; r < rows; r++) { const a = project(c0, r - 0.5), b = project(c0 + annex.cols, r - 0.5); svg.append(el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'joint' })); }
  const plants = [
    sprite('support', 3, 1, back.x, back.y + 40, TUNE.plant, ANCHOR.tallPlant, zOf(back.y + 40), world),
    sprite('support', 3, 0, right.x - 70, right.y + 10, TUNE.plant, ANCHOR.smallPlant, zOf(right.y + 10), world)
  ];
  return [svg, ...plants];
}

/**
 * Blink and typing loop. Typing is shown only for robots the caller marks as `typing` (verified connection or
 * demo data); everyone else idles with an occasional blink. Nothing animates under prefers-reduced-motion.
 */
export function animate(robots) {
  if (!robots.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return () => { };
  const start = performance.now();
  const timer = setInterval(() => {
    if (document.hidden) return;
    const t = performance.now() - start;
    for (const r of robots) {
      const row = r.typing ? (Math.floor((t + r.phase) / 200) % 2 ? ROBOT_FRAMES.typingB : ROBOT_FRAMES.typingA)
        : ((t + r.phase) % 3400 < 120 ? ROBOT_FRAMES.blink : ROBOT_FRAMES.idle);
      if (row !== r.row) { r.row = row; r.el.style.backgroundPositionY = (row / 3 * 100) + '%'; }
    }
  }, 50);
  return () => clearInterval(timer);
}
