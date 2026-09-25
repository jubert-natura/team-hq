// In-memory store + a small JSON file for data HQ owns
// (needs, status-map overrides, manual statuses, activity, webhook secret).
// Workers and tasks are rebuilt from Slack/ClickUp on every sync.
import fs from 'node:fs';
import path from 'node:path';
import { displayStatus, hqState, reconcileNeeds, worker, owner, STATE_LBL } from '../shared/model.js';
import { user, knownEmails } from './users.js';

// Live, demo and tests each get their own file so fake data never mixes with real data.
const file = () => path.resolve(process.env.HQ_STORE
  || (process.env.SLACK_BOT_TOKEN || process.env.CLICKUP_API_TOKEN ? 'data/store.json' : 'data/demo.json'));

export const db = {
  workers: [], tasks: [], lists: [], map: [], needs: [], activity: [], events: [],
  meta: { slack_team_id: null, clickup_team_id: null, webhook: null, last_sync: null, errors: [] },
  mode: { slack: 'off', clickup: 'off', demo: false }
};
// Team-wide settings. (groups / mailDone / slackSet here are from before accounts; they move to the owner's account.)
export const hq = { overrides: {}, manual: {}, matches: {} }; // matches: slackId -> clickupId (manual links)

export function loadPersisted() {
  try {
    const s = JSON.parse(fs.readFileSync(file(), 'utf8'));
    // items from before feeds were personal have no `for`; they are rebuilt for the right person on the next sync
    db.needs = (s.needs || []).filter(n => n.for); db.activity = s.activity || []; db.events = s.events || [];
    db.meta.webhook = s.webhook || null;
    Object.assign(hq, { overrides: s.overrides || {}, manual: s.manual || {}, matches: s.matches || {}, slackSet: s.slackSet || null, mailDone: s.mailDone || {}, groups: s.groups || [] });
  } catch { /* first run */ }
}
let saveT;
export function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(),JSON.stringify({ needs: db.needs, activity: db.activity.slice(-300), events: db.events.slice(-80), webhook: db.meta.webhook, ...hq }, null, 1));
  }, 300);
}

export function logActivity(workerId, kind, text, taskId) {
  db.activity.push({ ts: Date.now(), worker: workerId, kind, text, task: taskId || null });
  if (db.activity.length > 300) db.activity.splice(0, db.activity.length - 300);
}
export function logEvent(src, type, summary) {
  db.events.push({ ts: Date.now(), src, type, summary: String(summary).slice(0, 140) });
  if (db.events.length > 80) db.events.splice(0, db.events.length - 80);
}
export function logError(where, err) {
  const msg = `${where}: ${err && err.message ? err.message : err}`;
  console.error(msg);
  db.meta.errors.push({ ts: Date.now(), msg });
  if (db.meta.errors.length > 20) db.meta.errors.shift();
}

/** Rebuild the status map: auto-mapped from each list's statuses, then admin overrides. */
export function rebuildMap() {
  const map = [];
  for (const l of db.lists) {
    const seen = new Set();
    for (const s of l.statuses) {
      const key = `${l.id}|${s.status.toLowerCase()}`;
      const hq_state = hq.overrides[key] || s.auto;
      map.push({ list_id: l.id, clickup_status: s.status, hq_state, is_default: false });
    }
    // default per state = first status (in list order) mapped to it
    for (const r of map.filter(r => r.list_id === l.id)) if (!seen.has(r.hq_state)) { r.is_default = true; seen.add(r.hq_state); }
  }
  db.map = map;
}

const short = (s, n = 46) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const ACT = { in_progress: ['task_started', 'Started'], in_review: ['submitted_for_review', 'Submitted for review:'], changes_requested: ['changes_requested', 'Got change requests on'], blocked: ['blocked', 'Blocked on'], approved: ['approved', 'Finished'], todo: ['task_assigned', 'Queued'], cancelled: ['cancelled', 'Cancelled'] };

/**
 * Apply a change to the store and derive activity + Needs You from the diff.
 * `mutate` changes db.workers / db.tasks; everything else follows.
 */
