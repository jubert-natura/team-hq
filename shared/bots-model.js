// Team Bot model: pure functions shared by the server (validation, rules, reports) and the
// browser (display). Nothing here reads files, the network or the clock unless a time is passed in.

// ---- character styles: reusable looks so a new bot never needs new artwork ----
// sheet: quadrant of web/bots/assets/bot-portraits.png (background-position at 200% 200%).
// hue: CSS hue-rotate applied to that quadrant. The first four are the original artwork, unchanged.
// robotHue / rugHue: hue-rotate for the shared office sprites (the teal seated robot and the lavender rug),
// so every bot reuses the same atlases in its own colour.
export const CHARACTER_STYLES = {
  violet: { label: 'Violet', sheet: '0% 0%', hue: 0, color: '#6D4AE8', robotHue: 100, rugHue: -5 },
  ember: { label: 'Ember', sheet: '100% 0%', hue: 0, color: '#D9622B', robotHue: -147, rugHue: 117 },
  jade: { label: 'Jade', sheet: '0% 100%', hue: 0, color: '#1A8F6A', robotHue: -5, rugHue: -101 },
  iris: { label: 'Iris', sheet: '100% 100%', hue: 0, color: '#5B47D6', robotHue: 70, rugHue: -20 },
  sky: { label: 'Sky', sheet: '0% 0%', hue: -55, color: '#2F6FDB', robotHue: 45, rugHue: -44 },
  rose: { label: 'Rose', sheet: '0% 0%', hue: 60, color: '#C93B83', robotHue: 164, rugHue: 68 },
  gold: { label: 'Gold', sheet: '100% 0%', hue: 22, color: '#A97B06', robotHue: -123, rugHue: 141 },
  crimson: { label: 'Crimson', sheet: '100% 0%', hue: -20, color: '#C03A3A', robotHue: -166, rugHue: 98 },
  teal: { label: 'Teal', sheet: '0% 100%', hue: 22, color: '#12807A', robotHue: 11, rugHue: -85 },
  lime: { label: 'Lime', sheet: '0% 100%', hue: -45, color: '#4F8A14', robotHue: -76, rugHue: -172 }
};
export const STYLE_IDS = Object.keys(CHARACTER_STYLES);
export const styleOf = id => CHARACTER_STYLES[id] || CHARACTER_STYLES.violet;
export const botStyle = b => styleOf(b && b.avatar && b.avatar.style);

// ---- the roster lives in the data file. These four are only the starting configuration. ----
export const DEFAULT_BOTS = [
  { id: 'chatgpt', name: 'ChatGPT', role: 'Planner', focus: 'Planning & coordination', style: 'violet', capabilities: ['Planning', 'Briefs', 'Coordination'] },
  { id: 'claude', name: 'Claude', role: 'Builder', focus: 'Coding & web design', style: 'ember', capabilities: ['Front-end code', 'Web design', 'Responsive layout'] },
  { id: 'researcher', name: 'Researcher', role: 'Researcher', focus: 'Research & analysis', style: 'jade', capabilities: ['Source research', 'Market analysis', 'Summaries'] },
  { id: 'reviewer', name: 'Reviewer', role: 'Reviewer', focus: 'Quality assurance & feedback', style: 'iris', capabilities: ['QA checks', 'Accessibility', 'Review notes'] }
];
// Optional role and skill templates configure bots; they do not establish AI connections.
export const BOT_TEMPLATES = [
  ...DEFAULT_BOTS.map(b => ({ ...b, name: b.role, prompt: `Act as the team's ${b.role.toLowerCase()}. Use approved project context and return an output with evidence and next steps.` })),
  { id: 'designer', name: 'Designer', role: 'Designer', focus: 'Brand, UI and reusable assets', style: 'rose', capabilities: ['Design briefs', 'UI design', 'Asset prompts'], prompt: 'Follow approved brand and design references. Prepare reusable assets with clear specifications. Check light/dark themes and responsive layouts.', design_guidelines: 'Near black #111111; dark grey #262626; white grey #D2D2D2; white #FFFFFF; mint #75FFE6 and #45A593; azure #5566FF and #242E8E; peach #FFB1B1 and #FF8888. Use approved Team Bot references and Higgsfield for generated artwork when connected.' },
  { id: 'writer', name: 'Writer', role: 'Writer', focus: 'Documents, updates and content', style: 'sky', capabilities: ['Drafts', 'Project updates', 'Editing'], prompt: 'Write clear drafts for the intended audience using approved facts. Flag missing information. Follow the requested tone and return drafts for human review.' },
  { id: 'analyst', name: 'Analyst', role: 'Analyst', focus: 'Data, trends and reports', style: 'gold', capabilities: ['Data analysis', 'Reports', 'Trends'], prompt: 'Analyze supplied data, state assumptions, verify calculations and explain findings with evidence. Do not invent metrics.' },
  { id: 'knowledge', name: 'Knowledge Keeper', role: 'Knowledge Keeper', focus: 'Shared notes, SOPs and answers', style: 'teal', capabilities: ['Knowledge search', 'SOP drafts', 'Note organization'], prompt: 'Answer from approved shared knowledge and cite source notes. Flag outdated or conflicting information. Propose changes for review and respect access boundaries.' },
  { id: 'automation', name: 'Automation', role: 'Automation', focus: 'Repeatable workflows and integrations', style: 'crimson', capabilities: ['Workflow design', 'Integration plans', 'Automation checks'], prompt: 'Design workflows with clear triggers, inputs, outputs and failure handling. Use connected tools with approved permissions. Obtain required approval before external actions.' },
  { id: 'coordinator', name: 'Project Coordinator', role: 'Project Coordinator', focus: 'Progress, handoffs and blockers', style: 'lime', capabilities: ['Progress summaries', 'Handoffs', 'Blocker tracking'], prompt: 'Track recorded progress, owners, due dates and blockers. Prepare concise handoffs. Distinguish facts from assumptions; do not claim to have contacted teammates.' }
];
export const SKILL_TEMPLATES = [
  { name: 'Weekly project update', trigger: 'When preparing a weekly project update', instructions: 'Read approved notes and recorded tasks. Summarize completed work, current work, blockers and next steps with owners. Cite source notes or tasks. Mark missing information. Return a concise draft for human review.' },
  { name: 'Design and asset brief', trigger: 'When creating a UI or visual asset', instructions: 'Read approved design guidelines and references. Specify dimensions, colors, states, perspectives and output format. Prefer reusable assets. Use Higgsfield for artwork when connected. Check light/dark readability and return assets for review.' },
  { name: 'Knowledge answer with sources', trigger: 'When answering from shared knowledge', instructions: 'Search approved shared sources. Answer concisely and cite supporting notes. Identify conflicts and outdated facts. If evidence is missing, say what is missing rather than guessing.' },
  { name: 'Review against requirements', trigger: 'When reviewing a draft or task', instructions: 'Compare the output with each acceptance criterion. Record pass, needs changes or missing evidence. Give actionable corrections. Never mark an unverified result as passed.' }
];
/** A bot always starts Disconnected. Only a verified runtime connection (no adapter exists yet) may change that. */
export const newConnection = () => ({ status: 'disconnected', verified_at: null });
export function seedBots(at) {
  return DEFAULT_BOTS.map((b, i) => ({
    id: b.id, name: b.name, role: b.role, focus: b.focus, avatar: { style: b.style }, capabilities: [...b.capabilities],
    connection: newConnection(), order: i, desk: i, created_at: at, updated_at: at, archived_at: null,
    enabled: true, prompt: '', design_guidelines: '', skills: [],
    history: [{ at, kind: 'created', text: `Configured as ${b.role}` }]
  }));
}
export const BOT_ID_RE = /^(?:[a-z]{2,20}|bot_[a-z0-9]{8,32})$/;
export const isActive = b => !!b && !b.archived_at;
export const isEnabled = b => isActive(b) && b.enabled !== false;
export const availableBots = bots => activeBots(bots).filter(isEnabled);
const byOrder = (a, b) => (a.order - b.order) || String(a.created_at).localeCompare(String(b.created_at));
export const activeBots = bots => bots.filter(isActive).sort(byOrder);
export const archivedBots = bots => bots.filter(b => !isActive(b)).sort((a, b) => String(b.archived_at).localeCompare(String(a.archived_at)));
export const botById = (bots, id) => bots.find(b => b.id === id) || null;
export const botName = (bots, id) => (botById(bots, id) || { name: 'Unknown bot' }).name;

