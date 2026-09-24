// Live sync: Slack = people/presence, ClickUp = tasks/workflow. Builds workers + tasks, then applyChange.
import * as slack from './slack.js';
import * as cu from './clickup.js';
import { db, hq, applyChange, rebuildMap, logEvent, logError, persist } from './store.js';
import { autoMapStatus, owner as getOwner, worker, task as getTask } from '../shared/model.js';

const PALETTE = ['#3F7CAC', '#C0504D', '#5E8C3F', '#E09A2E', '#7B5EA7', '#2A9D8F', '#D1495B', '#4D5B6B', '#8C5A3C', '#3D405B', '#B5651D', '#1B998B'];
const colorFor = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PALETTE[h % PALETTE.length]; };
const listCache = new Map(); // listId -> {data, at}

let cuMembers = [], slackPeople = [], rawTasks = [];

export async function fullSync() {
  const started = Date.now();
  db.mode = { slack: slack.slackEnabled() ? 'live' : 'off', clickup: cu.clickupEnabled() ? 'live' : 'off', demo: false };
  try {
    if (slack.slackEnabled()) {
      if (!db.meta.slack_team_id) db.meta.slack_team_id = await slack.teamId();
      slackPeople = await slack.listPeople();
    }
    if (cu.clickupEnabled()) {
      const ws = await cu.workspace();
      db.meta.clickup_team_id = ws.id; cuMembers = ws.members;
      rawTasks = await cu.allTasks(ws.id);
      await refreshLists(rawTasks);
    }
  } catch (e) { logError('sync', e); }
  const first = !db.meta.last_sync;
  db.meta.initialSync = first;
  applyChange(() => { buildWorkers(); buildTasks(); });
  db.meta.initialSync = false;
  db.meta.last_sync = Date.now();
  if (first) { logEvent('hq', 'initial_sync', `${db.workers.length} people, ${db.tasks.length} tasks in ${Date.now() - started} ms`); await pollPresence(); }
}

async function refreshLists(tasks) {
  const ids = [...new Set(tasks.map(t => t.list && String(t.list.id)).filter(Boolean))];
  if (process.env.CLICKUP_DEFAULT_LIST_ID && !ids.includes(process.env.CLICKUP_DEFAULT_LIST_ID)) ids.push(process.env.CLICKUP_DEFAULT_LIST_ID);
  const lists = [];
  for (const id of ids) {
    let c = listCache.get(id);
    if (!c || Date.now() - c.at > 10 * 60000) {
      try { c = { data: await cu.listStatuses(id), at: Date.now() }; listCache.set(id, c); }
      catch (e) { // fall back to statuses seen on tasks
        const seen = tasks.filter(t => String(t.list && t.list.id) === id).map(t => t.status);
        const uniq = [...new Map(seen.map(s => [s.status, s])).values()];
        c = { data: { id, name: (tasks.find(t => String(t.list && t.list.id) === id).list || {}).name || id, statuses: uniq.map(s => ({ status: s.status, type: s.type })) }, at: Date.now() };
        logError('list ' + id, e);
      }
    }
    lists.push({ ...c.data, statuses: c.data.statuses.map(s => ({ ...s, auto: autoMapStatus(s.status, s.type) })) });
  }
  db.lists = lists; rebuildMap();
}

function buildWorkers() {
  const ownerEmail = (process.env.OWNER_EMAIL || '').toLowerCase();
  const prev = new Map(db.workers.map(w => [w.id, w]));
  const out = [];
  const cuByEmail = new Map(cuMembers.filter(m => m.email).map(m => [m.email, m]));
  const cuById = new Map(cuMembers.map(m => [m.clickup_user_id, m]));
  const usedCu = new Set();
  const onlyMatched = cu.clickupEnabled() && process.env.SLACK_ONLY_MATCHED !== 'false';
  for (const p of slackPeople) {
    const manual = hq.matches[p.slack_user_id];
    const m = (manual && cuById.get(manual)) || (p.email && cuByEmail.get(p.email));
    if (onlyMatched && !m && p.email !== ownerEmail) continue;
    if (m) usedCu.add(m.clickup_user_id);
    const id = 'sl_' + p.slack_user_id, old = prev.get(id) || {};
    out.push({
      id, name: p.name, role: p.role || '', department: departmentFor(p), color: old.color || colorFor(p.slack_user_id), avatar_url: p.avatar_url || (m && m.avatar_url) || '',
      email: p.email, is_owner: !!ownerEmail && p.email === ownerEmail, slack_user_id: p.slack_user_id, clickup_user_id: m ? m.clickup_user_id : null,
      match: m ? (manual ? 'manual' : 'email') : 'slack only', slack_presence: old.slack_presence || 'active', slack_status_text: p.slack_status_text, slack_status_emoji: p.slack_status_emoji,
      manual_status: hq.manual[id] || 'none', last_seen_at: old.last_seen_at || Date.now()
    });
  }
  for (const m of cuMembers) {
    if (usedCu.has(m.clickup_user_id)) continue;
    const id = 'cu_' + m.clickup_user_id, old = prev.get(id) || {};
    out.push({ id, name: m.name, role: '', department: '', color: m.color || colorFor(m.clickup_user_id), avatar_url: m.avatar_url, email: m.email, is_owner: !!ownerEmail && m.email === ownerEmail,
      slack_user_id: null, clickup_user_id: m.clickup_user_id, match: 'clickup only', slack_presence: slack.slackEnabled() ? 'away' : 'active', slack_status_text: '', slack_status_emoji: '',
      manual_status: hq.manual[id] || 'none', last_seen_at: old.last_seen_at || (slack.slackEnabled() ? 0 : Date.now()) });
  }
  if (out.length && !out.some(w => w.is_owner)) out[0].is_owner = true; // set OWNER_EMAIL to pick yourself
  out.sort((a, b) => (b.is_owner - a.is_owner) || a.name.localeCompare(b.name));
  db.workers = out;
}
function departmentFor(p) {
  const map = (process.env.DEPARTMENTS || '').split(';').map(s => s.split('=')).filter(x => x.length === 2); // "a@x.com=Sales;b@x.com=Design"
  const hit = map.find(([k]) => k.trim().toLowerCase() === p.email);
  return hit ? hit[1].trim() : '';
}

