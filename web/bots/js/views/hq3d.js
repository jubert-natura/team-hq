// Headquarters, 3D version: the human team HQ's low-poly office (three.js, orthographic camera you can turn and
// zoom), with the same bots drawn from the original seated-robot artwork. Each robot is a camera-facing sprite;
// its atlas column (toward or away from you, left or right) follows the camera angle, so the four Higgsfield
// views keep reading correctly as the office turns. Desks come from the stable desk slots, so a bot keeps its
// place in both versions; custom positions from the 2D layout editor apply to the 2D map only.
// Statuses come only from recorded tasks. Typing motion is shown only for verified or demo bots.
import { h, icon, pill, portrait, botColor, trapFocus } from '../lib.js';
import { seatedColumn } from '/shared/bots-nav.js';
import * as theme from '../theme.js';

// The same three.js build the human HQ loads, fetched only when the 3D version is opened.
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const A = '/bots/assets/modular/';
// robot-seated.png: 4 × 4 cells of 512 px. Columns by seatedColumn(); rows idle, blink, typing A, typing B.
// feet: atlas.json foot anchors (cell px), the same points the 2D scene uses.
const SEATED = { src: A + 'robot-seated.png', cell: 512, feet: [[256.5, 489], [242, 491], [256, 490], [229, 490]] };
const OWNER = { src: A + 'scene-support.png', cell: 512, row: 1, col: 0, feet: [271, 459] };
const FRAME = { idle: 0, blink: 1, typingA: 2, typingB: 3 };
const TEX = 256, ROBOT_SIZE = 1.2, OWNER_SIZE = 1.55;
const DEF_THETA = Math.PI / 4, LIFT = 0.6; // camera azimuth on the art's diagonals; camera height per unit of distance
const ZMIN = 0.6, ZMAX = 2.6;
const SCREEN = { working: 0x6FA8DC, waiting: 0xF2C27A, blocked: 0xE58C8C, queued: 0x8FA3B8, idle: 0x49576A, off: 0x1B2026 };
const GRASS = { light: 0xA7C25A, dark: 0x7E9A45 };
const NARROW = '(max-width: 720px)';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const hexNum = c => parseInt(String(c).replace('#', ''), 16) || 0x8C8577;

// ---- version switch: the 2D map or the 3D office, remembered per browser ----
const MODE_KEY = 'teamBot.hqMode';
let modeMemory = null; // used when the browser blocks storage
export function hqMode() {
  let v = modeMemory;
  try { v = localStorage.getItem(MODE_KEY) || modeMemory; } catch { /* storage blocked */ }
  return v === '3d' ? '3d' : '2d';
}
function setMode(ctx, m) {
  modeMemory = m;
  try { localStorage.setItem(MODE_KEY, m); } catch { /* kept in memory */ }
  ctx.go(location.hash || '#/hq');
}
export function modeSwitch(ctx) {
  const cur = hqMode();
  return h('div', { class: 'hq-mode', role: 'group', 'aria-label': 'Office version' },
    [['2d', '2D map'], ['3d', '3D office']].map(([m, label]) => h('button', {
      type: 'button', class: 'hq-mode-btn', 'aria-pressed': String(cur === m), title: label, dataset: { fkey: 'hq-mode-' + m },
      onclick: () => { if (cur !== m) setMode(ctx, m); }
    }, m.toUpperCase(), h('span', { class: 'sr-only' }, ` ${label}`))));
}

// ---- loading ----
let threeP = null;
function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  return threeP || (threeP = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = THREE_URL; s.async = true;
    s.onload = () => (window.THREE ? ok(window.THREE) : fail(new Error('three.js did not load')));
    s.onerror = () => { threeP = null; s.remove(); fail(new Error('three.js could not be downloaded')); };
    document.head.append(s);
  }));
}
const images = {};
const image = src => images[src] || (images[src] = new Promise((ok, fail) => {
  const i = new Image();
  i.onload = () => ok(i); i.onerror = () => { delete images[src]; fail(new Error('image')); };
  i.src = src;
}));

// One renderer for the whole visit: re-rendering the page (selecting a bot, an action) re-attaches it, so the
// camera angle survives and no WebGL context is created per click.
let engine = null;
const getEngine = THREE => engine || (engine = createEngine(THREE));