// ---- office layout: stable desk slots on an isometric grid ----
// The fixed backdrop is web/bots/assets/modular/office-empty.png (2048 × 1360 office units). Desk slots sit on a
// 2:1 isometric grid: x = origin.x + (c − r) · tile/2, y = origin.y + (c + r) · tile/4. Slots 0–7 fill the room's
// open floor around the shared table in the centre cell; slot 8 onward fill an annex floor that grows outside
// the room's front-right wall, three desks per column. Each bot keeps its desk number, so adding a bot never moves
// anyone else; archiving frees the desk for the next bot.
export const OFFICE = { w: 2048, h: 1360 };
export const SCENE = { tile: 560, origin: { x: 1010, y: 520 }, annexCol: 4, annexRows: 3, margin: 170, slab: 46 };
export const ROOM_CELLS = [[0, 1], [1, 0], [1, 2], [2, 1], [0, 0], [2, 0], [0, 2], [2, 2]]; // [column, row], fill order
export const TABLE_CELL = [1, 1];
export const project = (c, r) => ({ x: SCENE.origin.x + (c - r) * SCENE.tile / 2, y: SCENE.origin.y + (c + r) * SCENE.tile / 4 });
export function slotCell(slot) {
  if (slot < ROOM_CELLS.length) { const [c, r] = ROOM_CELLS[slot]; return { c, r, zone: 'room' }; }
  const k = slot - ROOM_CELLS.length;
  return { c: SCENE.annexCol + Math.floor(k / SCENE.annexRows), r: k % SCENE.annexRows, zone: 'annex' };
}
/** Station orientation for a cell: bots at the sides face the centre of the room; some face away for variety. */
export function stationView(c, r) {
  if (c < r) return 'front_left';
  if (c > r) return c >= SCENE.annexCol ? ['front_left', 'rear_right', 'front_right'][r] : 'front_right';
  return c === 0 ? 'front_right' : 'rear_left';
}
export const lowestFree = taken => { let i = 0; while (taken.has(i)) i++; return i; };
/**
 * Desk slot → bot for the active roster. A bot keeps its stored desk; a bot without one (older data) or whose
 * desk is already taken gets the lowest free slot, in roster order. Pure and deterministic.
 */
