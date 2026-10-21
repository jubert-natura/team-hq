// Visual navigation for the office scene: a bot walks from an entrance, around furniture, to its desk's seat.
// This is decoration only. A walk is never evidence that an AI job ran; agent identity stays separate from
// furniture, and the target always comes from the bot's stable desk assignment (M.arrangeDesks).
// Pure functions over a layout, shared by the browser (animation) and the tests.
import { deskSeat, DESK_SEATS } from './bots-model.js';

export const NAV = {
  cell: 24,          // grid resolution, office units
  clearance: 18,     // walker half-width added around obstacles
  deskDrop: 70,      // must match TUNE.deskDrop in web/bots/js/scene.js
  ownerOffset: [150, -40],
  margin: 420,       // search area around the start and goal
  seatReach: 48      // the last stretch into a chair may cross the desk's clearance
};

// Open floor of office-empty.png in office units, traced inside the walls and around the lounge, meeting room,
// glass rail and bookshelves. Bots never walk through the painted furniture or walls.
export const ROOM_FLOOR = [[210, 614], [573, 589], [819, 481], [952, 410], [1126, 481], [1147, 420], [1331, 338], [1597, 451], [1741, 538],
  [1843, 625], [1843, 809], [1731, 870], [1802, 952], [1178, 1280], [717, 1198], [220, 819]].map(([x, y]) => ({ x, y }));
/** In front of the door in the back-right wall. */
export const ROOM_ENTRY = { x: 1460, y: 425 };

export function inPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Where the seated robot is drawn for desk `d`: the desk's seat (automatic seating) or the saved robot offset. */
export function robotSpot(d) {
  if (d.bot?.layout?.auto_seat) return deskSeat(d, NAV.deskDrop);
  const s = DESK_SEATS[d.view] || DESK_SEATS.front_left, p = d.bot?.layout?.parts?.robot || {};
  return { x: d.x + s[0] + (p.x || 0), y: d.y + s[1] + (p.y || 0) };
}

/** Walkable floor: the room, plus the annex platform (inset from its edges) when there is one. */
export function zones(layout) {
  const out = [ROOM_FLOOR];
  if (layout.annex) {
    const cs = layout.annex.corners, mid = { x: cs.reduce((n, c) => n + c.x, 0) / 4, y: cs.reduce((n, c) => n + c.y, 0) / 4 };
    out.push(cs.map(c => lerp(c, mid, 0.06)));
  }
  return out;
}

/** The entrance for a desk: the room door, or the nearest point on the annex's back edge for annex desks. */
export function entryFor(d, layout) {
  const spot = robotSpot(d);
  if (layout.annex && !inPolygon(spot, ROOM_FLOOR)) {
    const [back, right, front] = layout.annex.corners;
    // project the seat onto the back edge, then step a little onto the platform
    const ex = right.x - back.x, ey = right.y - back.y, t = Math.max(0.05, Math.min(0.95, ((spot.x - back.x) * ex + (spot.y - back.y) * ey) / (ex * ex + ey * ey)));
    const onEdge = { x: back.x + ex * t, y: back.y + ey * t };
    return lerp(onEdge, lerp(front, right, 0.5), 0.12);
  }
  return { ...ROOM_ENTRY };
}

/** Furniture to walk around: every desk, other bots' occupied seats, the shared table and the owner. */
export function obstacles(layout, botId) {
  const out = [];
  for (const d of layout.desks) {
    if (!d.bot) continue;
    const p = d.bot.layout?.parts?.desk || {}, s = p.scale ?? 1;
    out.push({ kind: 'desk', bot: d.bot.id, x: d.x + (p.x || 0), y: d.y + (p.y || 0) + 20 * s, rx: 150 * s, ry: 70 * s });
    if (d.bot.id !== botId) out.push({ kind: 'seat', bot: d.bot.id, ...robotSpot(d), r: 46 });
  }
  if (layout.table) {
    out.push({ kind: 'table', x: layout.table.x, y: layout.table.y + 30, rx: 175, ry: 85 });
    out.push({ kind: 'owner', x: layout.table.x + NAV.ownerOffset[0], y: layout.table.y + NAV.ownerOffset[1], r: 40 });
  }
  return out;
}
function blocks(o, p, c) {
  if (o.r !== undefined) return dist(o, p) < o.r + c;
  const dx = (p.x - o.x) / (o.rx + c), dy = (p.y - o.y) / (o.ry + c / 2);
  return dx * dx + dy * dy < 1;
}

/**
 * Walkability grid over the area around `from` and `to`. Cells inside a walkable zone and clear of obstacles
 * are free. The target seat's own neighbourhood is always free, so a bot can sit in its chair.
 */