function createEngine(THREE) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const canvas = renderer.domElement; canvas.className = 'office3d-canvas';
  const scene = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 300);
  const target = new THREE.Vector3();
  let theta = DEF_THETA, zoom = 1, anim = null, camMoved = true;
  const placeCam = () => {
    const r = 60;
    cam.position.set(target.x + Math.sin(theta) * r, r * LIFT, target.z + Math.cos(theta) * r);
    cam.lookAt(target); cam.zoom = zoom; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    camMoved = true;
  };

  // lights, materials and the ground: as in the human HQ
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7a8a4a, .72));
  const sun = new THREE.DirectionalLight(0xffffff, .78); sun.position.set(14, 24, 10); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 }); sun.shadow.bias = -0.0008; scene.add(sun);
  const mats = {};
  const mat = (c, o) => { const k = c + '|' + (o || 1); return mats[k] || (mats[k] = new THREE.MeshLambertMaterial({ color: c, transparent: !!o && o < 1, opacity: o || 1, depthWrite: !(o && o < 1) })); };
  const box = (w, ht, d, c, x, y, z, parent, o) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, ht, d), mat(c, o));
    m.position.set(x, y, z); m.castShadow = !(o && o < 1); m.receiveShadow = true; parent.add(m); return m;
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshLambertMaterial({ color: GRASS.light }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -.3; ground.receiveShadow = true; scene.add(ground);
  const paint = () => { const c = GRASS[theme.current()] || GRASS.light; scene.background = new THREE.Color(c); ground.material.color.setHex(c); };
  paint(); theme.onChange(paint);
  const V = (x, z) => new THREE.Vector3(x, 0, z);

  // ---- floor plan: front door | open office, four desks per column | team room with the shared table ----
  // Desk i is slot i: slot 0 sits by the team room, later slots extend toward the door, so the office grows with
  // the roster and nobody moves. Rows next to the aisle (z = 0) fill first, as in the human HQ.
  function planFor(n) {
    const cols = Math.max(2, Math.ceil(n / 4)), OW = cols * 2.2 + .8, RW = 5.4, TW = OW + RW, H = 5.1;
    const xL = -TW / 2, xR = xL + OW, xE = xL + TW, desks = [];
    for (let i = 0; i < cols * 4; i++) {
      const c = Math.floor(i / 4), row = i % 4, x = xR - 1.5 - c * 2.2, z = [-1.1, 1.1, -4.0, 4.0][row], f = [1, -1, -1, 1][row];
      desks.push({ x, z, f, seat: V(x, z - f * .85), phi: f > 0 ? 0 : Math.PI, screen: null });
    }
    const tx = xR + RW / 2 + .2, tz = -1.6;
    return { cols, OW, RW, TW, H, xL, xR, xE, desks, table: V(tx, tz), owner: V(tx + 1.95, tz + .2), zone: V(xR + RW / 2, -4.7) };
  }
  let office = null, plan = null, officeKey = '';
  function buildOffice(p, rugs) {
    if (office) { scene.remove(office); office.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.userData.own) o.material.dispose(); }); }
    office = new THREE.Group(); scene.add(office);
    const ob = (w, ht, d, c, x, y, z, o) => box(w, ht, d, c, x, y, z, office, o);
    const { TW, OW, RW, H, xL, xR, xE } = p;
    // floors and walls: a door gap in the left wall, a doorway into the team room
    ob(TW + .4, .3, 10.4, 0xEDE7DC, 0, -.15, 0);
    ob(OW - .1, .02, 10, 0xE2D2B2, xL + OW / 2, .01, 0);
    ob(RW - .3, .02, 10, 0xC9C2DA, xR + RW / 2, .012, 0);
    ob(TW + .4, 1.3, .2, 0xCFC6B6, 0, .65, -H);
    ob(.2, 1.3, 4.2, 0xCFC6B6, xL - .1, .65, -3.1); ob(.2, 1.3, 4.2, 0xCFC6B6, xL - .1, .65, 3.1);
    ob(1.8, .02, 1.6, 0x8C8577, xL - 1.0, .01, 0);
    ob(.14, 1.1, 4.1, 0xDCD5C8, xR, .55, -3.05); ob(.14, 1.1, 4.1, 0xDCD5C8, xR, .55, 3.05);

    // workstations: desk, monitor, chair; an occupied desk gets a rug in its bot's colour, like the 2D map
    p.desks.forEach((d, i) => {
      const g = new THREE.Group(); g.position.set(d.x, 0, d.z); office.add(g); const f = d.f;
      if (rugs.has(i)) box(1.9, .012, 2.3, rugs.get(i), 0, .022, -f * .45, g, .32);
      box(1.6, .08, .8, 0xF4EFE6, 0, .72, 0, g); box(.06, .7, .7, 0xB8A58A, -.74, .36, 0, g); box(.06, .7, .7, 0xB8A58A, .74, .36, 0, g);
      box(.6, .32, .05, 0x2A2F36, 0, .96, f * .2, g);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(.52, .25), new THREE.MeshBasicMaterial({ color: SCREEN.off }));
      screen.position.set(0, .96, f * .2 - f * .03); screen.rotation.y = f > 0 ? Math.PI : 0; screen.userData.own = true; g.add(screen); d.screen = screen;
      box(.1, .16, .1, 0x2A2F36, 0, .8, f * .22, g);
      box(.18, .18, .18, [0xE07A5F, 0x3D405B, 0xF2CC8F, 0x81B29A][i % 4], .55, .85, -f * .05, g);
      if (i % 3 === 1) { box(.2, .22, .2, 0xC9B38F, -.6, .87, f * .1, g); box(.24, .2, .24, 0x5E9E4A, -.6, 1.08, f * .1, g); }
      box(.46, .08, .46, 0x3A4450, 0, .44, -f * .85, g); box(.46, .5, .08, 0x3A4450, 0, .72, -f * 1.07, g); box(.08, .4, .08, 0x2A2F36, 0, .2, -f * .85, g);
    });

    // team room: the shared table with its chairs and laptop, a wall screen, a sofa and a bookshelf
    const { x: tx, z: tz } = p.table;
    ob(2.9, .08, 1.2, 0xF4EFE6, tx, .7, tz); ob(.1, .66, .1, 0xB8A58A, tx - 1.3, .35, tz); ob(.1, .66, .1, 0xB8A58A, tx + 1.3, .35, tz);
    for (const side of [1, -1]) for (const dx of [-1.05, -.35, .35, 1.05]) ob(.4, .4, .4, 0x7B5EA7, tx + dx, .2, tz + side * 1.2);
    ob(.42, .03, .3, 0x2A2F36, tx - .45, .755, tz); ob(.42, .26, .02, 0x2A2F36, tx - .45, .88, tz - .15);
    ob(1.8, .9, .06, 0x2A2F36, tx, 1.2, -H + .15); ob(1.64, .74, .02, 0x5566FF, tx, 1.2, -H + .19);
    ob(2.2, .4, .8, 0x45A593, tx, .2, 2.4); ob(2.2, .5, .2, 0x45A593, tx, .55, 2.75); ob(.2, .3, .8, 0x45A593, tx - 1.1, .45, 2.4); ob(.2, .3, .8, 0x45A593, tx + 1.1, .45, 2.4);
    ob(2.6, 1.2, .45, 0xB8A58A, tx, .6, 4.7);
    for (let k = 0; k < 8; k++) ob(.18, .3, .3, [0xE07A5F, 0x3D405B, 0xF2CC8F, 0x81B29A][k % 4], tx - 1.05 + k * .3, 1.35, 4.65);

    // greenery and trees, as in the human HQ
    const plant = (x, z, s = 1) => { ob(.34 * s, .34 * s, .34 * s, 0xC9B38F, x, .17 * s, z); ob(.5 * s, .6 * s, .5 * s, 0x5E9E4A, x, .64 * s, z); };
    plant(xL + .4, -4.7); plant(xL - .5, 1.4); plant(xL - .5, -1.4); plant(xR - .3, -4.7); plant(xE - .4, -4.6, 1.2); plant(xL + .4, 4.7);
    const tree = (x, z, s) => { ob(.3 * s, 1 * s, .3 * s, 0x7A5230, x, .5 * s - .3, z); ob(1.3 * s, 1.2 * s, 1.3 * s, 0x4F8A3C, x, 1.4 * s - .3, z); ob(.8 * s, .6 * s, .8 * s, 0x6BAA4B, x, 2.2 * s - .3, z); };
    [[xL - 3, -7, 1.1], [xE + 2.5, -6, 1], [xE + 3.5, 3, 1.3], [xL - 3.5, 5, 1], [0, 9, .9], [xL + 4, -9, 1.2], [xE - 2, 8, 1.1], [xL + 1, 9, .8], [TW * .2, -9, 1]].forEach(q => tree(...q));
    Object.assign(sun.shadow.camera, { left: -TW / 2 - 2, right: TW / 2 + 2 }); sun.shadow.camera.updateProjectionMatrix();
  }

  // ---- robots: one sprite per bot, drawn from the seated sheet in its character colour ----
  let seatedImg = null, owner = null;
  image(SEATED.src).then(i => { seatedImg = i; }, () => { /* robots stay hidden; furniture still shows */ });
  const robots = new Map();
  const blobGeo = new THREE.CircleGeometry(.36, 24), ringGeo = new THREE.RingGeometry(.55, .66, 40);
  const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .14, depthWrite: false });
  const openRing = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x8C8577, transparent: true, opacity: .7, depthWrite: false, side: THREE.DoubleSide }));
  openRing.rotation.x = -Math.PI / 2; openRing.visible = false; scene.add(openRing);
  function makeRobot(id) {
    const cv = document.createElement('canvas'); cv.width = cv.height = TEX;
    const tex = new THREE.CanvasTexture(cv);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, alphaTest: .04 }));
    sprite.scale.set(ROBOT_SIZE, ROBOT_SIZE, 1); sprite.renderOrder = 2; sprite.userData.id = id;
    const shadow = new THREE.Mesh(blobGeo, blobMat); shadow.rotation.x = -Math.PI / 2;
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .9, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.visible = false;
    scene.add(sprite, shadow, ring);
    return { id, g2: cv.getContext('2d'), tex, sprite, shadow, ring, desk: null, drawn: -1, placed: -1, hue: 0, enabled: true, typing: false, phase: 0 };
  }
  function dropRobot(r) { scene.remove(r.sprite, r.shadow, r.ring); r.tex.dispose(); r.sprite.material.dispose(); r.ring.material.dispose(); }
  /** Copy one atlas cell into the robot's own small texture. Canvas filters tint it; without them it stays teal. */
  function draw(r, col, row) {
    const k = col * 4 + row; if (r.drawn === k) return;
    const c = r.g2; c.clearRect(0, 0, TEX, TEX);
    c.filter = r.hue ? `hue-rotate(${r.hue}deg)` : 'none';
    c.drawImage(seatedImg, col * SEATED.cell, row * SEATED.cell, SEATED.cell, SEATED.cell, 0, 0, TEX, TEX);
    r.drawn = k; r.tex.needsUpdate = true;
  }
  // The sprite's depth plane decides what hides it, matching the 2D layer order. Facing you, it sits in front of
  // its chair and behind its desk; facing away, in front of its desk and behind the chair back. `center` then
  // shifts the art so its feet still land on the floor point F.
  const right = new THREE.Vector3(), up = new THREE.Vector3(), tmp = new THREE.Vector3(), F = new THREE.Vector3(), P = new THREE.Vector3();
  function anchor(sprite, feet, size) {
    sprite.position.copy(P); tmp.subVectors(P, F);
    sprite.center.set(feet[0] / SEATED.cell + tmp.dot(right) / size, 1 - feet[1] / SEATED.cell + tmp.dot(up) / size);
  }
  function place(r, col) {
    const d = r.desk, f = d.f, front = col < 2;
    F.set(d.seat.x, 0, d.seat.z + f * .12);
    P.set(d.seat.x, front ? .9 : .6, d.seat.z + f * (front ? .3 : -.1));
    anchor(r.sprite, SEATED.feet[col], ROBOT_SIZE);
    r.shadow.position.set(d.seat.x, .025, d.seat.z + f * .05);
    r.ring.position.set(d.seat.x, .03, d.seat.z);
    r.placed = col;
  }
  image(OWNER.src).then(img => {
    const cv = document.createElement('canvas'); cv.width = cv.height = TEX;
    cv.getContext('2d').drawImage(img, OWNER.col * OWNER.cell, OWNER.row * OWNER.cell, OWNER.cell, OWNER.cell, 0, 0, TEX, TEX);
    owner = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, alphaTest: .04 }));
    owner.scale.set(OWNER_SIZE, OWNER_SIZE, 1); owner.renderOrder = 2; scene.add(owner); camMoved = true;
  }, () => { /* the "You" tag still marks the spot */ });
  function placeOwner() {
    if (!owner || !plan) return;
    F.copy(plan.owner); P.set(plan.owner.x, .8, plan.owner.z);
    anchor(owner, OWNER.feet, OWNER_SIZE);
  }

  // ---- camera ----
  function animTo(to, z1, th1) {
    if (reduceMotion()) { target.copy(to); zoom = z1; theta = th1; anim = null; placeCam(); return; }
    anim = { t0: performance.now(), from: target.clone(), to: to.clone(), z0: zoom, z1, th0: theta, th1 };
  }
  const goal = () => (anim ? { to: anim.to, z: anim.z1, th: anim.th1 } : { to: target, z: zoom, th: theta });
  const zoomTo = z => { const g = goal(); animTo(g.to, Math.min(ZMAX, Math.max(ZMIN, z)), g.th); };
  let stageW = 1, stageH = 1, pendingReveal = null;
  function resize() {
    if (!host) return;
    stageW = host.stage.clientWidth || 1; stageH = host.stage.clientHeight || 1;
    const asp = stageW / stageH; renderer.setSize(stageW, stageH, false);
    const TW = plan ? plan.TW : 16, D = 10.4, ct = Math.abs(Math.cos(DEF_THETA)), st = Math.abs(Math.sin(DEF_THETA)), sp = LIFT / Math.hypot(1, LIFT);
    const half = 1.12 * Math.max(((TW * st + D * ct) * sp + 1.6) / 2, (TW * ct + D * st) / 2 / asp);
    Object.assign(cam, { left: -half * asp, right: half * asp, top: half, bottom: -half }); placeCam();
  }
  /** Bring a selected bot's desk into view if it is off screen (the drawer covers the right side on wide screens). */
  function reveal(seat) {
    tmp.copy(seat).project(cam);
    const x = (tmp.x + 1) / 2 * stageW, y = (1 - tmp.y) / 2 * stageH, visW = host ? host.visibleWidth() : stageW;
    if (x > 80 && x < visW - 80 && y > 120 && y < stageH - 120) return;
    const g = goal(); animTo(seat, Math.max(g.z, 1.3), g.th);
  }

  // ---- input on the canvas: drag to turn, wheel to zoom, click a robot to select it ----
  let drag = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  ray.camera = cam; // sprites need it for hit tests
  const hit = e => {
    const rc = canvas.getBoundingClientRect();
    ndc.set((e.clientX - rc.left) / rc.width * 2 - 1, -(e.clientY - rc.top) / rc.height * 2 + 1); ray.setFromCamera(ndc, cam);
    const x = ray.intersectObjects([...robots.values()].map(r => r.sprite), false)[0];
    return x ? x.object.userData.id : null;
  };
  canvas.addEventListener('pointerdown', e => { if (e.button === 0 && e.isPrimary) drag = { x: e.clientX, th: theta, moved: false, id: e.pointerId }; });
  canvas.addEventListener('pointermove', e => {
    if (drag && e.pointerId === drag.id) {
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 4) { drag.moved = true; anim = null; canvas.classList.add('grabbing'); try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
      if (drag.moved) { theta = drag.th - dx * .008; placeCam(); }
      return;
    }
    if (e.pointerType === 'mouse') canvas.style.cursor = hit(e) ? 'pointer' : '';
  });
  const endDrag = e => {
    if (drag && !drag.moved && e.type === 'pointerup' && host) host.onPick(hit(e));
    drag = null; canvas.classList.remove('grabbing');
  };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.min(ZMAX, Math.max(ZMIN, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1))); anim = null; placeCam(); }, { passive: false });

  // ---- frame loop, only while the 3D page is showing ----
  let host = null, raf = 0, ro = null, lastSel = null, openSlot = -1;
  const t0 = performance.now();
  function pin(el, x, y, z) {
    tmp.set(x, y, z).project(cam);
    const px = Math.round((tmp.x + 1) / 2 * stageW), py = Math.round((1 - tmp.y) / 2 * stageH);
    if (el._px !== px || el._py !== py) { el._px = px; el._py = py; el.style.left = px + 'px'; el.style.top = py + 'px'; }
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!host || !plan) return;
    if (anim) {
      const k = Math.min(1, (now - anim.t0) / 650), e = 1 - Math.pow(1 - k, 3);
      target.lerpVectors(anim.from, anim.to, e); zoom = anim.z0 + (anim.z1 - anim.z0) * e; theta = anim.th0 + (anim.th1 - anim.th0) * e;
      placeCam(); if (k >= 1) anim = null;
    }
    if (pendingReveal && stageW > 1) { reveal(pendingReveal); pendingReveal = null; }
    if (camMoved) { right.setFromMatrixColumn(cam.matrixWorld, 0); up.setFromMatrixColumn(cam.matrixWorld, 1); placeOwner(); }
    const t = now - t0, still = reduceMotion();
    for (const r of robots.values()) {
      if (!r.desk) continue;
      const col = seatedColumn(r.desk.phi, theta);
      if (camMoved || col !== r.placed) place(r, col);
      if (!seatedImg) continue;
      let row = FRAME.idle;
      if (r.enabled && !still) row = r.typing ? (Math.floor((t + r.phase) / 200) % 2 ? FRAME.typingB : FRAME.typingA) : ((t + r.phase) % 3400 < 120 ? FRAME.blink : FRAME.idle);
      draw(r, col, row);
    }
    camMoved = false;
    for (const [id, el] of host.labels) { const r = robots.get(id); if (r && r.desk) pin(el, r.desk.seat.x, 1.45, r.desk.seat.z); }
    const open = plan.desks[openSlot];
    if (host.openEl.hidden !== !open) host.openEl.hidden = !open;
    if (open) pin(host.openEl, open.seat.x, .9, open.seat.z);
    pin(host.ownerEl, plan.owner.x, 1.95, plan.owner.z);
    pin(host.zoneEl, plan.zone.x, 1.4, plan.zone.z);
    host.labelsEl.style.visibility = 'visible';
    renderer.render(scene, cam);
  }

  return {
    attach(next) {
      this.detach();
      host = next; next.stage.prepend(canvas);
      ro = new ResizeObserver(resize); ro.observe(next.stage);
      raf = requestAnimationFrame(frame);
    },
    detach() {
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      raf = 0; ro = null; host = null; drag = null; anim = null;
    },
    /** data: { desks: [{ id, slot, hue, color, enabled, typing, status, selected }], open, sel } */
    sync(data) {
      const n = Math.max(data.open + 1, 1, ...data.desks.map(d => d.slot + 1));
      const key = [n, ...data.desks.map(d => `${d.slot}:${d.color}`)].join('|');
      if (key !== officeKey) {
        officeKey = key; plan = planFor(n);
        buildOffice(plan, new Map(data.desks.map(d => [d.slot, hexNum(d.color)])));
        for (const r of robots.values()) r.desk = null;
        resize();
      }
      const seen = new Set();
      for (const d of data.desks) {
        let r = robots.get(d.id);
        if (!r) { r = makeRobot(d.id); robots.set(d.id, r); }
        seen.add(d.id);
        const desk = plan.desks[d.slot];
        if (r.desk !== desk || r.hue !== d.hue) { r.drawn = -1; r.placed = -1; }
        Object.assign(r, { desk, hue: d.hue, enabled: d.enabled, typing: d.typing, phase: (d.slot * 977) % 3400 });
        r.sprite.material.opacity = d.enabled ? 1 : .55;
        r.ring.visible = d.selected; r.ring.material.color.set(d.color);
        desk.screen.material.color.setHex(SCREEN[d.status] ?? SCREEN.idle);
      }
      for (const [id, r] of robots) if (!seen.has(id)) { dropRobot(r); robots.delete(id); }
      openSlot = data.open;
      const open = plan.desks[openSlot];
      openRing.visible = !!open; if (open) openRing.position.set(open.seat.x, .03, open.seat.z);
      if (data.sel && data.sel !== lastSel && robots.has(data.sel)) pendingReveal = robots.get(data.sel).desk.seat.clone();
      lastSel = data.sel;
      camMoved = true;
    },
    rotateBy(a) { const g = goal(); animTo(g.to, g.z, g.th + a); },
    zoomBy(f) { zoomTo(goal().z * f); },
    reset() { const th = DEF_THETA + 2 * Math.PI * Math.round((theta - DEF_THETA) / (2 * Math.PI)); animTo(new THREE.Vector3(), 1, th); }
  };
}

