// ClickUp API v2 — tasks, statuses, members, comments, webhooks. Personal token (pk_...).
import crypto from 'node:crypto';
const BASE = process.env.CLICKUP_API_BASE || 'https://api.clickup.com/api/v2';
const TOKEN = () => process.env.CLICKUP_API_TOKEN;
export const clickupEnabled = () => !!TOKEN();

async function call(method, path, body, query) {
  const url = new URL(BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) (Array.isArray(v) ? v.forEach(x => url.searchParams.append(k, x)) : url.searchParams.set(k, v));
  const res = await fetch(url, { method, headers: { Authorization: TOKEN(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 429) { const reset = +(res.headers.get('x-ratelimit-reset') || 0) * 1000; await new Promise(r => setTimeout(r, Math.max(2000, reset - Date.now()))); return call(method, path, body, query); }
  const txt = await res.text(); let j; try { j = txt ? JSON.parse(txt) : {}; } catch { j = { raw: txt }; }
  if (!res.ok) throw new Error(`ClickUp ${method} ${path}: ${res.status} ${j.err || j.error || txt.slice(0, 120)}`);
  return j;
}

/** Workspace (team) + its members. Uses CLICKUP_TEAM_ID or the first workspace. */
export async function workspace() {
  const j = await call('GET', '/team');
  const want = process.env.CLICKUP_TEAM_ID;
  const t = (want ? j.teams.find(x => String(x.id) === String(want)) : j.teams[0]);
  if (!t) throw new Error('ClickUp: workspace not found — check CLICKUP_TEAM_ID');
  return {
    id: String(t.id), name: t.name,
    members: (t.members || []).map(m => m.user).filter(Boolean).map(u => ({ clickup_user_id: String(u.id), name: u.username || u.email, email: (u.email || '').toLowerCase(), avatar_url: u.profilePicture || '', color: u.color || '' }))
  };
}

const scope = () => {
  const q = {};
  if (process.env.CLICKUP_LIST_IDS) q['list_ids[]'] = process.env.CLICKUP_LIST_IDS.split(',').map(s => s.trim()).filter(Boolean);
  if (process.env.CLICKUP_SPACE_IDS) q['space_ids[]'] = process.env.CLICKUP_SPACE_IDS.split(',').map(s => s.trim()).filter(Boolean);
  return q;
};
async function pages(teamId, q) {
  const out = [];
  for (let page = 0; page < 30; page++) {
    const j = await call('GET', `/team/${teamId}/task`, null, { ...scope(), ...q, page, subtasks: true });
    out.push(...(j.tasks || []));
    if (j.last_page || (j.tasks || []).length < 100) break;
  }
  return out;
}
/** All open tasks + anything closed in the last 7 days. */
export async function allTasks(teamId) {
  const open = await pages(teamId, { include_closed: false });
  const recent = await pages(teamId, { include_closed: true, date_updated_gt: Date.now() - 7 * 864e5 });
  const byId = new Map(); for (const t of [...open, ...recent]) byId.set(t.id, t);
  return [...byId.values()];
}
export const getTask = id => call('GET', `/task/${id}`, null, { include_subtasks: false });
export async function listStatuses(listId) {
  const j = await call('GET', `/list/${listId}`);
  return { id: String(j.id), name: j.name, statuses: (j.statuses || []).sort((a, b) => a.orderindex - b.orderindex).map(s => ({ status: s.status, type: s.type, color: s.color || '' })) };
}
export const setStatus = (id, status) => call('PUT', `/task/${id}`, { status });
export const addComment = (id, text) => call('POST', `/task/${id}/comment`, { comment_text: text, notify_all: false });
export const getComments = id => call('GET', `/task/${id}/comment`);
export function createTask(listId, { name, assigneeClickupId, priority, dueMs, status, description }) {
  return call('POST', `/list/${listId}/task`, { name, description, assignees: assigneeClickupId ? [Number(assigneeClickupId)] : [], priority: priority || 3, due_date: dueMs || undefined, status: status || undefined });
}

// ---- webhooks ----
export const EVENTS = ['taskCreated', 'taskUpdated', 'taskDeleted', 'taskStatusUpdated', 'taskAssigneeUpdated', 'taskDueDateUpdated', 'taskPriorityUpdated', 'taskMoved', 'taskCommentPosted', 'taskTagUpdated'];
export const listWebhooks = teamId => call('GET', `/team/${teamId}/webhook`);
export const deleteWebhook = id => call('DELETE', `/webhook/${id}`);
export const createWebhook = (teamId, endpoint) => call('POST', `/team/${teamId}/webhook`, { endpoint, events: EVENTS });
export function verifySignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const want = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(signature))); } catch { return false; }
}

/** ClickUp task JSON -> HQ task row (assignee resolved later). */
export function toRow(t) {
  const pr = t.priority && (t.priority.id || t.priority.orderindex);
  return {
    id: 'cu_' + t.id, cu_id: t.id, name: t.name,
    clickup_assignee_ids: (t.assignees || []).map(a => String(a.id)),
    list_id: t.list ? String(t.list.id) : 'none', list_name: t.list ? t.list.name : '',
    clickup_status: t.status ? t.status.status : '', clickup_status_type: t.status ? t.status.type : '', status_color: (t.status && t.status.color) || '',
    creator_id: t.creator ? String(t.creator.id) : null, watcher_ids: (t.watchers || []).map(w => String(w.id)),
    client: (t.folder && !t.folder.hidden && t.folder.name) || (t.space && t.space.name) || '',
    priority: pr ? Number(pr) : 3, due_date: t.due_date ? new Date(Number(t.due_date)).toISOString().slice(0, 10) : '',
    tags: (t.tags || []).map(x => x.name), url: t.url || `https://app.clickup.com/t/${t.id}`,
    updated: Number(t.date_updated || Date.now())
  };
}
