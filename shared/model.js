// Shared model: pure functions over the HQ store. Used by the server (rules)
// and by the browser (display). The 3D office and panels only ever read these.

export const HQ_STATES = ['todo', 'in_progress', 'in_review', 'changes_requested', 'blocked', 'approved', 'cancelled'];
export const STATE_LBL = { todo: 'Up next', in_progress: 'Working', in_review: 'In review', changes_requested: 'Changes requested', blocked: 'Blocked', approved: 'Done', cancelled: 'Cancelled' };
export const STATUS_LBL = { working: 'Working', online: 'Online', meeting: 'Meeting', break: 'Break', away: 'Away', offline: 'Offline' };
export const STATUS_HEX = { working: '#2E9E5B', online: '#3F7CDB', meeting: '#7B5EA7', break: '#2A9D8F', away: '#A9B1BC', offline: '#5B6372' };
export const PRIO = { 1: 'Urgent', 2: 'High', 3: 'Normal', 4: 'Low' };
const HOUR = 3600000;

/** Guess an HQ state from a ClickUp status name + type. Admin can override in Automations. */
export function autoMapStatus(name, type) {
  const n = String(name || '').toLowerCase();
  if (type === 'closed' || type === 'done') return /cancel|won.?t|drop/.test(n) ? 'cancelled' : 'approved';
  if (/cancel|won.?t do|dropped/.test(n)) return 'cancelled';
  if (/review|approv|qa check|sign.?off/.test(n)) return 'in_review';
  if (/change|revis|rework|fix/.test(n)) return 'changes_requested';
  if (/block|hold|waiting|stuck/.test(n)) return 'blocked';
  if (/complete|done|closed|shipped|approved/.test(n)) return 'approved';
  if (type === 'open' || /to ?do|backlog|open|queue|not started/.test(n)) return 'todo';
  return 'in_progress';
}

export const owner = db => db.workers.find(w => w.is_owner) || null;
export const worker = (db, id) => db.workers.find(w => w.id === id) || null;
export const task = (db, id) => db.tasks.find(t => t.id === id) || null;
export const list = (db, id) => db.lists.find(l => l.id === id) || { id, name: 'Unknown list', statuses: [] };

export function hqState(db, t) {
  const m = db.map.find(r => r.list_id === t.list_id && r.clickup_status.toLowerCase() === String(t.clickup_status).toLowerCase());
  return m ? m.hq_state : autoMapStatus(t.clickup_status, t.clickup_status_type);
}
export function cuStatusFor(db, listId, state) {
  const rows = db.map.filter(r => r.list_id === listId && r.hq_state === state);
  const d = rows.find(r => r.is_default) || rows[0];
  return d ? d.clickup_status : null;
}
export const tasksOf = (db, id) => db.tasks.filter(t => t.assignee === id);
export const isMeetingStatus = w => /meeting|call|zoom|huddle|interview/i.test(w.slack_status_text || '') || [':calendar:', ':spiral_calendar_pad:', ':headphones:', ':date:'].includes(w.slack_status_emoji);

export function displayStatus(db, w, now = Date.now()) {
  if (w.manual_status === 'offline') return 'offline';
  if (w.manual_status === 'meeting') return 'meeting';
  if (w.manual_status === 'break') return 'break';
  if (isMeetingStatus(w)) return 'meeting';
  if (w.slack_presence === 'away' && now - (w.last_seen_at || 0) > 4 * HOUR) return 'offline';
  if (w.slack_presence === 'away') return 'away';
  if (tasksOf(db, w.id).some(t => ['in_progress', 'changes_requested'].includes(hqState(db, t)))) return 'working';
  return 'online';
}
const CUR = { in_progress: 0, changes_requested: 0, in_review: 1, blocked: 2 };
const byDue = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999');
export function currentTask(db, id) {
  return tasksOf(db, id).filter(t => hqState(db, t) in CUR)
    .sort((a, b) => CUR[hqState(db, a)] - CUR[hqState(db, b)] || byDue(a, b) || a.priority - b.priority || b.updated - a.updated)[0] || null;
}
export function nextTask(db, id) {
  return tasksOf(db, id).filter(t => hqState(db, t) === 'todo').sort((a, b) => byDue(a, b) || a.priority - b.priority)[0] || null;
}
export const openNeeds = db => db.needs.filter(n => n.state !== 'resolved');
export const unreadNeeds = db => db.needs.filter(n => n.state === 'open');
export const attention = (db, id) => openNeeds(db).filter(n => n.from === id).length;
export function lastActivity(db, id) { for (let i = db.activity.length - 1; i >= 0; i--) if (db.activity[i].worker === id) return db.activity[i]; return null; }
export const openCount = (db, id) => tasksOf(db, id).filter(t => !['approved', 'cancelled'].includes(hqState(db, t))).length;

/** Open/resolve Approval + Decision items from task state. Idempotent. */
export function reconcileNeeds(db, now = Date.now()) {
  const own = owner(db);
  for (const t of db.tasks) {
    const st = hqState(db, t);
    const from = worker(db, t.assignee);
    const want = {
      approval: st === 'in_review' && !!from && !from.is_owner,
      decision: st === 'blocked' && ((t.tags || []).includes('needs-owner') || (own && t.assignee === own.id))
    };
    for (const type of ['approval', 'decision']) {
      const src = `task:${t.id}:${type}`;
      const ex = db.needs.find(n => n.source === src && n.state !== 'resolved');
      if (want[type] && !ex) {
        db.needs.push({
          id: 'n' + now.toString(36) + Math.random().toString(36).slice(2, 6), type, source: src, task: t.id, from: t.assignee,
          title: t.name, body: type === 'approval' ? `${from ? from.name : 'Someone'} needs approval` : `${from ? from.name : 'Someone'} is blocked and needs your decision`,
          priority: t.priority, state: 'open', created: now
        });
      } else if (!want[type] && ex) { ex.state = 'resolved'; ex.resolved = now; }
    }
  }
  // tasks that disappeared or finished resolve anything tied to them
  for (const n of db.needs) {
    if (n.state === 'resolved' || !n.task) continue;
    const t = task(db, n.task);
    if (!t || ['approved', 'cancelled'].includes(hqState(db, t))) { n.state = 'resolved'; n.resolved = now; }
  }
  db.needs = db.needs.filter(n => n.state !== 'resolved' || now - n.resolved < 6 * HOUR).slice(-200);
}
