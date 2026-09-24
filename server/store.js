// In-memory store + a small JSON file for data HQ owns
// (needs, status-map overrides, manual statuses, activity, webhook secret).
// Workers and tasks are rebuilt from Slack/ClickUp on every sync.
import fs from 'node:fs';
import path from 'node:path';
import { displayStatus, hqState, reconcileNeeds, worker, STATE_LBL } from '../shared/model.js';

const FILE = path.resolve('data/store.json');

export const db = {
  workers: [], tasks: [], lists: [], map: [], needs: [], activity: [], events: [],
  meta: { slack_team_id: null, clickup_team_id: null, webhook: null, last_sync: null, errors: [] },
  mode: { slack: 'off', clickup: 'off', demo: false }
};
export const hq = { overrides: {}, manual: {}, matches: {} }; // matches: slackId -> clickupId (manual links)

export function loadPersisted() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    db.needs = s.needs || []; db.activity = s.activity || []; db.events = s.events || [];
    db.meta.webhook = s.webhook || null;
    Object.assign(hq, { overrides: s.overrides || {}, manual: s.manual || {}, matches: s.matches || {} });
  } catch { /* first run */ }
}
let saveT;
export function persist() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ needs: db.needs, activity: db.activity.slice(-300), events: db.events.slice(-80), webhook: db.meta.webhook, ...hq }, null, 1));
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
    const txt = { break: 'Went on break', meeting: 'Joined a meeting', offline: 'Went offline', away: 'Stepped away' }[b]
      || (a === 'offline' ? 'Came online' : a === 'break' ? 'Back from break' : a === 'meeting' ? 'Left the meeting' : null);
    if (txt) logActivity(w.id, b === 'offline' ? 'went_offline' : b === 'break' ? 'went_on_break' : 'returned', txt);
  }
  reconcileNeeds(db);
  persist();
  broadcast();
}

// ---- live updates to browsers (Server-Sent Events) ----
const clients = new Set();
export function addClient(res) { clients.add(res); res.on('close', () => clients.delete(res)); }
let bT;
export function broadcast() {
  clearTimeout(bT);
  bT = setTimeout(() => { const data = `event: state\ndata: ${JSON.stringify(publicState())}\n\n`; for (const c of clients) c.write(data); }, 60);
}
export function publicState() {
  return { workers: db.workers, tasks: db.tasks, lists: db.lists.map(l => ({ id: l.id, name: l.name, statuses: l.statuses.map(s => s.status) })), map: db.map, needs: db.needs, activity: db.activity.slice(-150), events: db.events, mode: db.mode,
    meta: { slack_team_id: db.meta.slack_team_id, clickup_team_id: db.meta.clickup_team_id, webhook: db.meta.webhook ? { endpoint: db.meta.webhook.endpoint, ok: !!db.meta.webhook.secret } : null, last_sync: db.meta.last_sync, errors: db.meta.errors.slice(-5) },
    stateLabels: STATE_LBL };
}