export function applyChange(mutate) {
  const beforeStatus = Object.fromEntries(db.workers.map(w => [w.id, displayStatus(db, w)]));
  const beforeTask = Object.fromEntries(db.tasks.map(t => [t.id, { st: hqState(db, t), who: t.assignee }]));
  mutate();
  for (const w of db.workers) w.manual_status = hq.manual[w.id] || 'none';
  for (const t of db.tasks) {
    const b = beforeTask[t.id], st = hqState(db, t);
    if (!b) { if (!db.meta.initialSync && t.assignee) logActivity(t.assignee, 'task_assigned', `Was assigned “${short(t.name)}”`, t.id); continue; }
    if (b.st !== st && t.assignee) { const a = ACT[st]; if (a) logActivity(t.assignee, a[0], `${a[1]} “${short(t.name)}”`, t.id); }
    if (b.who !== t.assignee && t.assignee) { const from = worker(db, b.who); logActivity(t.assignee, 'reassigned', `Took over “${short(t.name)}”${from ? ' from ' + from.name : ''}`, t.id); }
  }
  for (const w of db.workers) {
    const a = beforeStatus[w.id], b = displayStatus(db, w);
    if (!a || a === b) continue;
    const txt = { break: 'Went on break', meeting: 'Joined a meeting', offline: 'Went offline', away: 'Stepped away', focus: 'Went into focus mode' }[b]
      || (a === 'offline' ? 'Came online' : a === 'break' ? 'Back from break' : a === 'meeting' ? 'Left the meeting' : a === 'focus' ? 'Out of focus mode' : null);
    if (txt) logActivity(w.id, b === 'offline' ? 'went_offline' : b === 'break' ? 'went_on_break' : 'returned', txt);
  }
  reconcileNeeds(db, feedIds());
  persist();
  broadcast();
}

// ---- who is looking ----
// Without Google sign-in (local, tests, demo) everyone is the owner. With it, each browser belongs to one person.
export const ownerKey = () => String(process.env.OWNER_EMAIL || 'owner@local').toLowerCase();
export const isAdmin = email => !email || String(email).toLowerCase() === ownerKey();
/** The worker a signed-in email belongs to (the owner's worker when nobody is signed in). */
export const workerOf = email => email ? db.workers.find(w => w.email && w.email === String(email).toLowerCase()) || null : owner(db);
/** Everyone who gets a Needs You feed: the owner, plus anyone who has signed in. */
function feedIds() {
  const ids = new Set(); const own = owner(db); if (own) ids.add(own.id);
  for (const e of knownEmails()) { const w = workerOf(e); if (w) ids.add(w.id); }
  return [...ids];
}

// ---- live updates to browsers (Server-Sent Events): each one gets its own person's view ----
const clients = new Map(); // res -> email (or null)
export function addClient(res, email) { clients.set(res, email || null); res.on('close', () => clients.delete(res)); }
let bT;
export function broadcast() {
  clearTimeout(bT);
  bT = setTimeout(() => {
    const cache = new Map();
    for (const [c, email] of clients) {
      if (!cache.has(email)) cache.set(email, `event: state\ndata: ${JSON.stringify(publicState(email))}\n\n`);
      c.write(cache.get(email));
    }
  }, 60);
}
/** The state one person sees: "you" is them, and Needs You, groups and saved setup are theirs. */
export function publicState(email) {
  const own = owner(db), me = workerOf(email), meId = me && me.id, key = email || ownerKey(), u = user(key) || {};
  return {
    workers: db.workers.map(w => (w.is_owner === (w.id === meId) ? w : { ...w, is_owner: w.id === meId })),
    tasks: db.tasks, lists: db.lists.map(l => ({ id: l.id, name: l.name, statuses: l.statuses.map(s => ({ status: s.status, color: s.color || '', auto: s.auto })) })), map: db.map,
    needs: meId ? db.needs.filter(n => (n.for || (own && own.id)) === meId) : [],
    activity: db.activity.slice(-150), events: isAdmin(email) ? db.events : [], mode: db.mode,
    meta: { slack_team_id: db.meta.slack_team_id, clickup_team_id: db.meta.clickup_team_id, webhook: db.meta.webhook ? { endpoint: db.meta.webhook.endpoint, ok: !!db.meta.webhook.secret } : null, last_sync: db.meta.last_sync, slack_scopes: db.meta.slack_scopes || null, errors: isAdmin(email) ? db.meta.errors.slice(-5) : [] },
    groups: u.groups || [], prefs: u.prefs || {},
    me: { email: email || null, signedIn: !!email, admin: isAdmin(email), name: (me && me.name) || u.name || '', inSlack: !!me, slackUser: isAdmin(email) && !!process.env.SLACK_USER_TOKEN },
    stateLabels: STATE_LBL
  };
}