/** The 3D Headquarters page. Shares the title, status bar and bot drawer with the 2D map (passed in by hq.js). */
export function render3d(ctx, param, { renderDrawer, chrome }) {
  const { M } = ctx, st = ctx.state, active = ctx.activeBots();
  const sel = active.find(b => b.id === param) || null;
  const layout = M.arrangeDesks(st.bots);
  const status = Object.fromEntries(active.map(b => [b.id, M.botStatus(st.tasks, b.id, b)]));
  const counts = M.teamCounts(st.tasks, active);
  const narrow = matchMedia(NARROW).matches;
  const motionOk = b => b.connection === 'connected' || b.connection === 'demo';
  const desks = layout.desks.map(d => {
    const b = d.bot, s = M.botStyle(b), stt = status[b.id].status;
    return { id: b.id, slot: d.slot, hue: s.robotHue || 0, color: s.color, enabled: M.isEnabled(b), typing: stt === 'working' && motionOk(b) && M.isEnabled(b), status: stt, selected: !!(sel && sel.id === b.id) };
  });
  const demoMotion = ctx.demo && desks.some(d => d.typing);

  // name tags float above each robot, as on the 2D map; the engine positions them every frame
  const labels = new Map(layout.desks.map(d => {
    const b = d.bot, s = status[b.id], on = !!(sel && sel.id === b.id);
    return [b.id, h('button', {
      type: 'button', class: 'bot-label' + (on ? ' selected' : ''), style: { '--bot': botColor(b) },
      'aria-expanded': String(on), 'aria-controls': on ? 'bot-drawer' : null, dataset: { fkey: 'label-' + b.id },
      'aria-label': `${b.name}, ${b.role}, desk ${d.slot + 1}. ${M.BOT_STATUS[s.status]}. ${b.connection_label}.`,
      onclick: () => ctx.go(on ? '#/hq' : `#/hq/${b.id}`)
    }, portrait(b, 30), h('span', { class: 'bot-label-text' }, h('span', { class: 'bot-label-name' }, b.name), pill(s.status, M.BOT_STATUS[s.status], 'pill-xs')))];
  }));
  const openEl = h('button', { type: 'button', class: 'bot-label open-desk', 'aria-label': `Open desk ${layout.open.slot + 1}. Add a bot to the team.`, onclick: () => ctx.addBot() },
    icon('plus', 16), h('span', { class: 'bot-label-name' }, 'Open desk'));
  const ownerEl = h('span', { class: 'you-tag', 'aria-hidden': 'true' }, 'You');
  const zoneEl = h('span', { class: 'zone3d', 'aria-hidden': 'true' }, 'Team table');
  const labelsEl = h('div', { class: 'labels3d', style: { '--z': '1' } }, ownerEl, zoneEl, [...labels.values()], openEl);
  const msg = h('p', { class: 'stage3d-msg', role: 'status' }, 'Loading the 3D office…');
  const stage = h('div', { class: 'stage3d', tabindex: '0', role: 'region', 'aria-label': `3D office with ${active.length} bot desk${active.length === 1 ? '' : 's'}`, 'aria-describedby': 'scene3d-help' }, msg, labelsEl);

  let eng = null, dead = false;
  const use = fn => () => { if (eng) fn(eng); };
  const ctrls = h('div', { class: 'hq-ctrls hq-ui', role: 'group', 'aria-label': 'Office view' },
    h('button', { class: 'ctrl', type: 'button', 'aria-label': 'Turn the office left', title: 'Turn left (←)', onclick: use(e => e.rotateBy(-Math.PI / 4)) }, icon('rotateLeft', 20)),
    h('button', { class: 'ctrl', type: 'button', 'aria-label': 'Turn the office right', title: 'Turn right (→)', onclick: use(e => e.rotateBy(Math.PI / 4)) }, icon('rotateRight', 20)),
    h('button', { class: 'ctrl', type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in (+)', onclick: use(e => e.zoomBy(1.2)) }, icon('plus', 20)),
    h('button', { class: 'ctrl', type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out (−)', onclick: use(e => e.zoomBy(1 / 1.2)) }, icon('minus', 20)),
    h('button', { class: 'ctrl', type: 'button', 'aria-label': 'Reset view', title: 'Reset view (0)', onclick: use(e => e.reset()) }, icon('fit', 20)));

  const hint = demoMotion ? 'Demo data · typing motion is illustrative' : counts.connected ? 'Select a bot to view activity' : 'No bots connected · statuses come from manual records';
  const { title, statusBar } = chrome(ctx, { active, sel, counts, hint, editLayout: false });
  const help = h('p', { id: 'scene3d-help', class: 'sr-only' }, 'Drag, or use the left and right arrow keys, to turn the office. Plus and minus zoom, 0 resets the view. Select a bot label to see its details.');

  let drawer = null, untrap = null;
  function close() {
    if (untrap) untrap();
    ctx.ui.hq.returnFocus = sel ? 'label-' + sel.id : null;
    ctx.go('#/hq');
  }
  if (sel) {
    drawer = renderDrawer(ctx, sel, status[sel.id], narrow, close);
    if (narrow) untrap = trapFocus(drawer, close);
    else drawer.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  }
  const scrim = sel && narrow ? h('div', { class: 'drawer-scrim', onclick: close }) : null;
  const root = h('section', { class: 'hq hq-3d' + (sel ? ' has-drawer' : '') }, stage, title, ctrls, statusBar, help, scrim, drawer);

  stage.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'Escape' && sel) close();
    else if (!eng) return;
    else if (k === 'ArrowLeft') eng.rotateBy(-Math.PI / 8);
    else if (k === 'ArrowRight') eng.rotateBy(Math.PI / 8);
    else if (k === '+' || k === '=') eng.zoomBy(1.2);
    else if (k === '-' || k === '_') eng.zoomBy(1 / 1.2);
    else if (k === '0') eng.reset();
    else return;
    e.preventDefault();
  });

  const fail = text => {
    msg.hidden = false; msg.textContent = '';
    msg.append(text, ' ', h('button', { class: 'btn btn-sm', type: 'button', onclick: () => setMode(ctx, '2d') }, 'Show the 2D map'));
  };
  const mount = THREE => {
    if (dead) return;
    try { eng = getEngine(THREE); } catch { fail('3D graphics are not available in this browser.'); return; }
    msg.hidden = true;
    eng.attach({
      stage, labels, openEl, ownerEl, zoneEl, labelsEl,
      visibleWidth: () => (drawer && !narrow ? Math.max(stage.clientWidth * .45, stage.clientWidth - drawer.offsetWidth - 32) : stage.clientWidth),
      onPick: id => { if (id) ctx.go(sel && sel.id === id ? '#/hq' : `#/hq/${id}`); else if (sel) ctx.go('#/hq'); }
    });
    eng.sync({ desks, open: layout.open.slot, sel: sel ? sel.id : null });
  };
  if (window.THREE) mount(window.THREE);
  else loadThree().then(mount, () => { if (!dead) fail('The 3D office could not load. Check your connection, or use the 2D map.'); });

  requestAnimationFrame(() => {
    if (dead) return;
    const rf = ctx.ui.hq.returnFocus; ctx.ui.hq.returnFocus = null;
    if (rf) { const el = root.querySelector(`[data-fkey="${rf}"]`); if (el) el.focus({ preventScroll: true }); }
    else if (sel && narrow) { const c = drawer.querySelector('.drawer-close'); if (c) c.focus(); }
  });
  return { el: root, cleanup: () => { dead = true; if (eng) eng.detach(); if (untrap) untrap(); } };
}