export function deskSlots(bots) {
  const taken = new Map(), pending = [];
  for (const b of activeBots(bots)) {
    if (Number.isInteger(b.desk) && b.desk >= 0 && !taken.has(b.desk)) taken.set(b.desk, b); else pending.push(b);
  }
  for (const b of pending) taken.set(lowestFree(taken), b);
  return taken;
}
/** Write the effective desk onto every active bot, so stored data matches what is drawn. Returns the slot map. */
export function settleDesks(bots) {
  const slots = deskSlots(bots);
  for (const [slot, b] of slots) b.desk = slot;
  return slots;
}
/** Everything the office renderer needs: stations, the next open desk, the annex floor and the world size. */
export function arrangeDesks(bots) {
  const slots = deskSlots(bots);
  const next = lowestFree(slots);
  const highest = Math.max(next, ...slots.keys());
  const annexCols = Math.max(0, Math.ceil((highest + 1 - ROOM_CELLS.length) / SCENE.annexRows));
  const station = (slot, bot) => { const cell = slotCell(slot), base = project(cell.c, cell.r); return { slot, bot, ...cell, x: bot?.layout?.x ?? base.x, y: bot?.layout?.y ?? base.y, view: bot?.layout?.view || stationView(cell.c, cell.r) }; };
  const desks = [...slots].map(([slot, bot]) => station(slot, bot)).sort((a, b) => a.y - b.y || a.x - b.x);
  let annex = null, width = OFFICE.w, height = OFFICE.h;
  if (annexCols) {
    const c0 = SCENE.annexCol - 0.5, c1 = SCENE.annexCol + annexCols - 0.5, r0 = -0.5, r1 = SCENE.annexRows - 0.5;
    const corners = [project(c0, r0), project(c1, r0), project(c1, r1), project(c0, r1)]; // back, right, front, left
    annex = { cols: annexCols, corners };
    width = Math.max(width, corners[1].x + SCENE.margin);
    height = Math.max(height, corners[2].y + SCENE.slab + SCENE.margin);
  }
  for (const d of desks) { width = Math.max(width, d.x + 220); height = Math.max(height, d.y + 220); }
  return { width, height, desks, open: station(next, null), annex, table: project(...TABLE_CELL), rooms: annexCols };
}

export const LAYOUT_VIEWS = ['front_left', 'front_right', 'rear_right', 'rear_left'];
export const LAYOUT_PARTS = ['robot', 'chair', 'desk', 'rug'];
export const DESK_SEATS = { front_left: [-92, -38], front_right: [92, -38], rear_right: [96, 96], rear_left: [-96, 96] };
export function rotateDeskView(view, turns) {
  const i = LAYOUT_VIEWS.indexOf(view);
  if (i < 0 || !Number.isInteger(turns)) throw new ValidationError('Invalid desk rotation.', 'view');
  return LAYOUT_VIEWS[((i + turns) % 4 + 4) % 4];
}
/** Visual seat assignment follows the desk transform, without storing a second bot position. */
export function deskSeat(d, deskDrop = 70) {
  const p = d.bot?.layout?.parts?.desk || {}, scale = p.scale ?? 1;
  const seat = DESK_SEATS[d.view] || DESK_SEATS.front_left;
  return { x: d.x + (p.x || 0) + seat[0] * scale, y: d.y + deskDrop + (p.y || 0) + (seat[1] - deskDrop) * scale };
}
/** Desk views whose desk art runs down-left; the rug art runs down-right, so it is mirrored to lie along the desk. */
export const RUG_MIRRORED_VIEWS = ['front_left', 'rear_left'];
/**
 * Where the rug under desk `d` goes. The rug belongs to the desk: it follows the station point, and with automatic
 * seating also the desk's offset and size; its own saved offset and scale apply on top.
 */
export function rugPlacement(d) {
  const parts = d.bot?.layout?.parts || {}, rug = parts.rug || {};
  const desk = d.bot?.layout?.auto_seat === true ? (parts.desk || {}) : {};
  return {
    x: d.x + (desk.x || 0) + (rug.x || 0), y: d.y + (desk.y || 0) + (rug.y || 0),
    scale: (rug.scale ?? 1) * (desk.scale ?? 1), flip: RUG_MIRRORED_VIEWS.includes(d.view)
  };
}
/** Validated office-unit positions, with independent offsets and scale for alignment. */
export function layoutInput(v) {
  const obj = (x, field) => { if (!x || typeof x !== 'object' || Array.isArray(x)) throw new ValidationError('Expected layout settings.', field); return x; };
  obj(v, 'layout');
  const point = (p, field) => ({ x: finiteNumber(p.x ?? 0, field, { min: -400, max: 400 }), y: finiteNumber(p.y ?? 0, field, { min: -400, max: 400 }) });
  const parts = v.parts === undefined ? {} : obj(v.parts, 'parts');
  if (Object.keys(parts).some(k => !LAYOUT_PARTS.includes(k))) throw new ValidationError('Unknown layout part.', 'parts');
  return {
    x: finiteNumber(v.x, 'x', { min: 128, max: 16000 }), y: finiteNumber(v.y, 'y', { min: 128, max: 16000 }),
    view: oneOf(v.view, LAYOUT_VIEWS, 'view', 'Direction'),
    ...(v.auto_seat === undefined ? {} : { auto_seat: booleanInput(v.auto_seat, 'auto_seat') }),
    parts: Object.fromEntries(LAYOUT_PARTS.map(k => { const p = parts[k] === undefined ? {} : obj(parts[k], k); return [k, { ...point(p, k), scale: finiteNumber(p.scale ?? 1, k, { min: 0.5, max: 1.75 }) }]; })),
    label: point(v.label === undefined ? {} : obj(v.label, 'label'), 'label')
  };
}

export const KNOWLEDGE_REPO = 'https://github.com/natura-hq/team-knowledge';