export function navGrid(layout, botId, from, to) {
  const cell = NAV.cell, m = NAV.margin;
  const x0 = Math.max(0, Math.floor((Math.min(from.x, to.x) - m) / cell)), y0 = Math.max(0, Math.floor((Math.min(from.y, to.y) - m) / cell));
  const x1 = Math.min(Math.ceil(layout.width / cell), Math.ceil((Math.max(from.x, to.x) + m) / cell));
  const y1 = Math.min(Math.ceil(layout.height / cell), Math.ceil((Math.max(from.y, to.y) + m) / cell));
  const cols = Math.max(1, x1 - x0), rows = Math.max(1, y1 - y0), free = new Uint8Array(cols * rows);
  const zs = zones(layout);
  const box = { l: x0 * cell - 200, t: y0 * cell - 200, r: x1 * cell + 200, b: y1 * cell + 200 };
  const obs = obstacles(layout, botId).filter(o => o.x > box.l && o.x < box.r && o.y > box.t && o.y < box.b);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const p = { x: (x0 + i + 0.5) * cell, y: (y0 + j + 0.5) * cell };
    if (dist(p, to) <= NAV.seatReach) { free[j * cols + i] = 1; continue; }
    if (!zs.some(z => inPolygon(p, z))) continue;
    if (obs.some(o => blocks(o, p, NAV.clearance))) continue;
    free[j * cols + i] = 1;
  }
  return { cell, x0, y0, cols, rows, free };
}
const cellOf = (g, p) => ({ i: Math.floor(p.x / g.cell) - g.x0, j: Math.floor(p.y / g.cell) - g.y0 });
const centre = (g, i, j) => ({ x: (g.x0 + i + 0.5) * g.cell, y: (g.y0 + j + 0.5) * g.cell });
const isFree = (g, i, j) => i >= 0 && j >= 0 && i < g.cols && j < g.rows && g.free[j * g.cols + i] === 1;
/** Nearest free cell to a point, searching outward a few cells (a walker may start just off the floor). */
function nearestFree(g, p, radius = 10) {
  const c = cellOf(g, p);
  for (let r = 0; r <= radius; r++) {
    let best = null, bd = Infinity;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r || !isFree(g, c.i + di, c.j + dj)) continue;
      const d = di * di + dj * dj; if (d < bd) { bd = d; best = { i: c.i + di, j: c.j + dj }; }
    }
    if (best) return best;
  }
  return null;
}
/** Clear straight line between two points? Sampled at half-cell steps. */
export function lineOfSight(g, a, b) {
  const steps = Math.max(1, Math.ceil(dist(a, b) / (g.cell / 2)));
  for (let k = 0; k <= steps; k++) { const p = lerp(a, b, k / steps), c = cellOf(g, p); if (!isFree(g, c.i, c.j)) return false; }
  return true;
}

/**
 * Path from `from` to `to` for bot `botId`, as a short list of office-unit points (start and goal included),
 * or null when the seat cannot be reached (the caller then seats the bot directly).
 */
export function findPath(layout, botId, from, to) {
  const g = navGrid(layout, botId, from, to);
  const s = nearestFree(g, from), t = nearestFree(g, to, 3);
  if (!s || !t) return null;
  const N = g.cols * g.rows, key = (i, j) => j * g.cols + i;
  const gScore = new Float64Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const h = (i, j) => Math.hypot(i - t.i, j - t.j);
  const heap = []; // binary heap of [f, index]
  const push = (f, k) => { heap.push([f, k]); let n = heap.length - 1; while (n) { const p = (n - 1) >> 1; if (heap[p][0] <= heap[n][0]) break; [heap[p], heap[n]] = [heap[n], heap[p]]; n = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let n = 0; for (;;) { const l = 2 * n + 1, r = l + 1; let m = n; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === n) break; [heap[m], heap[n]] = [heap[n], heap[m]]; n = m; } } return top; };
  const start = key(s.i, s.j), goal = key(t.i, t.j);
  gScore[start] = 0; push(h(s.i, s.j), start);
  while (heap.length) {
    const [, k] = pop();
    if (closed[k]) continue;
    if (k === goal) break;
    closed[k] = 1;
    const i = k % g.cols, j = (k - i) / g.cols;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (!isFree(g, ni, nj)) continue;
      if (di && dj && (!isFree(g, i + di, j) || !isFree(g, i, j + dj))) continue; // no corner cutting
      const nk = key(ni, nj), cost = gScore[k] + (di && dj ? Math.SQRT2 : 1);
      if (cost < gScore[nk]) { gScore[nk] = cost; came[nk] = k; push(cost + h(ni, nj), nk); }
    }
  }
  if (gScore[goal] === Infinity) return null;
  const cells = [];
  for (let k = goal; k !== -1; k = came[k]) cells.push(k);
  cells.reverse();
  const raw = [from, ...cells.map(k => centre(g, k % g.cols, Math.floor(k / g.cols))), to];
  return smooth(g, raw);
}
/** Drop waypoints that a straight walk can skip. */
function smooth(g, pts) {
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineOfSight(g, pts[i], pts[j])) j--;
    out.push(pts[j]); i = j;
  }
  return out;
}

export const pathLength = pts => pts.slice(1).reduce((n, p, i) => n + dist(pts[i], p), 0);
/** Position after walking `d` units along the path, with the current heading. */
export function pointAlong(pts, d) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = dist(a, b);
    if (d <= len || i === pts.length - 1) {
      const t = len ? Math.min(1, Math.max(0, d / len)) : 1;
      return { ...lerp(a, b, t), dx: b.x - a.x, dy: b.y - a.y, done: i === pts.length - 1 && d >= len };
    }
    d -= len;
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y, dx: 0, dy: 1, done: true };
}
/** Sprite direction for a heading: front sheet column while walking down the screen, rear column while walking up. */
export function headingView(dx, dy) {
  if (dy >= 0) return { col: 0, flip: dx < 0 };   // column 0 faces down-right; mirrored it faces down-left
  return { col: 2, flip: dx > 0 };                // column 2 faces up-left; mirrored it faces up-right
}

/**
 * 3D office: which robot-seated.png column to draw for a bot facing `phi` (yaw, 0 = +z) seen by a camera at
 * azimuth `theta` (camera at (sin θ, ·, cos θ) around its target). Columns: 0 toward the viewer and screen-right,
 * 1 toward the viewer and screen-left, 2 away and screen-right, 3 away and screen-left.
 */
export function seatedColumn(phi, theta) {
  const a = phi - theta, front = Math.cos(a) >= 0, right = Math.sin(a) > 0;
  return front ? (right ? 0 : 1) : (right ? 2 : 3);
}