function buildTasks() {
  const byCu = new Map(db.workers.filter(w => w.clickup_user_id).map(w => [w.clickup_user_id, w.id]));
  db.tasks = rawTasks.map(cu.toRow).map(r => ({ ...r, assignee: r.clickup_assignee_ids.map(i => byCu.get(i)).find(Boolean) || null }));
}

/** Slack does not push presence to apps; poll matched people. */
export async function pollPresence() {
  if (!slack.slackEnabled()) return;
  const changes = [];
  for (const w of db.workers.filter(w => w.slack_user_id)) {
    try { const p = await slack.presence(w.slack_user_id); if (p !== w.slack_presence) changes.push([w.id, p]); if (p === 'active') w.last_seen_at = Date.now(); }
    catch (e) { logError('presence', e); break; }
    await new Promise(r => setTimeout(r, 400));
  }
  if (changes.length) applyChange(() => { for (const [id, p] of changes) { const w = worker(db, id); if (w) { w.slack_presence = p; logEvent('slack', 'users.getPresence', `${w.name} is ${p}`); } } });
}

// ---- webhook ----
export async function ensureWebhook(publicUrl) {
  if (!cu.clickupEnabled() || !publicUrl || !db.meta.clickup_team_id) return;
  const endpoint = publicUrl.replace(/\/$/, '') + '/webhooks/clickup';
  if (db.meta.webhook && db.meta.webhook.endpoint === endpoint && db.meta.webhook.secret) return;
  try {
    const { webhooks = [] } = await cu.listWebhooks(db.meta.clickup_team_id);
    for (const h of webhooks.filter(h => h.endpoint === endpoint)) await cu.deleteWebhook(h.id);
    const r = await cu.createWebhook(db.meta.clickup_team_id, endpoint);
    db.meta.webhook = { id: r.id, endpoint, secret: r.webhook && r.webhook.secret };
    logEvent('hq', 'webhook_registered', endpoint); persist();
  } catch (e) { logError('webhook register', e); }
}

export async function onWebhook(body) {
  const { event, task_id: tid } = body;
  logEvent('clickup', event, tid || '');
  if (!tid) return;
  if (event === 'taskDeleted') { rawTasks = rawTasks.filter(t => t.id !== tid); applyChange(buildTasks); return; }
  try {
    const t = await cu.getTask(tid);
    const i = rawTasks.findIndex(x => x.id === tid);
    if (i >= 0) rawTasks[i] = t; else rawTasks.push(t);
    if (t.list && !db.lists.some(l => l.id === String(t.list.id))) await refreshLists(rawTasks);
    applyChange(buildTasks);
    if (event === 'taskCommentPosted') await checkQuestion(tid, body);
  } catch (e) { logError('webhook ' + event, e); }
}

/** A comment from a teammate that mentions the owner and asks something becomes a Needs You question. */
async function checkQuestion(tid, body) {
  const own = getOwner(db); if (!own) return;
  const item = (body.history_items || [])[0] || {};
  let text = item.comment && (item.comment.text_content || item.comment.comment_text);
  let authorCu = item.user && String(item.user.id);
  if (!text) { try { const { comments = [] } = await cu.getComments(tid); const c = comments.sort((a, b) => Number(b.date) - Number(a.date))[0]; if (c) { text = c.comment_text; authorCu = String(c.user && c.user.id); } } catch { return; } }
  if (!text || authorCu === own.clickup_user_id) return;
  const first = own.name.split(/\s+/)[0].toLowerCase();
  if (!(text.includes('?') && text.toLowerCase().includes('@' + first))) return;
  const author = db.workers.find(w => w.clickup_user_id === authorCu); const t = getTask(db, 'cu_' + tid);
  applyChange(() => db.needs.push({ id: 'n' + Date.now().toString(36), type: 'question', source: 'comment:' + (item.id || Date.now()), task: t ? t.id : null, from: author ? author.id : null,
    title: 'Question on ' + (t ? t.name.slice(0, 40) : 'a task'), body: text.slice(0, 400), priority: t ? t.priority : 3, state: 'open', created: Date.now() }));
}

export { rawTasks };