export const EXEC = { queued: 'Queued', in_progress: 'In progress', waiting: 'Waiting', blocked: 'Blocked', completed: 'Completed', cancelled: 'Cancelled' };
export const REVIEW = { not_requested: 'Not requested', pending: 'Pending review', passed: 'Passed', changes_requested: 'Needs changes' };
export const REVIEW_SET = ['pending', 'passed', 'changes_requested']; // what an owner can record
export const LESSON = { proposed: 'Proposed', testing: 'Testing', validated: 'Validated' };
export const LESSON_NEXT = { proposed: ['testing'], testing: ['proposed', 'validated'], validated: ['testing'] };
export const TEST_RESULT = { pass: 'Pass', fail: 'Fail' };
export const BOT_STATUS = { working: 'Working', waiting: 'Waiting', blocked: 'Blocked', queued: 'Queued', idle: 'No assignment', off: 'Off' };
export const CONNECTION = { disconnected: 'Disconnected', connected: 'Connected', demo: 'Demo fixture' };
export const OPEN_EXEC = ['queued', 'in_progress', 'waiting', 'blocked'];

/** Validated needs this many passed trial results, each with written evidence, on the current instruction. */
export const VALIDATION_MIN_PASSES = 5;

export const LIMITS = {
  title: 120, project: 80, criteria: 2000, note: 1000, issue: 60, lesson: 1000, instruction: 1000, evidence: 1000, url: 2000,
  tasks: 2000, lessons: 500, reports: 200, events: 300, tests: 200, keys: 20,
  botName: 40, botRole: 40, botFocus: 120, capability: 40, capabilities: 12, bots: 200, botHistory: 100,
  prompt: 12000, design: 6000, skillName: 80, skillTrigger: 500, skillInstructions: 12000, skills: 30
};

// ---- validation (server uses these on every write; the browser reuses them for forms) ----
export class ValidationError extends Error {
  constructor(message, field) { super(message); this.name = 'ValidationError'; this.field = field || null; this.status = 400; }
}
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Trimmed text with a length limit. Rejects non-strings and control characters. */
export function text(v, field, { max = 200, min = 1, required = true, label } = {}) {
  const name = label || field;
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw new ValidationError(`${name} must be text.`, field);
  const s = v.replace(/\r\n?/g, '\n').trim();
  if (!s && !required) return '';
  if (s.length < min) throw new ValidationError(min > 1 ? `${name} needs at least ${min} characters.` : `${name} is required.`, field);
  if (s.length > max) throw new ValidationError(`${name} must be ${max} characters or fewer.`, field);
  if (CONTROL.test(s)) throw new ValidationError(`${name} contains characters that are not allowed.`, field);
  return s;
}
export function oneOf(v, allowed, field, label) {
  const list = Array.isArray(allowed) ? allowed : Object.keys(allowed);
  if (typeof v !== 'string' || !list.includes(v)) throw new ValidationError(`${label || field} must be one of: ${list.join(', ')}.`, field);
  return v;
}
/** Absolute http(s) link without embedded credentials, or null. Display code uses this before making any link. */
export function safeHttpUrl(v) {
  if (typeof v !== 'string' || !v || v.length > LIMITS.url) return null;
  let u; try { u = new URL(v.trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || !u.hostname) return null;
  return u.href;
}
export function httpUrl(v, field, { required = false, label } = {}) {
  if ((v === undefined || v === null || v === '') && !required) return '';
  if (typeof v !== 'string') throw new ValidationError(`${label || field} must be a link.`, field);
  const s = v.trim();
  if (!s && !required) return '';
  const href = safeHttpUrl(s);
  if (!href) throw new ValidationError(`${label || field} must be a full http:// or https:// link.`, field);
  return href;
}
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isoDate(v, field) {
  const m = typeof v === 'string' && DATE_RE.exec(v);
  if (!m) throw new ValidationError(`${field} must be a date like 2026-10-12.`, field);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new ValidationError(`${field} is not a real date.`, field);
  if (+m[1] < 2000 || +m[1] > 2100) throw new ValidationError(`${field} is out of range.`, field);
  return v;
}
export function finiteNumber(v, field, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new ValidationError(`${field} must be a number.`, field);
  if (integer && !Number.isInteger(n)) throw new ValidationError(`${field} must be a whole number.`, field);
  if (n < min || n > max) throw new ValidationError(`${field} must be between ${min} and ${max}.`, field);
  return n;
}
export const ID_RE = /^(task|lesson|test|evt|rev|rep)_[a-z0-9]{8,32}$/;
export function idOf(v, field, prefix) {
  if (typeof v !== 'string' || !ID_RE.test(v) || (prefix && !v.startsWith(prefix + '_'))) throw new ValidationError(`${field} is not a valid id.`, field);
  return v;
}
export function botIdOf(v, field = 'bot') {
  if (typeof v !== 'string' || !BOT_ID_RE.test(v)) throw new ValidationError(`${field === 'bot' ? 'Bot' : field} is not a valid bot.`, field);
  return v;
}
/** Capabilities from an array, or from text separated by commas or new lines. Trimmed, de-duplicated. */
export function capabilityList(v, field = 'capabilities') {
  if (v === undefined || v === null || v === '') return [];
  const raw = typeof v === 'string' ? v.split(/[,\n]/) : v;
  if (!Array.isArray(raw)) throw new ValidationError('Capabilities must be a list.', field);
  const out = [], seen = new Set();
  for (const c of raw) {
    const s = text(c, field, { max: LIMITS.capability, required: false, label: 'Each capability' });
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase()); out.push(s);
  }
  if (out.length > LIMITS.capabilities) throw new ValidationError(`List ${LIMITS.capabilities} capabilities or fewer.`, field);
  return out;
}
/** The editable part of a bot's configuration. Connection status is never accepted from input. */
export function botInput(b) {
  const v = {
    name: text(b.name, 'name', { max: LIMITS.botName, label: 'Name' }),
    role: text(b.role, 'role', { max: LIMITS.botRole, label: 'Role' }),
    focus: text(b.focus, 'focus', { max: LIMITS.botFocus, required: false, label: 'Description' }),
    style: oneOf(b.style, STYLE_IDS, 'style', 'Character style'),
    capabilities: capabilityList(b.capabilities)
  };
  if (b.prompt !== undefined) v.prompt = text(b.prompt, 'prompt', { max: LIMITS.prompt, required: false, label: 'Prompt' });
  if (b.design_guidelines !== undefined) v.design_guidelines = text(b.design_guidelines, 'design_guidelines', { max: LIMITS.design, required: false, label: 'Design guidelines' });
  return v;
}
export function booleanInput(v, field = 'enabled') {
  if (typeof v !== 'boolean') throw new ValidationError(`${field} must be true or false.`, field);
  return v;
}
export const SKILL_ID_RE = /^skill_[a-z0-9]{8,32}$/;
export function skillInput(b) {
  return {
    name: text(b.name, 'name', { max: LIMITS.skillName, label: 'Skill name' }),
    trigger: text(b.trigger, 'trigger', { max: LIMITS.skillTrigger, label: 'When to use' }),
    instructions: text(b.instructions, 'instructions', { max: LIMITS.skillInstructions, label: 'Instructions' }),
    reference_url: httpUrl(b.reference_url, 'reference_url', { label: 'Reference link' })
  };
}

// ---- source review for skills adapted from an outside catalog (Team Knowledge imports use `origin` instead) ----
// The owner records what was reviewed. Nothing here fetches the source or installs a package. A skill with a
// source review can be on only when the review says it is ready for the text-only runtime.
export const SKILL_COMPAT = { unreviewed: 'Not reviewed', ready: 'Ready for text-only use', needs_tools: 'Needs tools', incompatible: 'Not compatible' };
export const SKILL_ADAPTATION = { instructions: 'Instructions only', package: 'Relies on scripts or supporting files' };
export const SOURCE_LIMITS = { revision: 80, license: 80, files: 50, file: 200, tools: 12, tool: 80, test: 1000 };
/** A commit hash (7–40 hex) or a release tag such as v1.2.0. Branch names like main can change, so they are not exact. */
export const EXACT_REVISION_RE = /^(?:[0-9a-f]{7,40}|v?\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?)$/i;
function lineList(v, field, { max, each, label }) {
  if (v === undefined || v === null || v === '') return [];
  const raw = typeof v === 'string' ? v.split('\n') : v;
  if (!Array.isArray(raw)) throw new ValidationError(`${label} must be a list.`, field);
  const out = [], seen = new Set();
  for (const x of raw) {
    const s = text(x, field, { max: each, required: false, label: `Each line of ${label.toLowerCase()}` });
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase()); out.push(s);
  }
  if (out.length > max) throw new ValidationError(`List ${max} or fewer ${label.toLowerCase()}.`, field);
  return out;
}
export function skillSourceInput(b) {
  const L = SOURCE_LIMITS;
  const v = {
    url: httpUrl(b.url, 'url', { required: true, label: 'Source link' }),
    revision: text(b.revision, 'revision', { max: L.revision, required: false, label: 'Revision' }),
    license: text(b.license, 'license', { max: L.license, required: false, label: 'License' }),
    files: lineList(b.files, 'files', { max: L.files, each: L.file, label: 'Files' }),
    required_tools: lineList(b.required_tools, 'required_tools', { max: L.tools, each: L.tool, label: 'Required tools' }),
    adaptation: oneOf(b.adaptation || 'instructions', SKILL_ADAPTATION, 'adaptation', 'What was adapted'),
    test: text(b.test, 'test', { max: L.test, required: false, label: 'Proposed test' }),
    compatibility: oneOf(b.compatibility || 'unreviewed', SKILL_COMPAT, 'compatibility', 'Review result')
  };
  if (v.compatibility === 'ready') {
    if (!EXACT_REVISION_RE.test(v.revision)) throw new ValidationError('Ready needs an exact revision: a commit hash or release tag. A branch name such as main can change.', 'revision');
    if (!v.license) throw new ValidationError('Ready needs the license you checked.', 'license');
    if (v.adaptation === 'package') throw new ValidationError('Team Bot runs instruction text only. A skill that relies on scripts or supporting files cannot be marked ready.', 'adaptation');
    if (v.required_tools.length) throw new ValidationError('Team Bot runs instruction text only and has no tools. Mark it Needs tools, or remove tools the adapted text does not use.', 'required_tools');
    if (!v.test) throw new ValidationError('Ready needs a proposed test to check the skill on a real task.', 'test');
  }
  return v;
}
/** Why a skill cannot be turned on, or null. Skills without a source review are the owner's own instructions. */
export function skillBlocker(s) {
  if (!s || !s.source || s.source.compatibility === 'ready') return null;
  return `Source review: ${SKILL_COMPAT[s.source.compatibility] || 'Not reviewed'}. Resolve it before turning this skill on.`;
}

// ---- dates and ranges ----
const DAY = 864e5;
const pad = n => String(n).padStart(2, '0');
/** YYYY-MM-DD of a Date in its local time. */
export const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/**
 * Millisecond bounds of [from, to] (inclusive local dates). tzOffset is Date#getTimezoneOffset() of the viewer,
 * so the server and the browser agree on where a day starts.
 */
export function rangeBounds(from, to, tzOffset = 0) {
  isoDate(from, 'from'); isoDate(to, 'to');
  finiteNumber(tzOffset, 'tz', { min: -900, max: 900, integer: true });
  const [fy, fm, fd] = from.split('-').map(Number), [ty, tm, td] = to.split('-').map(Number);
  const start = Date.UTC(fy, fm - 1, fd) + tzOffset * 60000;
  const end = Date.UTC(ty, tm - 1, td) + DAY + tzOffset * 60000;
  if (end <= start) throw new ValidationError('The end date must be on or after the start date.', 'to');
  if (end - start > 367 * DAY) throw new ValidationError('Pick a range of one year or less.', 'to');
  return { start, end };
}
/** Tasks are counted in a period by when they were created (assigned). */
export const inRange = (t, start, end) => { const c = Date.parse(t.created_at); return Number.isFinite(c) && c >= start && c < end; };
export const tasksInRange = (tasks, start, end) => tasks.filter(t => inRange(t, start, end));
/** Monday–Sunday weeks, newest first, in the viewer's local time. */
export function weekOptions(now = new Date(), count = 12) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const out = [];
  for (let i = 0; i < count; i++) {
    const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7 * i), e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
    out.push({ from: localDate(s), to: localDate(e), label: rangeLabel(localDate(s), localDate(e)), current: i === 0 });
  }
  return out;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function rangeLabel(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number), [ty, tm, td] = to.split('-').map(Number);
  if (fy === ty && fm === tm) return `${fd}–${td} ${MON[fm - 1]} ${fy}`;
  if (fy === ty) return `${fd} ${MON[fm - 1]} – ${td} ${MON[tm - 1]} ${fy}`;
  return `${fd} ${MON[fm - 1]} ${fy} – ${td} ${MON[tm - 1]} ${ty}`;
}

// ---- tasks ----
export const taskKey = t => 'TASK-' + String(t.number || 0).padStart(3, '0');
export const reviewsOf = t => [...(t.reviews || [])].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
export const firstReview = t => reviewsOf(t)[0] || null;
/** Reviewed = at least one recorded review outcome (passed or changes requested). Pending does not count. */
export const isReviewed = t => (t.reviews || []).length > 0;
export const isOpen = t => OPEN_EXEC.includes(t.execution);
/** Completed duration, only when a real start and finish were recorded in order. */
export function durationMs(t) {
  if (t.execution !== 'completed' || !t.started_at || !t.finished_at) return null;
  const s = Date.parse(t.started_at), f = Date.parse(t.finished_at);
  if (!Number.isFinite(s) || !Number.isFinite(f) || f < s) return null;
  return f - s;
}
export function median(nums) {
  const v = nums.filter(n => typeof n === 'number' && Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Quality numbers over a set of tasks. Every rate is null (shown as an em dash) when there is nothing to divide by. */
export function performance(tasks) {
  const reviewed = tasks.filter(isReviewed);
  const firstPass = reviewed.filter(t => firstReview(t).outcome === 'passed').length;
  const rework = reviewed.filter(t => t.reviews.some(r => r.outcome === 'changes_requested')).length;
  const reworkRounds = reviewed.reduce((n, t) => n + t.reviews.filter(r => r.outcome === 'changes_requested').length, 0);
  const durations = tasks.map(durationMs).filter(v => v !== null);
  return {
    total: tasks.length,
    completed: tasks.filter(t => t.execution === 'completed').length,
    blocked: tasks.filter(t => t.execution === 'blocked').length,
    awaitingReview: tasks.filter(t => t.review === 'pending').length,
    reviewed: reviewed.length,
    firstPass,
    firstPassRate: reviewed.length ? firstPass / reviewed.length : null,
    rework,
    reworkRounds,
    timed: durations.length,
    medianMs: median(durations)
  };
}
/** One row per bot: every active bot, plus archived bots that have tasks in the set (their history stays visible). */
export function botComparison(tasks, bots) {
  const shown = [...activeBots(bots), ...archivedBots(bots).filter(b => tasks.some(t => t.bot === b.id))];
  return shown.map(b => ({ bot: b.id, name: b.name, archived: !isActive(b), ...performance(tasks.filter(t => t.bot === b.id)) }));
}

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
/** Issues named in "changes requested" reviews: by the issue label when given, else by the note itself. */
export function reviewIssues(tasks) {
  const map = new Map();
  for (const t of tasks) for (const r of t.reviews || []) {
    if (r.outcome !== 'changes_requested') continue;
    const label = (r.issue || r.note || '').trim(); const key = slug(label);
    if (!key) continue;
    const g = map.get(key) || { key, label: r.issue ? r.issue.trim() : label.slice(0, 60), tasks: new Set(), notes: [], bots: {} };
    g.tasks.add(t.id); g.notes.push(r.note || ''); g.bots[t.bot] = (g.bots[t.bot] || 0) + 1;
    map.set(key, g);
  }
  return [...map.values()]
    .map(g => ({ key: g.key, label: g.label, count: g.tasks.size, corrections: g.notes.length, tasks: [...g.tasks], notes: g.notes.filter(Boolean).slice(-3), bot: Object.entries(g.bots).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0], recurring: g.tasks.size >= 2 }))
    .sort((a, b) => b.count - a.count || b.corrections - a.corrections || a.label.localeCompare(b.label));
}

// ---- lessons ----
/**
 * Evidence for the lesson's current instruction version. Each linked trial task counts once, by its latest result:
 * a task that passed and later failed is a failure. Trials without a linked task are kept as notes but never count
 * toward the validation gate of VALIDATION_MIN_PASSES distinct tasks.
 */
export function lessonEvidence(l) {
  const tests = (l.tests || []).filter(x => (x.version || 1) === (l.version || 1)).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const linked = tests.filter(x => x.task), latestByTask = new Map();
  for (const x of linked) latestByTask.set(x.task, x); // sorted by time, so the last write per task wins
  let passes = 0, fails = 0;
  for (const x of latestByTask.values()) {
    if (x.result === 'pass' && String(x.evidence || '').trim()) passes++;
    else if (x.result === 'fail') fails++;
  }
  const latest = linked[linked.length - 1] || null;
  const needed = Math.max(0, VALIDATION_MIN_PASSES - passes);
  return {
    tests: tests.length, tasks: latestByTask.size, unlinked: tests.length - linked.length,
    passes, fails, needed, latest, canValidate: needed === 0 && !!latest && latest.result === 'pass'
  };
}
export function lessonTransition(l, to) {
  if (!LESSON[to]) return { ok: false, reason: 'Unknown status.' };
  if (l.status === to) return { ok: false, reason: `Already ${LESSON[to]}.` };
  if (!(LESSON_NEXT[l.status] || []).includes(to)) return { ok: false, reason: `A ${LESSON[l.status]} lesson cannot move to ${LESSON[to]}.` };
  if (to === 'validated') {
    const e = lessonEvidence(l);
    if (e.needed) return { ok: false, reason: `Validation needs ${VALIDATION_MIN_PASSES} different trial tasks whose latest result is a pass with evidence, on the current instruction; ${e.passes} recorded.` };
    if (!e.canValidate) return { ok: false, reason: 'The most recent linked trial failed. Record a passing trial before validating.' };
  }
  return { ok: true };
}

// ---- bots and the team ----
const BUSY = ['blocked', 'in_progress', 'waiting', 'queued'];
const BUSY_STATUS = { blocked: 'blocked', in_progress: 'working', waiting: 'waiting', queued: 'queued' };
const ts = t => Date.parse(t.updated_at || t.created_at) || 0;
/** A bot's status comes only from recorded task state. With nothing assigned it has no assignment, never "working". */
export function botStatus(tasks, botId, bot = null) {
  if (bot && !isEnabled(bot)) return { status: 'off', task: null, open: tasks.filter(t => t.bot === botId && isOpen(t)).length };
  const open = tasks.filter(t => t.bot === botId && isOpen(t));
  for (const st of BUSY) {
    const hit = open.filter(t => t.execution === st).sort((a, b) => ts(b) - ts(a))[0];
    if (hit) return { status: BUSY_STATUS[st], task: hit, open: open.length };
  }
  return { status: 'idle', task: null, open: 0 };
}
/** Counts over active bots only. `connection` here is the effective status string the API returns. */
export function teamCounts(tasks, bots) {
  const active = bots.filter(isActive);
  const c = { active: active.length, connected: active.filter(b => isEnabled(b) && (b.connection === 'connected' || b.connection === 'demo')).length, working: 0, waiting: 0, blocked: 0, queued: 0, idle: 0, off: 0 };
  for (const b of active) c[botStatus(tasks, b.id, b).status]++;
  return c;
}
/** All task events, newest first, each with its task. */
export function recentEvents(tasks, { bot: botId, limit = 20 } = {}) {
  const out = [];
  for (const t of tasks) if (!botId || t.bot === botId) for (const e of t.events || []) out.push({ ...e, task: t.id, taskTitle: t.title, bot: t.bot });
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}
export function needsAttention(tasks) {
  const out = [];
  for (const t of tasks) {
    if (t.execution === 'blocked') out.push({ kind: 'blocked', task: t, text: 'Blocked' });
    else if (t.review === 'changes_requested' && t.execution !== 'cancelled') out.push({ kind: 'changes', task: t, text: 'Needs changes' });
    else if (t.review === 'pending') out.push({ kind: 'review', task: t, text: 'Waiting for review' });
  }
  const rank = { blocked: 0, changes: 1, review: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || ts(b.task) - ts(a.task));
}

// ---- improvement suggestions and reports ----
/** Next improvements, only from recorded review notes and lessons. Keys are stable so tasks are not duplicated. */
export function suggestions(tasks, lessons, bots) {
  const out = [];
  for (const i of reviewIssues(tasks)) {
    const who = botName(bots, i.bot);
    out.push({
      key: 'issue:' + i.key, kind: 'issue', bot: i.bot,
      title: `${who}: prevent "${i.label}"`,
      reason: `Based on ${i.corrections} review correction${i.corrections === 1 ? '' : 's'} across ${i.count} task${i.count === 1 ? '' : 's'}.`,
      criteria: `Add a check to ${who}'s instructions that prevents "${i.label}". Done when the next reviewed task has no "${i.label}" correction.`
    });
  }
  for (const l of lessons) {
    if (l.status === 'testing') {
      const e = lessonEvidence(l);
      if (e.needed) out.push({
        key: 'lesson-test:' + l.id, kind: 'lesson', bot: l.bot,
        title: `Trial "${l.title}" on ${e.needed} more task${e.needed === 1 ? '' : 's'}`,
        reason: `${e.passes} of ${VALIDATION_MIN_PASSES} passed trials with evidence recorded.`,
        criteria: `Follow the instruction "${l.instruction}" on a similar task and record the trial result with evidence on the lesson.`
      });
    } else if (l.status === 'proposed') {
      out.push({
        key: 'lesson:' + l.id, kind: 'lesson', bot: l.bot,
        title: `Start testing "${l.title}"`,
        reason: 'Proposed instruction has not been trialled yet.',
        criteria: `Move the lesson to Testing and run the instruction "${l.instruction}" on a similar task. Record the result with evidence.`
      });
    }
  }
  return out;
}
export const SUGGESTION_KEY_RE = /^(issue|lesson|lesson-test):[a-z0-9_-]{1,80}$/;

/** A report is derived from recorded tasks and lessons only. Bot names are copied in, so a snapshot keeps them. */
export function buildReport(tasks, lessons, { from, to, start, end }, roster) {
  const inR = tasksInRange(tasks, start, end);
  const totals = performance(inR);
  const bots = botComparison(inR, roster);
  const botName2 = id => botName(roster, id);
  const issues = reviewIssues(inR);
  const wentWell = [], attention = [];
  for (const b of bots) if (b.reviewed && b.firstPass === b.reviewed) wentWell.push(`${b.name}: ${b.reviewed} of ${b.reviewed} reviewed task${b.reviewed === 1 ? '' : 's'} passed first review.`);
  const fixed = inR.filter(t => t.reviews && t.reviews.some(r => r.outcome === 'changes_requested') && reviewsOf(t).at(-1).outcome === 'passed');
  if (fixed.length) wentWell.push(`${fixed.length} task${fixed.length === 1 ? '' : 's'} passed review after rework.`);
  if (totals.timed) wentWell.push(`${totals.timed} completed task${totals.timed === 1 ? ' has' : 's have'} a recorded start and finish.`);
  const validated = lessons.filter(l => l.status === 'validated' && l.validated_at && Date.parse(l.validated_at) >= start && Date.parse(l.validated_at) < end);
  for (const l of validated) wentWell.push(`Lesson validated: ${l.title}.`);
  for (const i of issues) attention.push(`${i.label}: ${i.count} task${i.count === 1 ? '' : 's'} needed changes (${botName2(i.bot)}).`);
  const blocked = inR.filter(t => t.execution === 'blocked');
  if (blocked.length) attention.push(`${blocked.length} task${blocked.length === 1 ? ' is' : 's are'} blocked: ${blocked.slice(0, 3).map(t => t.title).join(', ')}${blocked.length > 3 ? '…' : ''}.`);
  if (totals.awaitingReview) attention.push(`${totals.awaitingReview} task${totals.awaitingReview === 1 ? ' is' : 's are'} waiting for review.`);
  const unreviewed = inR.filter(t => t.execution === 'completed' && !isReviewed(t)).length;
  if (unreviewed) attention.push(`${unreviewed} completed task${unreviewed === 1 ? ' has' : 's have'} no recorded review and ${unreviewed === 1 ? 'is' : 'are'} excluded from quality numbers.`);
  return {
    from, to, label: rangeLabel(from, to),
    totals, bots, issues: issues.map(({ key, label, count, corrections, bot: b }) => ({ key, label, count, corrections, bot: b })),
    went_well: wentWell, attention,
    next_steps: suggestions(inR, lessons, roster).map(({ key, kind, bot: b, title, reason }) => ({ key, kind, bot: b, title, reason }))
  };
}

const mdEsc = s => String(s).replace(/([\\`*_[\]<>#|])/g, '\\$1').replace(/\n+/g, ' ');
export function reportMarkdown(r, { generatedAt, demo } = {}) {
  const t = r.totals, L = [];
  L.push(`# Team Bot report: ${mdEsc(r.label)}`, '');
  if (demo) L.push('> Demo data. These numbers come from the demo fixture, not real work.', '');
  if (generatedAt) L.push(`Generated ${mdEsc(generatedAt)}. Tasks are counted by the date they were assigned.`, '');
  L.push('## Outcomes', '', `- Tasks: ${t.total}`, `- Reviewed: ${t.reviewed}`, `- Passed first review: ${t.reviewed ? t.firstPass : '—'}`,
    `- First-pass acceptance: ${fmtPercent(t.firstPassRate)}`, `- Required rework: ${t.reviewed ? t.rework : '—'}`, `- Median completed time: ${fmtDuration(t.medianMs)}`, '');
  L.push('## By bot', '', '| Bot | Reviewed | Passed first time | Rework | Median time |', '| --- | --- | --- | --- | --- |');
  for (const b of r.bots) L.push(`| ${mdEsc(b.name)}${b.archived ? ' (archived)' : ''} | ${b.reviewed} | ${b.reviewed ? b.firstPass : '—'} | ${b.reviewed ? b.rework : '—'} | ${fmtDuration(b.medianMs)} |`);
  L.push('', '## What went well', '');
  L.push(...(r.went_well.length ? r.went_well.map(x => `- ${mdEsc(x)}`) : ['- Nothing recorded yet.']));
  L.push('', '## What needs attention', '');
  L.push(...(r.attention.length ? r.attention.map(x => `- ${mdEsc(x)}`) : ['- Nothing recorded yet.']));
  L.push('', '## Recommended next steps', '');
  L.push(...(r.next_steps.length ? r.next_steps.map(x => `- [ ] ${mdEsc(x.title)} (${mdEsc(x.reason)})`) : ['- No suggestions: no review corrections or open lessons recorded.']));
  return L.join('\n') + '\n';
}

// ---- formatting ----
export const DASH = '—';
export function fmtDuration(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return DASH;
  const min = Math.round(ms / 60000);
  if (min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d} d ${hh} h` : `${d} d`;
}
export const fmtPercent = r => (r === null || r === undefined || !Number.isFinite(r) ? DASH : `${Math.round(r * 100)}%`);
export function fmtAgo(iso, now = Date.now()) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return DASH;
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24); return `${d} day${d === 1 ? '' : 's'} ago`;
}
export function fmtDate(iso, withTime = false) {
  const t = Date.parse(iso); if (!Number.isFinite(t)) return DASH;
  const d = new Date(t);
  const day = `${MON[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  if (!withTime) return day;
  const h = d.getHours(), mm = pad(d.getMinutes());
  return `${MON[d.getMonth()]} ${d.getDate()}, ${(h % 12) || 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}
export function initials(nameOrEmail) {
  const local = String(nameOrEmail || '').split('@')[0];
  const parts = local.split(/[^A-Za-z]+/).filter(Boolean);
  const s = parts.length >= 2 ? parts[0][0] + parts[1][0] : (parts[0] || '').slice(0, 2);
  return (s || 'ME').toUpperCase();
}
