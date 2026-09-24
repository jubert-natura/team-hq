// Team HQ browser app. Reads state from the server (which syncs Slack + ClickUp)
// and renders it. Every action is a POST; the server writes to ClickUp/Slack first,
// then pushes the new state back over /api/stream.
import * as M from '/shared/model.js';
const { HQ_STATES, STATE_LBL, STATUS_LBL, STATUS_HEX, PRIO } = M;

const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const now = () => Date.now();
const pick = a => a[Math.floor(Math.random() * a.length)];
const short = (s, n = 46) => (s.length > n ? s.slice(0, n - 2) + '…' : s);
const isoDay = off => { const d = new Date(); d.setDate(d.getDate() + (off || 0)); return d.toISOString().slice(0, 10); };
const colorNum = c => typeof c === 'number' ? c : parseInt(String(c || '#888888').replace('#', ''), 16);
const hexOf = c => typeof c === 'number' ? '#' + c.toString(16).padStart(6, '0') : (c || '#888888');

// ---------- state ----------
let db = { workers: [], tasks: [], lists: [], map: [], needs: [], activity: [], events: [], mode: {}, meta: {} };
const ui = (() => { try { return JSON.parse(localStorage.getItem('teamhq.ui') || '{}'); } catch { return {}; } })();
ui.view = ui.view || 'hq'; ui.tscope = ui.tscope || 'mine'; ui.tgroup = ui.tgroup || 'status'; ui.tview = ui.tview || 'list'; ui.tsort = ui.tsort || 'status';
if (ui.view === 'board') { ui.view = 'tasks'; ui.tview = 'board'; } else if (ui.view === 'activity') ui.view = 'hq'; else if (ui.view === 'clients') ui.view = 'channels'; // Board merged into Tasks, Activity removed, Clients became Channels
if (String(ui.tscope).startsWith('p:')) { ui.tperson = ui.tscope.slice(2); ui.tscope = 'all'; }
const saveUi = () => { try { localStorage.setItem('teamhq.ui', JSON.stringify(ui)); } catch { } };
const pendingTasks = new Set(), pendingNeeds = new Set();

// model shortcuts bound to the current store
const W = id => M.worker(db, id), TK = id => M.task(db, id), OWNER = () => M.owner(db);
const hqState = t => M.hqState(db, t), cuStatusFor = (l, s) => M.cuStatusFor(db, l, s);
const displayStatus = w => M.displayStatus(db, w), currentTask = id => M.currentTask(db, id), nextTask = id => M.nextTask(db, id);
const openNeeds = () => M.openNeeds(db), unreadNeeds = () => M.unreadNeeds(db), attention = id => M.attention(db, id);
const lastActivity = id => M.lastActivity(db, id), openCount = id => M.openCount(db, id);
const listName = t => t.list_name || (db.lists.find(l => l.id === t.list_id) || {}).name || '—';
const NOBODY = { id: null, name: 'Unassigned', color: '#8A94A6', role: '', department: '' };
const Wx = id => W(id) || NOBODY;

// ---------- server ----------
async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({ ok: false, error: r.statusText }));
  if (!j.ok) { toast(j.error || 'Something went wrong'); throw new Error(j.error); }
  return j;
}
function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('state', e => { db = JSON.parse(e.data); pendingTasks.clear(); pendingNeeds.clear(); banner(''); render(); });
  es.onerror = () => banner('Lost connection to the HQ server — retrying…');
}
function banner(msg) { const b = $('#banner'); b.textContent = msg; b.classList.toggle('on', !!msg); }

// ---------- formatting ----------
function ago(ts) { const s = (now() - ts) / 1000; if (s < 45) return 'just now'; if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
function dueInfo(iso) {
  if (!iso) return { txt: 'No date', late: false, bucket: 4 };
  const d = new Date(iso + 'T00:00:00'), t = new Date(isoDay(0) + 'T00:00:00'), diff = Math.round((d - t) / 864e5);
  const fmt = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  if (diff < 0) return { txt: 'Overdue · ' + fmt, late: true, bucket: 0 };
  if (diff === 0) return { txt: 'Due today', late: false, bucket: 1 };
  if (diff === 1) return { txt: 'Due tomorrow', late: false, bucket: 2 };
  return { txt: 'Due ' + fmt, late: false, bucket: diff < 7 ? 2 : 3 };
}
const DUE_B = ['Overdue', 'Today', 'This week', 'Later', 'No date'];
const avatar = w => w.avatar_url ? `<span class="av img" style="background-image:url('${esc(w.avatar_url)}')" aria-hidden="true">${esc(w.name[0])}</span>` : `<span class="av" style="background:${hexOf(w.color)}">${esc(w.name[0])}</span>`;
const bigAvatar = w => w.avatar_url ? `<span class="bigav img" style="background-image:url('${esc(w.avatar_url)}')">${esc(w.name[0])}</span>` : `<span class="bigav" style="background:${hexOf(w.color)}">${esc(w.name[0])}</span>`;
// The person's Slack status emoji (e.g. ⚙️ Deep Work), shown at the far right of their name.
const statusIcon = w => { const i = w.slack_status_icon; if (!i) return ''; const tip = esc(w.slack_status_text || ''); return `<em class="emo" title="${tip}">${i.url ? `<img src="${esc(i.url)}" alt="${tip}">` : esc(i.char)}</em>`; };
const statusPill = st => `<span class="pill"><i class="dot s-${st}"></i>${STATUS_LBL[st]}</span>`;
const prioTag = p => `<span class="prio p${p}">${PRIO[p] || 'Normal'}</span>`;
const dueTag = iso => { const d = dueInfo(iso); return `<span class="due${d.late ? ' late' : ''}">${esc(d.txt)}</span>`; };
const P = {
  hq: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z', needs: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
  team: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  tasks: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', board: 'M3 4h6v16H3zM11 4h4v10h-4zM17 4h4v13h-4z', activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  clients: 'M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18', channels: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18', groups: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z', automations: 'M13 2L3 14h9l-1 8 10-12h-9z',
  integrations: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  x: 'M18 6L6 18M6 6l12 12', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', msg: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z', ext: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3', approval: 'M9 12l2 2 4-4M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20',
  decision: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  question: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM9.5 8.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 14.5h.01',
  confirmation: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', plus: 'M12 5v14M5 12h14', email: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6', sync: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5'
};
const ic = k => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[k]}"/></svg>`;
let toastT; function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3600); }

// ---------- UI ----------
let selected = null, drawerMode = null, openForm = null, openFormKind = null, newTaskOpen = false, lastUnread = 0;

function rNav() {
  const needs = openNeeds().length, unread = unreadNeeds().length, open = db.tasks.filter(t => !['approved', 'cancelled'].includes(hqState(t))).length;
  const item = (k, label, cnt, hot, extra) => `<button class="nitem" data-nav="${k}" id="nav-${k}"${ui.view === k ? ' aria-current="page"' : ''}>${ic(k)}<span>${label}</span>${cnt != null ? `<span class="cnt${hot ? ' hot' : ''}${extra || ''}">${cnt}</span>` : ''}</button>`;
  $('#navWork').innerHTML = item('hq', 'Headquarters') + item('needs', 'Needs you', needs, needs > 0, unread ? ' unread' : '') + item('team', 'Team', db.workers.length) + item('groups', 'Groups', (db.groups || []).length || null) + item('tasks', 'Tasks', open) + item('channels', 'Channels');
  $('#navMgmt').innerHTML = item('automations', 'Automations') + item('integrations', 'Integrations');
  if (unread > lastUnread) { const el = $('#nav-needs'); if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); } }
  lastUnread = unread;
  const pill = (el, m) => { el.textContent = m === 'live' ? 'Live' : m === 'demo' ? 'Demo' : 'Not set'; el.className = m === 'live' ? 'live' : m === 'demo' ? 'demo' : ''; };
  pill($('#pill-cu'), db.mode.clickup); pill($('#pill-sl'), db.mode.slack);
}
const head = (h, p, extra) => `<header class="phead"><div><h2>${h}</h2><p>${p}</p></div><div style="display:flex;gap:8px;align-items:center">${extra || ''}<button class="xbtn" data-nav="hq" aria-label="Close">${ic('x')}</button></div></header>`;
const stateSelect = t => `<select data-state="${t.id}" aria-label="Status">${HQ_STATES.filter(s => cuStatusFor(t.list_id, s) || s === hqState(t)).map(s => `<option value="${s}"${s === hqState(t) ? ' selected' : ''}>${STATE_LBL[s]} · ${esc(s === hqState(t) ? t.clickup_status : cuStatusFor(t.list_id, s))}</option>`).join('')}</select>`;
const TYPE_LBL = { approval: 'Approval', decision: 'Decision', question: 'Question', confirmation: 'Confirmation', email: 'Email' };
const typeLabel = n => n.type !== 'email' ? TYPE_LBL[n.type] : n.kind === 'reply' ? 'Waiting on your reply' : n.starred ? 'Starred email' : 'Important email';
// an email's sender: a teammate from Slack, or an outside contact (client)
const senderOf = n => (n.from && W(n.from)) || { id: null, name: (n.sender && n.sender.name) || 'Someone', color: '#8A94A6', role: '', department: '' };

function needCard(n, compact) {
  const w = n.type === 'email' ? senderOf(n) : Wx(n.from), t = n.task ? TK(n.task) : null, f = openForm === n.id;
  let acts = '';
  if (pendingNeeds.has(n.id) || (t && pendingTasks.has(t.id))) acts = `<span class="syncing">Syncing with ClickUp…</span>`;
  else if (n.type === 'approval' && t) acts = `<button class="btn ok" data-act="approve" data-id="${n.id}">Approve</button><button class="btn" data-act="form" data-id="${n.id}" data-f="changes">Request changes</button>${compact || !t.url ? '' : `<a class="btn ghost" href="${esc(t.url)}" target="_blank" rel="noopener">${ic('ext')}Review in ClickUp</a>`}`;
  else if (n.type === 'decision' && t) acts = `<button class="btn primary" data-act="form" data-id="${n.id}" data-f="decide">Decide</button>${compact || !t.url ? '' : `<a class="btn ghost" href="${esc(t.url)}" target="_blank" rel="noopener">${ic('ext')}Open in ClickUp</a>`}`;
  else if (n.type === 'email') acts = `${n.url ? `<a class="btn primary" href="${esc(n.url)}" target="_blank" rel="noopener">${ic('ext')}${n.kind === 'reply' ? 'Reply in Gmail' : 'Open in Gmail'}</a>` : ''}<button class="btn" data-act="mailDone" data-id="${n.id}">Done</button>`;
  else if (n.type === 'question') acts = `<button class="btn primary" data-act="form" data-id="${n.id}" data-f="reply">Reply</button>`;
  else acts = `<button class="btn ok" data-act="confirm" data-id="${n.id}">Confirm</button><button class="btn" data-act="form" data-id="${n.id}" data-f="decline">Decline</button>`;
  const k = f ? openFormKind : '';
  const ph = { changes: `What should ${w.name} change?`, decide: `Your decision for ${w.name}…`, reply: `Reply to ${w.name}…`, decline: 'Why not, or what instead?' }[k];
  const btn = { changes: 'Send back with changes', decide: 'Send decision + unblock', reply: 'Send reply', decline: 'Decline' }[k];
  return `<article class="nycard t-${n.type}">
    <div class="nyhead"><span class="typ">${ic(n.type)}${typeLabel(n)}</span>${n.state === 'open' ? '<span class="new">New</span>' : ''}<time>${ago(n.created)}</time></div>
    <h3>${esc(n.title)}</h3><p class="body">${esc(n.body)}</p>
    <p class="who">${avatar(w)}${esc(w.name)}${n.type === 'email' && n.sender ? `<span class="due">${n.sender.teammate ? 'Teammate' : esc(n.sender.email)}</span>` : ''}${t ? `<span aria-hidden="true">/</span>${esc(listName(t))}${dueTag(t.due_date)}` : ''}${n.priority === 1 ? prioTag(1) : ''}</p>
    <div class="acts">${acts}</div>
    ${f ? `<div class="inline"><textarea id="nf-${n.id}" rows="2" placeholder="${esc(ph)}"></textarea><button class="btn primary" data-act="formSend" data-id="${n.id}">${btn}</button></div>` : ''}
  </article>`;
}
const sortNeeds = (a, b) => a.priority - b.priority || a.created - b.created;
function rNeeds() {
  const items = openNeeds().sort(sortNeeds);
  const h = head('Needs you', `${items.length} waiting on you. Items clear when the work moves, not when you look.`);
  return h + (items.length ? `<div class="wrap">${items.map(n => needCard(n)).join('')}</div>` : `<div class="empty"><strong>Nothing waiting on you.</strong>Reviews on ClickUp tasks you created or watch, blocked tasks tagged <code>needs-owner</code>, comments that @mention you with a question, and (once Google is connected) important or starred emails and emails waiting on your reply land here.</div>`);
}
function rTeam() {
  const order = { working: 0, focus: 1, online: 2, meeting: 3, break: 4, away: 5, offline: 6 };
  const ws = db.workers.slice().sort((a, b) => (b.is_owner - a.is_owner) || attention(b.id) - attention(a.id) || order[displayStatus(a)] - order[displayStatus(b)]);
  return head('Team', `${ws.length} people${db.mode.slack === 'live' ? ' from Slack' : ''}${db.mode.clickup === 'live' ? ', matched to ClickUp' : ''}.`) + `<div class="tgrid">${ws.map(w => {
    const st = displayStatus(w), cur = currentTask(w.id), att = attention(w.id);
    return `<div class="tmcard${selected === w.id ? ' sel' : ''}">
      <div class="tmtop">${bigAvatar(w)}<b>${esc(w.name)}${w.is_owner ? ' (you)' : ''}</b><span>${esc([w.role, w.department].filter(Boolean).join(' · ') || w.match || '')}</span>${statusIcon(w)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${statusPill(st)}${w.slack_user_id ? `<span class="pill">Slack: ${w.slack_presence === 'active' ? 'Active' : 'Away'}${w.slack_dnd ? ' · Do not disturb' : ''}${w.slack_status_text ? ' · ' + esc(w.slack_status_text) : ''}</span>` : '<span class="pill">Not in Slack</span>'}${att ? `<span class="pill amber">${att} for you</span>` : ''}</div>
      <div class="tmwork"><div class="k">Current work</div>${cur ? `${esc(cur.name)} <span class="due">· ${STATE_LBL[hqState(cur)]}</span>` : '<span class="due">Nothing in progress</span>'}</div>
      <div class="tmacts">${!w.is_owner && w.slack_user_id ? `<button class="btn" data-act="dMsgOpen" data-id="${w.id}">${ic('msg')}Message</button>` : ''}${w.clickup_user_id ? `<button class="btn" data-act="assign" data-id="${w.id}">${ic('plus')}Assign</button>` : ''}<button class="btn ghost" data-act="pick" data-id="${w.id}">Details</button></div>
    </div>`;
  }).join('')}</div>`;
}
// ---------- tasks: one view with List / Board / Calendar, like ClickUp ----------
const HQ_HEX = { todo: '#8D8D8D', in_progress: '#3F7CDB', in_review: '#2E9E5B', changes_requested: '#D1495B', blocked: '#E09A2E', approved: '#1B998B', cancelled: '#5B6372' };
const canEdit = t => M.canEditTask(db, t);
const lockMsg = t => `Only ${Wx(t.assignee).name} can change this. It's assigned to them.`;
const listOf = t => db.lists.find(l => l.id === t.list_id);
const statusHex = t => t.status_color || ((listOf(t) || { statuses: [] }).statuses.find(s => s.status.toLowerCase() === String(t.clickup_status).toLowerCase()) || {}).color || HQ_HEX[hqState(t)];
const cuPill = t => `<span class="cust" style="--sc:${esc(statusHex(t))}">${esc(t.clickup_status || STATE_LBL[hqState(t)])}</span>`;
function statusCtl(t) {
  if (pendingTasks.has(t.id)) return `<span class="syncing">Syncing with ClickUp…</span>`;
  if (!canEdit(t)) return `<span class="lockst" title="${esc(lockMsg(t))}">${cuPill(t)}<svg class="ic" viewBox="0 0 24 24" aria-label="Locked"><path d="M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4"/></svg></span>`;
  const l = listOf(t), opts = l && l.statuses.length ? l.statuses.map(s => s.status) : null;
  if (!opts) return stateSelect(t);
  return `<select data-cust="${t.id}" aria-label="Status">${opts.map(s => `<option value="${esc(s)}"${s.toLowerCase() === String(t.clickup_status).toLowerCase() ? ' selected' : ''}>${esc(s.toUpperCase())}</option>`).join('')}</select>`;
}
const flag = p => p && p < 3 ? `<span class="flag p${p}" title="${PRIO[p]}">⚑ ${PRIO[p]}</span>` : '';
const tagChips = t => (t.tags || []).slice(0, 3).map(x => `<span class="tagc">${esc(x)}</span>`).join('');

function taskRow(t) {
  const w = Wx(t.assignee);
  return `<div class="trow2"><span class="t">${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${esc(t.name)}</a>` : esc(t.name)}</span>${statusCtl(t)}
    <span class="m">${avatar(w)}${esc(w.name)} · ${esc(listName(t))} ${prioTag(t.priority)} ${dueTag(t.due_date)} ${tagChips(t)}</span></div>`;
}

/** Tasks after the toolbar filters (scope, person, project, priority, search), sorted. */
function filteredTasks() {
  const own = OWNER(), q = (ui.tq || '').toLowerCase();
  let ts = db.tasks.filter(t => hqState(t) !== 'cancelled');
  if (ui.tscope === 'mine') ts = ts.filter(t => own && t.assignee === own.id);
  else if (String(ui.tperson).startsWith('g:')) { const g = (db.groups || []).find(x => x.id === ui.tperson.slice(2)); ts = ts.filter(t => g && g.members.includes(t.assignee)); }
  else if (ui.tperson) ts = ts.filter(t => (ui.tperson === 'none' ? !t.assignee : t.assignee === ui.tperson));
  if (ui.tlist) ts = ts.filter(t => t.list_id === ui.tlist);
  if (ui.tprio) ts = ts.filter(t => String(t.priority) === ui.tprio);
  if (q) ts = ts.filter(t => (t.name + ' ' + listName(t) + ' ' + (t.tags || []).join(' ') + ' ' + Wx(t.assignee).name).toLowerCase().includes(q));
  const ord = s => HQ_STATES.indexOf(s), byDue = (a, b) => (a.due_date || '9').localeCompare(b.due_date || '9');
  const sorts = { status: (a, b) => ord(hqState(a)) - ord(hqState(b)) || byDue(a, b) || a.priority - b.priority, due: (a, b) => byDue(a, b) || a.priority - b.priority, priority: (a, b) => a.priority - b.priority || byDue(a, b), name: (a, b) => a.name.localeCompare(b.name), updated: (a, b) => b.updated - a.updated };
  return ts.sort(sorts[ui.tsort] || sorts.status);
}

function tasksToolbar(count) {
  const sel = (id, cur, opts, label) => `<select id="${id}" aria-label="${label}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur || '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const people = [['', 'Everyone'], ...(db.groups || []).map(g => ['g:' + g.id, 'Group: ' + g.name]), ['none', 'Unassigned'], ...db.workers.filter(w => w.clickup_user_id || db.mode.demo).map(w => [w.id, w.name + (w.is_owner ? ' (you)' : '')])];
  const views = [['list', 'List', 'list'], ['board', 'Board', 'board'], ['calendar', 'Calendar', 'confirmation']];
  return `<div class="vtabs" role="tablist">${views.map(([v, l, i]) => `<button role="tab" data-act="tview" data-id="${v}" aria-selected="${ui.tview === v}">${ic(i)}${l}</button>`).join('')}<span class="grow"></span>
    <button class="btn primary" data-act="ntToggle">${ic('plus')}Task</button></div>
    <div class="tbar">
      <button class="chipb" data-act="scope" data-id="mine" aria-pressed="${ui.tscope === 'mine'}">My tasks</button><button class="chipb" data-act="scope" data-id="all" aria-pressed="${ui.tscope === 'all'}">All tasks</button>
      ${ui.tscope === 'all' ? sel('tperson', ui.tperson, people, 'Person') : ''}
      ${sel('tlist', ui.tlist, [['', 'All projects'], ...db.lists.map(l => [l.id, l.name])], 'Project')}
      ${sel('tprio', ui.tprio, [['', 'Any priority'], ...[1, 2, 3, 4].map(p => [p, PRIO[p]])], 'Priority')}
      <input id="tq" type="search" placeholder="Search tasks" value="${esc(ui.tq || '')}" aria-label="Search tasks">
      <span class="grow"></span>
      ${ui.tview === 'list' ? `<label class="hint" for="tgroup">Group</label>${sel('tgroup', ui.tgroup, [['none', 'None'], ['status', 'Status'], ['person', 'Person'], ['priority', 'Priority'], ['due', 'Due date'], ['project', 'Project']], 'Group by')}` : ''}
      ${ui.tview !== 'calendar' ? `<label class="hint" for="tsort">Sort</label>${sel('tsort', ui.tsort, [['status', 'Status'], ['due', 'Due date'], ['priority', 'Priority'], ['name', 'Name'], ['updated', 'Last updated']], 'Sort')}` : ''}
      <span class="hint">${count} task${count === 1 ? '' : 's'}</span>
    </div>`;
}

function newTaskForm() {
  if (!newTaskOpen) return '';
  const own = OWNER(), pw = ui.tscope === 'all' && ui.tperson && ui.tperson !== 'none' ? W(ui.tperson) : null;
  const assignable = db.workers.filter(w => w.clickup_user_id || db.mode.demo);
  return `<div class="newform">
    <label class="full">Task<input id="nt-name" placeholder="What needs doing?"></label>
    <label>Assignee<select id="nt-who">${assignable.map(w => `<option value="${w.id}"${(pw ? pw.id : own && own.id) === w.id ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
    <label>Project (ClickUp list)<select id="nt-list">${db.lists.map(l => `<option value="${l.id}"${l.id === ui.tlist ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
    <label>Priority<select id="nt-prio">${[1, 2, 3, 4].map(p => `<option value="${p}"${p === 3 ? ' selected' : ''}>${PRIO[p]}</option>`).join('')}</select></label>
    <label>Due<input id="nt-due" type="date" value="${isoDay(3)}"></label>
    <div class="full crow" style="margin:0"><span class="hint">Creates the task in ClickUp.</span><button class="btn primary" data-act="ntCreate">Create in ClickUp</button></div></div>`;
}

function tasksList(ts) {
  const g = ui.tgroup, ord = s => HQ_STATES.indexOf(s);
  const keyOf = { none: () => '', person: t => Wx(t.assignee).name, status: t => STATE_LBL[hqState(t)], priority: t => PRIO[t.priority] || 'Normal', due: t => DUE_B[dueInfo(t.due_date).bucket], project: t => listName(t) };
  const gorder = { status: t => ord(hqState(t)), priority: t => t.priority, due: t => dueInfo(t.due_date).bucket };
  const groups = [], idx = {};
  ts.forEach(t => { const k = (keyOf[g] || keyOf.none)(t); if (!(k in idx)) { idx[k] = groups.length; groups.push({ k, o: gorder[g] ? gorder[g](t) : k, items: [] }); } groups[idx[k]].items.push(t); });
  groups.sort((a, b) => typeof a.o === 'number' ? a.o - b.o : String(a.o).localeCompare(String(b.o)));
  return groups.map(gr => `${g !== 'none' ? `<div class="gh"><span>${esc(gr.k)}</span><span>${gr.items.length}</span></div>` : ''}${gr.items.slice(0, 300).map(taskRow).join('')}`).join('');
}

/** Board columns: a chosen project shows its real ClickUp statuses (and colors); all projects group by HQ workflow state. */
function boardColumns(ts) {
  const l = ui.tlist && db.lists.find(x => x.id === ui.tlist);
  if (l) return l.statuses.map(s => ({ key: 'cu:' + s.status, label: s.status, color: s.color || HQ_HEX[s.auto], items: ts.filter(t => String(t.clickup_status).toLowerCase() === s.status.toLowerCase()) }));
  return ['todo', 'in_progress', 'in_review', 'changes_requested', 'blocked', 'approved'].map(k => ({ key: 'hq:' + k, label: STATE_LBL[k], color: HQ_HEX[k], items: ts.filter(t => hqState(t) === k) }));
}
function boardCard(t) {
  const w = Wx(t.assignee), ed = canEdit(t), d = t.due_date ? dueInfo(t.due_date) : null;
  return `<article class="bcard${ed ? '' : ' ro'}"${ed ? ` draggable="true" data-drag="${t.id}"` : ` title="${esc(lockMsg(t))}"`}>
    <a class="bt" ${t.url ? `href="${esc(t.url)}" target="_blank" rel="noopener"` : ''}>${esc(t.name)}</a>
    <div class="bm">${avatar(w)}${d ? `<span class="due${d.late ? ' late' : ''}">${esc(d.txt.replace('Due ', ''))}</span>` : ''}${flag(t.priority)}${tagChips(t)}${ed ? '' : '<span class="lk" aria-label="Locked">🔒</span>'}</div>
    ${pendingTasks.has(t.id) ? '<span class="syncing">Syncing…</span>' : ''}
  </article>`;
}
function tasksBoard(ts) {
  const l = ui.tlist && db.lists.find(x => x.id === ui.tlist);
  const cols = boardColumns(ts), teamId = db.meta.clickup_team_id;
  const addGroup = l && teamId && db.mode.clickup === 'live'
    ? `<a class="addgrp" href="https://app.clickup.com/${esc(teamId)}/v/li/${esc(l.id)}" target="_blank" rel="noopener" title="ClickUp's API can't create statuses, so new groups are added in ClickUp. HQ picks them up on the next sync.">${ic('plus')}Add group</a>`
    : `<span class="addgrp dim" title="Pick a project to see its own ClickUp statuses and add groups.">${ic('plus')}Add group</span>`;
  return `<div class="board2">${cols.map(c => `<section class="bcol" data-col="${esc(c.key)}" style="--sc:${esc(c.color)}">
      <h4><span class="cust">${esc(c.label)}</span><span class="n">${c.items.length}</span></h4>
      <div class="bcards">${c.items.slice(0, 80).map(boardCard).join('')}${c.items.length > 80 ? `<p class="hint">+${c.items.length - 80} more. Narrow it with the filters.</p>` : ''}</div>
      ${ui.addIn === c.key ? `<div class="addin"><input id="ai-${esc(c.key)}" placeholder="Task name, then Enter" data-addcol="${esc(c.key)}"><span class="hint">Assigned to ${esc(addAssignee() ? addAssignee().name : 'nobody')} · ${esc(l ? l.name : defaultListName())}</span></div>`
        : `<button class="addt" data-act="addIn" data-id="${esc(c.key)}">${ic('plus')}Add Task</button>`}
    </section>`).join('')}${addGroup}</div>`;
}
const addAssignee = () => (ui.tscope === 'all' && ui.tperson && ui.tperson !== 'none' ? W(ui.tperson) : OWNER());
const defaultListName = () => { const l = db.lists[0]; return l ? l.name : 'default list'; };

function tasksCalendar(ts) {
  const base = ui.tmonth ? new Date(ui.tmonth + '-01T00:00:00') : new Date(); base.setDate(1);
  const month = base.getMonth(), start = new Date(base); start.setDate(1 - ((base.getDay() + 6) % 7)); // weeks start Monday
  const byDay = {}; ts.forEach(t => { if (t.due_date) (byDay[t.due_date] = byDay[t.due_date] || []).push(t); });
  const today = isoDay(0), cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, items = byDay[key] || [];
    cells.push(`<div class="cday${d.getMonth() !== month ? ' out' : ''}${key === today ? ' today' : ''}"><span class="dn">${d.getDate()}</span>${items.slice(0, 3).map(t => `<a class="cev" style="--sc:${esc(statusHex(t))}" ${t.url ? `href="${esc(t.url)}" target="_blank" rel="noopener"` : ''} title="${esc(t.name + ' · ' + Wx(t.assignee).name + ' · ' + t.clickup_status)}">${esc(t.name)}</a>`).join('')}${items.length > 3 ? `<span class="more">+${items.length - 3} more</span>` : ''}</div>`);
  }
  const noDate = ts.filter(t => !t.due_date).length;
  return `<div class="calbar"><button class="btn" data-act="tmonth" data-id="-1" aria-label="Previous month">‹</button><b>${base.toLocaleDateString([], { month: 'long', year: 'numeric' })}</b><button class="btn" data-act="tmonth" data-id="1" aria-label="Next month">›</button><button class="btn ghost" data-act="tmonth" data-id="0">Today</button><span class="grow"></span>${noDate ? `<span class="hint">${noDate} without a due date (see List)</span>` : ''}</div>
    <div class="cal"><div class="cwd">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span>${d}</span>`).join('')}</div><div class="cgrid">${cells.join('')}</div></div>`;
}

function rTasks() {
  const own = OWNER(), ts = filteredTasks();
  const pw = ui.tscope === 'all' && ui.tperson && ui.tperson !== 'none' ? W(ui.tperson) : null, pg = String(ui.tperson).startsWith('g:') && ui.tscope === 'all' ? (db.groups || []).find(g => g.id === ui.tperson.slice(2)) : null;
  const title = ui.tscope === 'mine' ? 'My tasks' : pw ? `${pw.name}'s tasks` : pg ? `${pg.name} tasks` : 'All tasks';
  const body = !ts.length && ui.tview !== 'calendar' ? `<div class="empty"><strong>No tasks here.</strong>${ui.tscope === 'mine' && !own ? 'Set OWNER_EMAIL so HQ knows which person is you.' : 'Change the filters, or add one.'}</div>`
    : ui.tview === 'board' ? tasksBoard(ts) : ui.tview === 'calendar' ? tasksCalendar(ts) : `<div class="wrap">${tasksList(ts)}</div>`;
  return head(title, `${db.mode.clickup === 'live' ? 'Live from ClickUp' : 'Demo data'} · you can change the status of tasks assigned to you`) + tasksToolbar(ts.length) + newTaskForm() + body;
}
// ---------- channels: read your Slack channels and threads inside HQ ----------
const chans = { loading: false, data: null, error: null, team: null, byUser: false, at: 0 };
const msgCache = {}; // key "C123" or "C123/1700000000.000100" -> { loading, at, data, error }
function loadChannels(refresh) {
  if (chans.loading) return;
  chans.loading = true;
  fetch('/api/channels' + (refresh ? '?refresh=1' : '')).then(r => r.json()).then(j => {
    Object.assign(chans, { loading: false, at: Date.now(), data: j.ok ? j.channels : null, error: j.ok ? null : j.error, team: j.team || chans.team, byUser: !!j.byUser });
    if (ui.view === 'channels') render();
  }).catch(e => { Object.assign(chans, { loading: false, error: e.message }); if (ui.view === 'channels') render(); });
}
function loadMessages(ch, ts, force) {
  const key = ts ? `${ch}/${ts}` : ch, c = msgCache[key] = msgCache[key] || {};
  if (c.loading || (!force && (c.data || c.error) && Date.now() - c.at < 25000)) return;
  c.loading = true;
  fetch(ts ? `/api/channels/${ch}/thread/${ts}` : `/api/channels/${ch}/messages`).then(r => r.json())
    .then(j => { Object.assign(c, { loading: false, at: Date.now(), data: j.ok ? j : null, error: j.ok ? null : j }); if (ui.view === 'channels') render(); })
    .catch(e => { Object.assign(c, { loading: false, at: Date.now(), error: { error: e.message } }); if (ui.view === 'channels') render(); });
}
setInterval(() => { if (ui.view === 'channels' && ui.chSel) loadMessages(ui.chSel, ui.chThread || null); }, 30000);

/** Slack mrkdwn -> safe HTML: mentions, channel links, links, code, bold/italic/strike, quotes, line breaks. */
function mrkdwn(text, users) {
  let s = esc(text);
  const keep = []; const hold = h => `\u0000${keep.push(h) - 1}\u0000`;
  s = s.replace(/```([\s\S]*?)```/g, (m, c) => hold(`<pre>${c.replace(/^\n/, '')}</pre>`));
  s = s.replace(/`([^`\n]+)`/g, (m, c) => hold(`<code>${c}</code>`));
  s = s.replace(/&lt;@([UW][A-Z0-9]+)(?:\|[^&]*)?&gt;/g, (m, id) => hold(`<span class="ment">@${esc((users[id] || {}).name || 'someone')}</span>`));
  s = s.replace(/&lt;#(C[A-Z0-9]+)\|([^&]*)&gt;/g, (m, id, n) => hold(`<button type="button" class="ment" data-act="chOpen" data-id="${id}">#${n || 'channel'}</button>`));
  s = s.replace(/&lt;!(here|channel|everyone)(?:\|[^&]*)?&gt;/g, (m, k) => hold(`<span class="ment">@${k}</span>`));
  s = s.replace(/&lt;!subteam\^[A-Z0-9]+\|?([^&]*)&gt;/g, (m, n) => hold(`<span class="ment">${n || '@group'}</span>`));
  s = s.replace(/&lt;((?:https?|mailto):[^|]+?)\|(.+?)&gt;/g, (m, u, t) => hold(`<a href="${u}" target="_blank" rel="noopener">${t}</a>`));
  s = s.replace(/&lt;((?:https?|mailto):.+?)&gt;/g, (m, u) => hold(`<a href="${u}" target="_blank" rel="noopener">${u}</a>`));
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?:;])/g, '$1<b>$2</b>').replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?:;])/g, '$1<i>$2</i>').replace(/(^|[\s(])~([^~\n]+)~(?=$|[\s).,!?:;])/g, '$1<s>$2</s>');
  s = s.replace(/^&gt; ?(.*)$/gm, '<q>$1</q>').replace(/\n/g, '<br>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]);
}
const tsDate = ts => new Date(Number(String(ts).split('.')[0]) * 1000);
const dayLabel = d => { const t = new Date(); t.setHours(0, 0, 0, 0); const x = new Date(d); x.setHours(0, 0, 0, 0); const diff = Math.round((t - x) / 864e5); return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }); };
const slackLink = (ch, ts) => `https://app.slack.com/client/${esc(chans.team || db.meta.slack_team_id || '')}/${esc(ch)}${ts ? `/thread/${esc(ch)}-${esc(ts)}` : ''}`;
const miniAv = (x, cls) => x.avatar ? `<span class="mav${cls || ''} img" style="background-image:url('${esc(x.avatar)}')"></span>` : `<span class="mav${cls || ''}" style="background:${hexOf(x.color)}">${esc((x.name || '?')[0])}</span>`;
function msgHTML(m, users, prev, inThread) {
  const u = m.user ? users[m.user] || { name: 'Someone', color: '#8A94A6' } : { name: m.bot || 'App', avatar: m.bot_icon, color: '#5B6372' };
  const d = tsDate(m.ts), time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  // messages from the same person within 5 minutes stack without repeating the name, like Slack
  const cont = prev && prev.user === m.user && !m.subtype && !prev.reply_count && (d - tsDate(prev.ts)) < 5 * 60000 && dayLabel(d) === dayLabel(tsDate(prev.ts));
  const files = m.files.map(f => f.url ? `<a class="mfile" href="${esc(f.url)}" target="_blank" rel="noopener">📎 ${esc(f.name)}</a>` : `<span class="mfile">📎 ${esc(f.name)}</span>`).join('');
  const reacts = m.reactions.length ? `<div class="mreacts">${m.reactions.map(r => `<span class="mreact" title=":${esc(r.name)}:">${r.icon && r.icon.url ? `<img src="${esc(r.icon.url)}" alt=":${esc(r.name)}:">` : esc((r.icon && r.icon.char) || ':' + r.name + ':')} ${r.count}</span>`).join('')}</div>` : '';
  const thread = !inThread && m.reply_count ? `<button class="mthread" data-act="chThread" data-id="${esc(m.ts)}">${m.reply_users.slice(0, 4).map(id => miniAv(users[id] || {}, ' xs')).join('')}<b>${m.reply_count} ${m.reply_count === 1 ? 'reply' : 'replies'}</b>${m.latest_reply ? `<small>Last reply ${ago(tsDate(m.latest_reply).getTime())}</small>` : ''}</button>` : '';
  return `<div class="msg${cont ? ' cont' : ''}">${cont ? `<span class="mtime">${time}</span>` : miniAv(u)}<div class="mbody">${cont ? '' : `<div class="mhead"><b>${esc(u.name)}</b><time title="${esc(d.toLocaleString())}">${time}</time></div>`}
    <div class="mtext">${mrkdwn(m.text, users)}${m.edited ? ' <small class="medit">(edited)</small>' : ''}</div>${files}${reacts}${thread}</div></div>`;
}
function messagesHTML(msgs, users, inThread) {
  let out = '', lastDay = '';
  msgs.forEach((m, i) => {
    const day = dayLabel(tsDate(m.ts));
    if (!inThread && day !== lastDay) { out += `<div class="mday"><span>${day}</span></div>`; lastDay = day; }
    out += msgHTML(m, users, i && !(inThread && i === 1) ? msgs[i - 1] : null, inThread);
    if (inThread && i === 0 && msgs.length > 1) out += `<div class="mday rep"><span>${msgs.length - 1} ${msgs.length === 2 ? 'reply' : 'replies'}</span></div>`;
  });
  return out;
}
const historyHelp = e => `<div class="empty"><strong>${e && e.needsHistory ? 'HQ needs permission to read messages.' : "Couldn't load messages."}</strong>${esc((e && e.error) || '')}${e && e.needsHistory ? `<br><br>In <b>api.slack.com/apps → your app → OAuth &amp; Permissions → User Token Scopes</b>, add <code>channels:history</code> and <code>groups:history</code>, then click <b>Reinstall to Workspace</b>. Your <code>SLACK_USER_TOKEN</code> stays the same.` : ''}</div>`;
function chPane() {
  const ch = (chans.data || []).find(c => c.id === ui.chSel);
  if (!ch) return `<div class="chpane"><p class="hint" style="padding:24px">Pick a channel to read it here.</p></div>`;
  const th = ui.chThread, key = th ? `${ch.id}/${th}` : ch.id; loadMessages(ch.id, th);
  const c = msgCache[key] || {}, d = c.data, name = `${ch.is_private ? '🔒' : '#'} ${esc(ch.name)}`;
  const open = (ts, label) => `<a class="xbtn sm open" href="${slackLink(ch.id, ts)}" target="_blank" rel="noopener" title="${label}" aria-label="${label}">${ic('ext')}</a>`;
  const hd = th
    ? `<header class="chhead"><button class="xbtn sm" data-act="chBack" aria-label="Back to ${esc(ch.name)}"><svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button><div><b>Thread</b><small>${name}</small></div>${open(th, 'Open this thread in Slack')}</header>`
    : `<header class="chhead"><div><b>${name}</b><small>${esc(ch.topic || ch.purpose || '')}${ch.members ? `${ch.topic || ch.purpose ? ' · ' : ''}${ch.members} members` : ''}</small></div>${open(null, 'Open in Slack')}</header>`;
  const body = c.error ? historyHelp(c.error) : !d ? '<p class="hint" style="padding:16px">Loading messages…</p>'
    : !d.messages.length ? '<p class="hint" style="padding:16px">No messages yet.</p>' : messagesHTML(d.messages, d.users, !!th);
  return `<div class="chpane">${hd}<div class="msgs" id="msgs-${esc(key.replace(/[^\w-]/g, '_'))}" data-keepscroll>${body}</div>
    <div class="chfoot">Reading only · <a href="${slackLink(ch.id, th)}" target="_blank" rel="noopener">Reply in Slack</a></div></div>`;
}
function rChannels() {
  if (!chans.data && !chans.error && !chans.loading) loadChannels();
  const q = (ui.cq || '').toLowerCase();
  const list = (chans.data || []).filter(c => !q || (c.name + ' ' + c.topic + ' ' + c.purpose).toLowerCase().includes(q));
  const scopeHelp = `<div class="empty"><strong>HQ can't list your channels yet.</strong>${esc(chans.error || '')}<br><br>Add <code>SLACK_USER_TOKEN</code> (with <code>channels:read</code> and <code>groups:read</code>) to <code>.env</code> and restart HQ.</div>`;
  const rows = list.map(c => `<button class="chrow${c.id === ui.chSel ? ' sel' : ''}" data-act="chOpen" data-id="${esc(c.id)}"><span class="chn">${c.is_private ? '🔒' : '#'}</span><span class="chb"><b>${esc(c.name)}</b>${c.topic || c.purpose ? `<small>${esc(c.topic || c.purpose)}</small>` : ''}</span></button>`).join('');
  return head('Channels', `Your Slack channels${chans.data ? ` · ${chans.data.length}` : ''}`, `<button class="btn" data-act="chRefresh">${ic('sync')}Refresh</button>`) +
    (chans.loading && !chans.data ? '<p class="hint">Loading your channels from Slack…</p>' : chans.error ? scopeHelp :
      `<div class="chwrap"><aside class="chside"><input id="cq" type="search" placeholder="Search channels" value="${esc(ui.cq || '')}" aria-label="Search channels">
        <div class="chlist">${rows || '<p class="hint" style="padding:10px">No channels match.</p>'}</div></aside>${chPane()}</div>`);
}
// ---------- groups: name a team, pick people and a station style; the 3D office rearranges to match ----------
const STYLE_LBL = { glass: 'Glass cubicle', cubicle: 'Cubicle', open: 'Open desk' };
const STYLE_SUB = { glass: 'See-through panels', cubicle: 'Solid walls, more privacy', open: 'No partitions, easy to talk' };
const GROUP_COLORS = ['#7B5EA7', '#3F7CDB', '#2E9E5B', '#E09A2E', '#D1495B', '#2A9D8F', '#8C5A3C', '#4D5B6B'];
// small drawings of each station style for the picker
const STYLE_ART = {
  glass: '<svg viewBox="0 0 80 50" aria-hidden="true"><rect x="10" y="30" width="60" height="6" rx="1" fill="#E9DFC8"/><rect x="8" y="10" width="64" height="20" rx="2" fill="#9CC9E8" fill-opacity=".45" stroke="#6FA8DC"/><rect x="30" y="20" width="20" height="10" rx="1" fill="#2A2F36"/><rect x="34" y="38" width="12" height="8" rx="1" fill="#3A4450"/></svg>',
  cubicle: '<svg viewBox="0 0 80 50" aria-hidden="true"><rect x="6" y="6" width="68" height="26" rx="2" fill="#8C8577"/><rect x="6" y="6" width="6" height="40" fill="#7A7366"/><rect x="68" y="6" width="6" height="40" fill="#7A7366"/><rect x="14" y="30" width="52" height="6" rx="1" fill="#E9DFC8"/><rect x="30" y="20" width="20" height="10" rx="1" fill="#2A2F36"/><rect x="34" y="38" width="12" height="8" rx="1" fill="#3A4450"/></svg>',
  open: '<svg viewBox="0 0 80 50" aria-hidden="true"><rect x="10" y="30" width="60" height="6" rx="1" fill="#E9DFC8"/><rect x="30" y="20" width="20" height="10" rx="1" fill="#2A2F36"/><rect x="34" y="38" width="12" height="8" rx="1" fill="#3A4450"/><circle cx="16" cy="24" r="4" fill="#5E9E4A"/></svg>'
};
let gDraft = null; // { id?, name, style, color, members:Set, q }
const groupOf = id => (db.groups || []).find(g => g.members.includes(id)) || null;
const officePeople = () => db.workers.filter(w => w.slack_user_id || db.mode.slack !== 'live');
function groupForm() {
  const d = gDraft, q = (d.q || '').toLowerCase();
  const people = db.workers.filter(w => !q || (w.name + ' ' + w.role + ' ' + (w.email || '')).toLowerCase().includes(q)).sort((a, b) => (d.members.has(b.id) - d.members.has(a.id)) || a.name.localeCompare(b.name));
  return `<div class="gform">
    <div class="gcols">
      <label class="gfield">Group name<input id="g-name" maxlength="40" placeholder="e.g. Design, Video editors, Sales" value="${esc(d.name)}"></label>
      <div class="gfield"><span>Color</span><div class="gsw" role="radiogroup" aria-label="Group color">${GROUP_COLORS.map(c => `<button type="button" role="radio" aria-checked="${d.color === c}" aria-label="${c}" data-act="gColor" data-id="${c}" style="--c:${c}"></button>`).join('')}</div></div>
    </div>
    <div class="gfield"><span>Station style</span><div class="gstyles" role="radiogroup" aria-label="Station style">${Object.keys(STYLE_LBL).map(k => `<button type="button" role="radio" class="gstyle" aria-checked="${d.style === k}" data-act="gStyle" data-id="${k}">${STYLE_ART[k]}<b>${STYLE_LBL[k]}</b><small>${STYLE_SUB[k]}</small></button>`).join('')}</div></div>
    <div class="gfield"><span>People · ${d.members.size} picked</span>
      <input id="g-q" type="search" placeholder="Search people" value="${esc(d.q || '')}" aria-label="Search people">
      <div class="gpeople">${people.map(w => { const og = groupOf(w.id), other = og && og.id !== d.id; return `<label class="gp${d.members.has(w.id) ? ' on' : ''}"><input type="checkbox" data-gmember="${w.id}"${d.members.has(w.id) ? ' checked' : ''}>${avatar(w)}<span><b>${esc(w.name)}${w.is_owner ? ' (you)' : ''}</b><small>${esc(w.role || w.email || '')}</small></span>${other ? `<em title="Picking them moves them out of ${esc(og.name)}">in ${esc(og.name)}</em>` : ''}</label>`; }).join('')}</div></div>
    <div class="gacts">${d.id ? `<button class="btn danger" data-act="gDelete" data-id="${d.id}">Delete group</button>` : ''}<span class="grow"></span><button class="btn" data-act="gCancel">Cancel</button><button class="btn primary" data-act="gSave">${d.id ? 'Save group' : 'Create group'}</button></div>
  </div>`;
}
function groupCard(g) {
  const ms = g.members.map(id => W(id)).filter(Boolean), on = ms.filter(w => displayStatus(w) !== 'offline').length;
  const open = ui.gOpen === g.id;
  return `<article class="gcard" style="--c:${esc(g.color)}">
    <header><span class="gdot"></span><div><h3>${esc(g.name)}</h3><small>${STYLE_LBL[g.style]} · ${ms.length} ${ms.length === 1 ? 'person' : 'people'} · ${on} in now</small></div>
      <div class="gbtns"><button class="btn" data-act="gFocus" data-id="${g.id}">Show in office</button><button class="btn ghost" data-act="gTasks" data-id="${g.id}">${ic('tasks')}Tasks</button><button class="btn ghost" data-act="gEdit" data-id="${g.id}">Edit</button></div></header>
    <button class="gstack" data-act="gToggle" data-id="${g.id}" aria-expanded="${open}">${ms.slice(0, 12).map(w => `<span class="gsa">${avatar(w)}<i class="dot s-${displayStatus(w)}"></i></span>`).join('')}${ms.length > 12 ? `<span class="more">+${ms.length - 12}</span>` : ''}${ms.length ? '' : '<span class="hint">No one yet. Edit to add people.</span>'}<span class="grow"></span><span class="hint">${open ? 'Hide' : 'Show'} people</span></button>
    ${open ? `<div class="gmembers">${ms.map(w => { const st = displayStatus(w), cur = currentTask(w.id); return `<button class="gm" data-act="pick" data-id="${w.id}">${avatar(w)}<b>${esc(w.name)}</b>${statusPill(st)}${statusIcon(w)}<span class="due">${cur ? esc(short(cur.name, 40)) : 'Nothing in progress'}</span></button>`; }).join('')}</div>` : ''}
  </article>`;
}
function rGroups() {
  const gs = db.groups || [], grouped = new Set(gs.flatMap(g => g.members)), rest = officePeople().filter(w => !grouped.has(w.id)).length;
  return head('Groups', 'Put people into groups. Each group gets its own area in the 3D office, with the station style you pick.', gDraft ? '' : `<button class="btn primary" data-act="gNew">${ic('plus')}New group</button>`) +
    `<div class="wrap">${gDraft ? groupForm() : ''}${gs.length ? gs.map(groupCard).join('') : gDraft ? '' : `<div class="empty"><strong>No groups yet.</strong>Create one, for example "Video editors", pick the people and a station style, and the office rearranges into that group.</div>`}
    ${gs.length ? `<p class="hint">${rest} ${rest === 1 ? 'person is' : 'people are'} not in a group and sit in "Everyone else" (glass cubicles).</p>` : ''}</div>`;
}
function saveGroup() {
  const d = gDraft; d.name = val('g-name') || d.name;
  if (!d.name.trim()) { toast('Give the group a name.'); return focus('g-name'); }
  post('/api/groups', { id: d.id, name: d.name, style: d.style, color: d.color, members: [...d.members] }).then(() => { toast(d.id ? 'Group saved. The office is updating.' : `${d.name} created. The office is updating.`); gDraft = null; render(); }).catch(() => { });
}
let simOn = true;
function rAutomations() {
  return head('Automations', 'Status mapping and routing rules.') + `<div class="wrap">
  ${db.mode.demo ? `<label class="switch"><span><b>Demo simulator</b><p>Sends fake ClickUp and Slack events every few seconds.</p></span><input type="checkbox" id="demoToggle"${simOn ? ' checked' : ''}></label>` : ''}
  <div class="sect">ClickUp status mapping</div>
  <p class="hint" style="margin:0 2px 10px">HQ guessed a mapping from each list's status names. Fix any that are wrong. “In review” creates an Approval in Needs You; “Blocked” creates a Decision when the task is tagged <code>needs-owner</code> or assigned to you.</p>
  ${db.lists.length ? db.lists.map(l => `<div class="maplist"><h4>${esc(l.name)}<span>${l.statuses.length} statuses</span></h4>${l.statuses.map(s => {
    const m = db.map.find(r => r.list_id === l.id && r.clickup_status === s.status);
    return `<div class="maprow"><span><span class="cust" style="--sc:${esc(s.color || HQ_HEX[s.auto] || '#8D8D8D')}">${esc(s.status)}</span></span><i>→</i><select data-map="${esc(l.id)}" data-status="${esc(s.status)}">${HQ_STATES.map(h => `<option value="${h}"${m && m.hq_state === h ? ' selected' : ''}>${STATE_LBL[h]}</option>`).join('')}</select></div>`;
  }).join('')}</div>`).join('') : '<div class="empty">No ClickUp lists synced yet.</div>'}
  <div class="sect">Instruction routing</div>
  <p class="hint" style="margin:0 2px 10px">The command bar picks a teammate by keyword; anything unmatched goes to you. Edit <code>ROUTES</code> in <code>web/app.js</code> to change these.</p>
  <div class="rules">${ROUTES.map(([name, re]) => `<div class="rule"><b>${esc(name)}</b><code>${esc(re.source.split('|').join(', '))}</code></div>`).join('')}</div></div>`;
}
function rIntegrations() {
  const ev = db.events.slice().reverse(), m = db.mode, meta = db.meta || {};
  const state = s => s === 'live' ? '<span class="pill"><i class="dot s-working"></i>Live</span>' : s === 'demo' ? '<span class="pill amber">Demo</span>' : '<span class="pill">Not set</span>';
  const cuLinked = db.workers.filter(w => w.clickup_user_id);
  return head('Integrations', 'ClickUp owns work. Slack owns people. HQ shows both.', m.demo ? "" : `<button class="btn" data-act="sync" style="white-space:nowrap">${ic("sync")}Sync now</button>`) + `<div class="wrap">
  <div class="conn"><span class="clogo" style="background:#7B68EE">C</span><b>ClickUp</b><p>${m.clickup === 'live' ? `Workspace ${esc(meta.clickup_team_id)} · ${db.tasks.length} tasks · webhook ${meta.webhook && meta.webhook.ok ? 'on' : 'off (polling every 60 s)'}` : 'Set CLICKUP_API_TOKEN to connect.'}</p>${state(m.clickup)}</div>
  <div class="conn"><span class="clogo" style="background:#4A154B">S</span><b>Slack</b><p>${m.slack === 'live' ? `Workspace ${esc(meta.slack_team_id)} · presence polled every 2 min` : 'Set SLACK_BOT_TOKEN to connect.'}</p>${state(m.slack)}</div>
  ${meta.last_sync ? `<p class="hint">Last full sync ${ago(meta.last_sync)}.</p>` : ''}
  ${(meta.errors || []).length ? `<div class="sect">Recent errors</div><div class="evlog">${meta.errors.slice().reverse().map(e => `<div class="ev"><code>${ago(e.ts)}</code><b style="color:var(--danger)">Error</b><span>${esc(e.msg)}</span></div>`).join('')}</div>` : ''}
  <div class="sect">People matching</div>
  <table class="ptable"><thead><tr><th>Person</th><th>Slack</th><th>ClickUp</th><th>Matched by</th></tr></thead><tbody>
  ${db.workers.map(w => `<tr><td><span style="display:flex;gap:8px;align-items:center">${avatar(w)}${esc(w.name)}${w.is_owner ? ' (you)' : ''}</span></td><td><code>${esc(w.slack_user_id || '—')}</code></td><td>${w.slack_user_id && m.clickup === 'live' ? `<select data-match="${esc(w.slack_user_id)}" style="font-size:12.5px;padding:4px;border-radius:6px;border:1px solid var(--line);background:var(--chip)"><option value="">— none —</option>${[...new Map(db.workers.filter(x => x.clickup_user_id).map(x => [x.clickup_user_id, x])).values()].map(x => `<option value="${esc(x.clickup_user_id)}"${x.clickup_user_id === w.clickup_user_id ? ' selected' : ''}>${esc(x.name)} (${esc(x.clickup_user_id)})</option>`).join('')}</select>` : `<code>${esc(w.clickup_user_id || '—')}</code>`}</td><td>${esc(w.match || '')}</td></tr>`).join('')}</tbody></table>
  ${m.demo ? `<div class="sect">Simulate an event</div><div class="simgrid">
    ${[['review', 'ClickUp: task → In Review', 'Creates an Approval'], ['block', 'ClickUp: task → Blocked', 'Tagged needs-owner → Decision'], ['question', 'ClickUp: comment asks you', 'Creates a Question'], ['assign', 'ClickUp: new task assigned', 'Shows as current work'], ['away', 'Slack: someone goes away', 'Presence poll'], ['meeting', 'Slack: status “In a meeting”', 'Walks to meeting room'], ['break', 'HQ: someone takes a break', 'Manual status'], ['confirm', 'HQ: teammate asks to confirm', 'Creates a Confirmation']].map(([k, a, b]) => `<button class="btn" data-act="sim" data-id="${k}">${a}<small>${b}</small></button>`).join('')}</div>` : ''}
  <div class="sect">Event log</div>
  <div class="evlog">${ev.length ? ev.map(e => `<div class="ev"><code>${ago(e.ts)}</code><b class="src-${e.src === 'clickup' ? 'cu' : e.src === 'slack' ? 'sl' : 'hq'}">${e.src === 'clickup' ? 'ClickUp' : e.src === 'slack' ? 'Slack' : 'HQ'}</b><span><code>${esc(e.type)}</code> ${esc(e.summary)}</span></div>`).join('') : '<div class="ev"><span class="due" style="grid-column:1/-1">No events yet.</span></div>'}</div></div>`;
}

// ---------- worker drawer ----------
function rDrawer() {
  const w = W(selected); if (!w) return '';
  const st = displayStatus(w), cur = currentTask(w.id), nxt = nextTask(w.id), la = lastActivity(w.id), mine = openNeeds().filter(n => n.from === w.id).sort(sortNeeds), shown = cur || nxt;
  const slackLine = w.slack_user_id ? `${w.slack_presence === 'active' ? 'Active' : 'Away'} in Slack${w.slack_status_text ? ` · “${esc(w.slack_status_text)}”` : ''}` : 'Not in Slack';
  return `<div class="dtop"><h2>Worker details</h2><button class="xbtn" data-act="close" aria-label="Close">${ic('x')}</button></div>
  <div class="dwho">${bigAvatar(w)}<span><b>${esc(w.name)}</b><span>${esc([w.role, w.department].filter(Boolean).join(' · '))}</span></span>${statusIcon(w)}</div>
  <div class="dbox"><div class="dstat"><i class="dot s-${st}"></i>${STATUS_LBL[st]}</div><div class="dsub" style="margin-top:4px">${slackLine}${w.manual_status !== 'none' ? ` · set to ${STATUS_LBL[w.manual_status]} in HQ` : ''}</div>
    ${w.is_owner ? `<div class="segs" role="group" aria-label="My status">${[['none', 'Auto'], ['focus', 'Focus'], ['meeting', 'Meeting'], ['break', 'Break'], ['offline', 'Offline']].map(([v, l]) => `<button data-act="myStatus" data-id="${v}" aria-pressed="${w.manual_status === v}">${l}</button>`).join('')}</div>` : ''}</div>
  ${mine.length ? `<div class="dny"><div class="k" style="font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:8px">Needs you · ${mine.length}</div>${mine.map(n => needCard(n, true)).join('')}</div>` : ''}
  <div class="dbox"><div class="k">${cur ? 'Current task' : nxt ? 'Up next' : 'Current task'}</div>${shown ? `<div class="v">${esc(shown.name)}</div>
    <dl class="kv"><dt>Project</dt><dd>${esc(listName(shown))}${shown.client ? ' · ' + esc(shown.client) : ''}</dd><dt>Status</dt><dd>${STATE_LBL[hqState(shown)]} <span class="due">(ClickUp: ${esc(shown.clickup_status)})</span></dd><dt>Due</dt><dd>${dueTag(shown.due_date)}</dd><dt>Priority</dt><dd>${prioTag(shown.priority)}</dd></dl>` : `<div class="s" style="margin:0">Nothing assigned right now.</div>`}</div>
  <div class="dbox"><div class="k">Latest activity</div>${la ? `<div class="v">${esc(la.text)}</div><div class="s">${ago(la.ts)}</div>` : `<div class="s" style="margin:0">No activity yet.</div>`}</div>
  <button class="dact main" data-act="viewTasks" data-id="${w.id}">${ic('list')}View tasks<small>${openCount(w.id)} open</small></button>
  ${!w.is_owner && w.slack_user_id ? `<button class="dact" data-act="dMsg" data-id="${w.id}" aria-expanded="${drawerMode === 'msg'}">${ic('msg')}Message in Slack</button>` : ''}
  ${drawerMode === 'msg' ? `<div><textarea id="dm-${w.id}" rows="2" placeholder="Message ${esc(w.name)} in Slack…"></textarea><div class="crow"><a class="btn ghost" href="slack://user?team=${esc(db.meta.slack_team_id || '')}&id=${esc(w.slack_user_id)}">${ic('ext')}Open DM in Slack</a><button class="btn primary" data-act="dmSend" data-id="${w.id}">Send</button></div></div>` : ''}
  ${w.clickup_user_id || db.mode.demo ? `<button class="dact" data-act="dInstr" data-id="${w.id}" aria-expanded="${drawerMode === 'instr'}">${ic('send')}Assign / give instruction</button>` : ''}
  ${drawerMode === 'instr' ? `<div><textarea id="di-${w.id}" rows="3" placeholder="What should ${esc(w.name)} do?"></textarea><div class="crow"><span class="hint">Creates a ClickUp task for ${esc(w.name)}.</span><button class="btn primary" data-act="dSend" data-id="${w.id}">Assign</button></div></div>` : ''}
  ${shown && shown.url ? `<a class="dact" href="${esc(shown.url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">${ic('ext')}Open in ClickUp<small>${esc(shown.cu_id)}</small></a>` : ''}`;
}

// ---------- render ----------
function keepTyping(root, fn) {
  const kept = {}; let focusId = null, sel = null;
  root.querySelectorAll('textarea,input').forEach(t => { if (t.id && t.type !== 'checkbox') kept[t.id] = t.value; });
  const ae = document.activeElement; if (ae && /TEXTAREA|INPUT/.test(ae.tagName) && root.contains(ae) && ae.id) { focusId = ae.id; try { sel = [ae.selectionStart, ae.selectionEnd]; } catch { } }
  const top = root.scrollTop; fn(); root.scrollTop = top;
  Object.keys(kept).forEach(id => { const el = document.getElementById(id); if (el) el.value = kept[id]; });
  if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); try { sel && el.setSelectionRange(sel[0], sel[1]); } catch { } } }
}
let ackTimer = null;
function render() {
  rNav();
  const isHQ = ui.view === 'hq', view = $('#view');
  view.hidden = isHQ; view.classList.toggle('wide', ui.view === 'tasks' && ui.tview !== 'list'); $('#app').classList.toggle('vopen', !isHQ);
  const ms = view.querySelector('[data-keepscroll]'), msTop = ms && ms.scrollTop, msBottom = ms && ms.scrollHeight - ms.scrollTop - ms.clientHeight < 40, msId = ms && ms.id;
  if (!isHQ) keepTyping(view, () => { view.innerHTML = { needs: rNeeds, team: rTeam, tasks: rTasks, channels: rChannels, groups: rGroups, automations: rAutomations, integrations: rIntegrations }[ui.view](); });
  if (selected && !W(selected)) selected = null;
  const din = $('#dinner'); keepTyping(din, () => { din.innerHTML = rDrawer(); });
  $('#app').classList.toggle('dopen', !!selected);
  const c = { working: 0, focus: 0, meeting: 0, break: 0, offline: 0 }; db.workers.forEach(w => { const s = displayStatus(w); if (s in c) c[s]++; });
  $('#hqline').textContent = `${db.workers.length - c.offline} in · ${c.focus} focusing · ${c.meeting} in meetings · ${c.break} on break · ${c.offline} offline`;
  $('#stats').innerHTML = [[c.working, 'Working'], [c.focus, 'Focus'], [c.meeting, 'Meeting'], [c.break, 'Break'], [openNeeds().length, 'Need you']].map(([n, l]) => `<div class="stat"><strong>${n}</strong><span>${l}</span></div>`).join('');
  clearTimeout(ackTimer);
  const vis = ui.view === 'needs' ? openNeeds() : (selected ? openNeeds().filter(n => n.from === selected) : []);
  const toAck = vis.filter(n => n.state === 'open').map(n => n.id);
  if (toAck.length) ackTimer = setTimeout(() => post('/api/needs/ack', { ids: toAck }).catch(() => { }), 1800);
  const ms2 = view.querySelector('[data-keepscroll]');
  if (ms2) { if (stickBottom || (ms2.id === msId && msBottom) || ms2.id !== msId) { if (ms2.id !== msId && !stickBottom) ms2.scrollTop = 0; else ms2.scrollTop = ms2.scrollHeight; } else ms2.scrollTop = msTop; if (ms2.querySelector('.msg')) stickBottom = false; }
  sizePanel(); syncScene(); saveUi();
}

// ---------- events ----------
// ---------- panel size: drag the right edge; Tasks opens big so the whole board fits ----------
const mainW = () => ($('.main') || document.body).clientWidth;
const defaultPanelW = v => ['tasks', 'channels'].includes(v) ? Math.max(600, mainW() - 280) : v === 'groups' ? 760 : 600;
function sizePanel() {
  const view = $('#view'), grip = $('#vgrip'), open = !view.hidden, phone = window.innerWidth < 760;
  grip.hidden = !open || phone;
  if (!open || phone) { view.style.width = ''; return; }
  const max = mainW() - 28 - (selected ? 390 : 0), want = (ui.vw && ui.vw[ui.view]) || defaultPanelW(ui.view);
  view.style.width = Math.max(360, Math.min(max, want)) + 'px';
  grip.style.left = (view.offsetLeft + view.offsetWidth - 5) + 'px';
}
window.addEventListener('resize', sizePanel);
(() => {
  const grip = $('#vgrip'); let startX = 0, startW = 0;
  const setW = w => { ui.vw = ui.vw || {}; ui.vw[ui.view] = Math.round(w); sizePanel(); };
  grip.addEventListener('pointerdown', e => { e.preventDefault(); grip.setPointerCapture(e.pointerId); startX = e.clientX; startW = $('#view').offsetWidth; grip.classList.add('on'); });
  grip.addEventListener('pointermove', e => { if (grip.classList.contains('on')) setW(startW + e.clientX - startX); });
  grip.addEventListener('pointerup', () => { grip.classList.remove('on'); saveUi(); });
  grip.addEventListener('dblclick', () => { if (ui.vw) delete ui.vw[ui.view]; sizePanel(); saveUi(); });
  grip.addEventListener('keydown', e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); setW($('#view').offsetWidth + (e.key === 'ArrowRight' ? 40 : -40)); saveUi(); } });
})();

// ---------- click outside a panel closes it ----------
function closePanels() {
  let changed = false;
  if (selected) { selected = null; drawerMode = null; changed = true; }
  if (ui.view !== 'hq') { ui.view = 'hq'; openForm = null; changed = true; }
  if (changed) render();
}
document.addEventListener('click', e => {
  const t = e.target;
  // inside a panel, the nav, the resize grip, the clock, a toast, a name tag (opens a person), or the 3D canvas (handled on pointerup)
  if (!t.isConnected || t.closest('#view, #drawer, .nav, #vgrip, .clockwrap, #toast, .lbl, .ctrls, #stage canvas')) return;
  closePanels();
});

function selectWorker(id, mode) { selected = id; drawerMode = mode || null; render(); }
function closeDrawer() { selected = null; drawerMode = null; render(); }
const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
const focus = id => { const el = document.getElementById(id); if (el) el.focus(); };
function taskAction(taskId, fn) { pendingTasks.add(taskId); render(); fn().catch(() => { pendingTasks.delete(taskId); render(); }); }

document.addEventListener('click', e => {
  const nv = e.target.closest('[data-nav]');
  if (nv) { ui.view = nv.dataset.nav; openForm = null; render(); $('#view').scrollTop = 0; return; }
  const b = e.target.closest('[data-act]'); if (!b || !b.closest('#app')) return;
  const id = b.dataset.id, act = b.dataset.act, n = db.needs.find(x => x.id === id);
  switch (act) {
    case 'approve': taskAction(n.task, () => post(`/api/tasks/${n.task}/status`, { state: 'approved' }).then(() => toast(`Approved in ClickUp.`))); return;
    case 'form': openForm = openForm === id && openFormKind === b.dataset.f ? null : id; openFormKind = b.dataset.f; render(); focus('nf-' + id); return;
    case 'formSend': {
      const v = val('nf-' + id); if (!v && openFormKind !== 'decline') return focus('nf-' + id);
      const k = openFormKind; openForm = null;
      if (k === 'changes') taskAction(n.task, () => post(`/api/tasks/${n.task}/status`, { state: 'changes_requested', note: v }).then(() => toast(`Sent back to ${Wx(n.from).name}.`)));
      else if (k === 'decide') taskAction(n.task, () => post(`/api/tasks/${n.task}/status`, { state: 'in_progress', note: v }).then(() => toast(`Decision sent. ${Wx(n.from).name} is unblocked.`)));
      else { pendingNeeds.add(id); render(); post(`/api/needs/${id}/resolve`, { action: k === 'reply' ? 'reply' : 'decline', text: v }).then(() => toast(k === 'reply' ? 'Reply posted.' : 'Declined.')).catch(() => { pendingNeeds.delete(id); render(); }); }
      return;
    }
    case 'mailDone': pendingNeeds.add(id); render(); post(`/api/needs/${id}/resolve`, { action: 'done' }).then(() => toast('Done. It comes back if they write again.')).catch(() => { pendingNeeds.delete(id); render(); }); return;
    case 'confirm': pendingNeeds.add(id); render(); post(`/api/needs/${id}/resolve`, { action: 'confirm' }).then(() => toast('Confirmed.')).catch(() => { pendingNeeds.delete(id); render(); }); return;
    case 'pick': selected === id ? closeDrawer() : selectWorker(id); return;
    case 'close': closeDrawer(); return;
    case 'assign': selectWorker(id, 'instr'); focus('di-' + id); return;
    case 'viewTasks': ui.view = 'tasks'; if (W(id).is_owner) ui.tscope = 'mine'; else { ui.tscope = 'all'; ui.tperson = id; } break;
    case 'scope': ui.tscope = id; if (id === 'mine') ui.tperson = ''; break;
    case 'tview': ui.tview = id; ui.addIn = null; break;
    case 'addIn': ui.addIn = id; render(); focus('ai-' + id); return;
    case 'tmonth': { if (id === '0') ui.tmonth = ''; else { const d = ui.tmonth ? new Date(ui.tmonth + '-01T00:00:00') : new Date(); d.setDate(1); d.setMonth(d.getMonth() + Number(id)); ui.tmonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); } break; }
    case 'ntToggle': newTaskOpen = !newTaskOpen; render(); focus('nt-name'); return;
    case 'ntCreate': {
      const name = val('nt-name'); if (!name) return focus('nt-name');
      post('/api/tasks', { name, assignee: val('nt-who'), list_id: val('nt-list'), priority: val('nt-prio'), due: val('nt-due'), state: 'todo' }).then(() => { newTaskOpen = false; toast('Created in ClickUp.'); render(); }).catch(() => { });
      return;
    }
    case 'dMsgOpen': selectWorker(id, 'msg'); focus('dm-' + id); return;
    case 'dMsg': drawerMode = drawerMode === 'msg' ? null : 'msg'; render(); focus('dm-' + id); return;
    case 'dmSend': { const v = val('dm-' + id); if (!v) return focus('dm-' + id); post(`/api/workers/${id}/message`, { text: v }).then(() => { document.getElementById('dm-' + id).value = ''; drawerMode = null; toast(`Sent to ${W(id).name} in Slack.`); render(); }).catch(() => { }); return; }
    case 'dInstr': drawerMode = drawerMode === 'instr' ? null : 'instr'; render(); focus('di-' + id); return;
    case 'dSend': { const v = val('di-' + id); if (!v) return focus('di-' + id); post('/api/tasks', { name: v.slice(0, 200), assignee: id, state: 'todo' }).then(() => { drawerMode = null; toast(`Assigned to ${W(id).name} in ClickUp.`); render(); }).catch(() => { }); return; }
    case 'myStatus': post(`/api/workers/${OWNER().id}/status`, { status: id }).then(j => toast(j.slack === 'ok' ? 'Status set in HQ and in Slack.' : j.slack === 'off' ? 'Status set in HQ. Add SLACK_USER_TOKEN to sync it to Slack too.' : 'Set in HQ. Slack said: ' + j.slack)).catch(() => { }); return;
    case 'sim': post('/api/sim/' + id).catch(() => { }); return;
    case 'chRefresh': loadChannels(true); if (ui.chSel) loadMessages(ui.chSel, ui.chThread || null, true); toast('Refreshing…'); return;
    case 'chOpen': ui.view = 'channels'; ui.chSel = id; ui.chThread = null; stickBottom = true; break;
    case 'chThread': ui.chThread = id; stickBottom = false; break;
    case 'chBack': ui.chThread = null; stickBottom = true; break;
    case 'gNew': gDraft = { name: '', style: 'glass', color: GROUP_COLORS[(db.groups || []).length % GROUP_COLORS.length], members: new Set(), q: '' }; render(); focus('g-name'); return;
    case 'gEdit': { const g = (db.groups || []).find(x => x.id === id); if (g) gDraft = { id: g.id, name: g.name, style: g.style, color: g.color, members: new Set(g.members), q: '' }; render(); $('#view').scrollTop = 0; focus('g-name'); return; }
    case 'gCancel': gDraft = null; break;
    case 'gSave': saveGroup(); return;
    case 'gDelete': { const g = (db.groups || []).find(x => x.id === id); if (g && confirm(`Delete the group "${g.name}"? People stay in HQ and move to Everyone else.`)) post(`/api/groups/${id}/delete`).then(() => { gDraft = null; toast('Group deleted.'); render(); }).catch(() => { }); return; }
    case 'gColor': if (gDraft) { gDraft.name = val('g-name'); gDraft.color = id; } break;
    case 'gStyle': if (gDraft) { gDraft.name = val('g-name'); gDraft.style = id; } break;
    case 'gToggle': ui.gOpen = ui.gOpen === id ? null : id; break;
    case 'gFocus': ui.view = 'hq'; render(); focusGroup(id); return;
    case 'gTasks': ui.view = 'tasks'; ui.tscope = 'all'; ui.tperson = 'g:' + id; break;
    case 'sync': toast('Syncing…'); post('/api/sync').then(() => toast('Synced.')).catch(() => { }); return;
  }
  render();
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'demoToggle') { simOn = el.checked; post('/api/demo', { on: simOn }).catch(() => { }); return; }
  if (['tgroup', 'tperson', 'tlist', 'tprio', 'tsort'].includes(el.id)) { ui[el.id] = el.value; ui.addIn = null; render(); return; }
  if (el.dataset.gmember && gDraft) { gDraft.name = val('g-name'); el.checked ? gDraft.members.add(el.dataset.gmember) : gDraft.members.delete(el.dataset.gmember); render(); return; }
  if (el.dataset.cust) { const tid = el.dataset.cust; taskAction(tid, () => post(`/api/tasks/${tid}/status`, { clickup_status: el.value })); return; }
  if (el.dataset.state) { const tid = el.dataset.state; taskAction(tid, () => post(`/api/tasks/${tid}/status`, { state: el.value })); return; }
  if (el.dataset.map) { post('/api/statusmap', { list_id: el.dataset.map, clickup_status: el.dataset.status, hq_state: el.value }).catch(() => { }); return; }
  if (el.dataset.match) { toast('Re-matching…'); post('/api/matches', { slack_user_id: el.dataset.match, clickup_user_id: el.value }).catch(() => { }); }
});
document.addEventListener('input', e => {
  if (e.target.id === 'tq' || e.target.id === 'cq') { ui[e.target.id] = e.target.value; render(); }
  if (gDraft && e.target.id === 'g-name') gDraft.name = e.target.value;
  if (gDraft && e.target.id === 'g-q') { gDraft.q = e.target.value; render(); }
});
// Board column key -> the status body for a write: "cu:<ClickUp status>" or "hq:<HQ state>"
const colStatus = key => key.startsWith('cu:') ? { clickup_status: key.slice(3) } : { state: key.slice(3) };
document.addEventListener('keydown', e => {
  const col = e.target.dataset && e.target.dataset.addcol; if (!col) return;
  if (e.key === 'Escape') { e.stopPropagation(); ui.addIn = null; render(); return; }
  if (e.key !== 'Enter') return;
  const name = e.target.value.trim(); if (!name) return;
  const who = addAssignee();
  post('/api/tasks', { name, assignee: who && who.id, list_id: ui.tlist || undefined, ...colStatus(col) }).then(() => { toast('Created in ClickUp.'); ui.addIn = null; render(); }).catch(() => { });
  e.target.value = '';
}, true);
// drag a card to another column to change its status (only your own tasks are draggable)
document.addEventListener('dragstart', e => { const c = e.target.closest && e.target.closest('[data-drag]'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.drag); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); } });
document.addEventListener('dragend', e => { const c = e.target.closest && e.target.closest('[data-drag]'); if (c) c.classList.remove('dragging'); document.querySelectorAll('.bcol.over').forEach(x => x.classList.remove('over')); });
document.addEventListener('dragover', e => { const c = e.target.closest && e.target.closest('.bcol'); if (c) { e.preventDefault(); document.querySelectorAll('.bcol.over').forEach(x => x !== c && x.classList.remove('over')); c.classList.add('over'); } });
document.addEventListener('drop', e => {
  const c = e.target.closest && e.target.closest('.bcol'); if (!c) return; e.preventDefault(); c.classList.remove('over');
  const t = TK(e.dataTransfer.getData('text/plain')); if (!t || !canEdit(t)) return;
  const key = c.dataset.col, same = key.startsWith('cu:') ? key.slice(3).toLowerCase() === String(t.clickup_status).toLowerCase() : key.slice(3) === hqState(t);
  if (!same) taskAction(t.id, () => post(`/api/tasks/${t.id}/status`, colStatus(key)));
});
document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (selected) closeDrawer(); else if (ui.view !== 'hq') { ui.view = 'hq'; render(); } });

// ---------- command bar ----------
// [teammate name or role keyword, regex]. First match wins; unmatched goes to you.
const ROUTES = [
  ['automation', /automat|zap|workflow|integrat|crm|gohighlevel|ghl|build/i], ['design', /design|logo|graphic|canva|banner|slide|mockup|brand|homepage|landing/i],
  ['outreach', /linkedin|outreach|prospect|cold/i], ['support', /inbound|course|academy|student|dm|question/i], ['sales', /lead|proposal|deal|follow.?up|quote|price|sales/i],
  ['operations', /report|email|reply|calendar|schedule|meeting|inbox|invoice/i], ['qa', /audit|qa|compliance|policy|sop|check/i]
];
function route(txt) {
  for (const [key, re] of ROUTES) if (re.test(txt)) {
    const w = db.workers.find(x => !x.is_owner && (x.clickup_user_id || db.mode.demo) && ((x.role + ' ' + x.department + ' ' + x.name).toLowerCase().includes(key)));
    if (w) return w;
  }
  return OWNER();
}
async function sendCmd() {
  const el = $('#cmd'), v = el.value.trim(); if (!v) return el.focus();
  const w = route(v); const b = $('#send'); b.disabled = true;
  try { await post('/api/tasks', { name: v.slice(0, 200), assignee: w && w.id, state: 'todo' }); el.value = ''; $('#routeHint').textContent = `Last one went to ${w ? w.name : 'the default list'} as a ClickUp task.`; toast(`Created for ${w ? w.name : 'you'}.`); } catch { }
  b.disabled = false;
}
$('#send').addEventListener('click', sendCmd);
$('#cmd').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCmd(); } });
setInterval(() => { if (['integrations', 'needs'].includes(ui.view)) render(); }, 30000);

// ---------- bell reminder: rings every 30 min while something is waiting on you ----------
let ringUntil = 0, audio = null;
// browsers only allow sound after you've interacted with the page once
document.addEventListener('pointerdown', () => { if (!audio && window.AudioContext) try { audio = new AudioContext(); } catch { } }, { once: true });
function chime() {
  if (!audio) return;
  try {
    if (audio.state === 'suspended') audio.resume();
    [[880, 0], [1320, .18]].forEach(([f, at]) => {
      const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + at;
      o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.12, t0 + .02); g.gain.exponentialRampToValueAtTime(.0001, t0 + .9);
      o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + 1);
    });
  } catch { }
}
function ringBell() {
  const n = openNeeds().length; if (!n) return;
  ringUntil = performance.now() + 6000; chime();
  const el = $('#nav-needs'); if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
  toast(`${n} item${n === 1 ? '' : 's'} still need${n === 1 ? 's' : ''} you.`);
}
setInterval(ringBell, 30 * 60000);

// ---------- clock + today's schedule (your computer's time; events from Google Calendar) ----------
const cal = { at: 0, data: null, loading: false };
function tickClock() {
  const d = new Date(), el = $('#clock');
  el.innerHTML = `<span class="cicon" aria-hidden="true"><em>${d.toLocaleDateString([], { month: 'short' })}</em><b>${d.getDate()}</b></span>
    <span class="ctext"><b>${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</b><small>${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</small></span>
    <svg class="ic chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
  el.setAttribute('aria-label', `${d.toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })}. Show today's schedule`);
}
tickClock(); setInterval(tickClock, 15000);
function loadCalendar(force) {
  if (cal.loading || (!force && cal.data && Date.now() - cal.at < 5 * 60000)) return renderCal();
  const from = new Date(); from.setHours(0, 0, 0, 0); const to = new Date(from); to.setDate(to.getDate() + 1);
  cal.loading = true; renderCal();
  fetch(`/api/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`).then(r => r.json())
    .then(j => { Object.assign(cal, { loading: false, at: Date.now(), data: j }); renderCal(); })
    .catch(e => { Object.assign(cal, { loading: false, data: { ok: false, error: e.message, events: [] } }); renderCal(); });
}
function renderCal() {
  const pop = $('#clockpop'); if (pop.hidden) return;
  const j = cal.data, now = Date.now();
  const tm = iso => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  let body;
  if (!j) body = '<p class="hint">Loading your schedule…</p>';
  else if (!j.enabled) body = `<div class="cpempty"><b>Connect Google Calendar</b><p>Add <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> to <code>.env</code>, restart HQ, then connect here to see today's meetings.</p></div>`;
  else if (!j.connected) body = `<div class="cpempty"><b>See today's schedule here</b><p>Connect your Google account once. HQ only reads your calendar and email: it never sends, deletes or changes anything.</p><a class="btn primary" href="/auth/google">Connect Google</a></div>`;
  else if (!j.ok) body = `<div class="cpempty"><b>Couldn't load your calendar</b><p>${esc(j.error || '')}</p><a class="btn" href="/auth/google">Reconnect</a></div>`;
  else if (!j.events.length) body = '<div class="cpempty"><b>Nothing on your calendar today.</b></div>';
  else body = `<ol class="evs">${j.events.map(e => {
    const s = new Date(e.start).getTime(), en = new Date(e.end).getTime(), state = e.allDay ? '' : now > en ? ' past' : now >= s ? ' now' : '';
    return `<li class="ev1${state}${e.declined ? ' declined' : ''}"><span class="evt">${e.allDay ? 'All day' : `${tm(e.start)}<small>${tm(e.end)}</small>`}</span>
      <span class="evb"><a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(e.title)}</a>${e.location ? `<small>${esc(e.location)}</small>` : ''}${state === ' now' ? '<em>Now</em>' : ''}</span>
      ${e.meet ? `<a class="btn join" href="${esc(e.meet)}" target="_blank" rel="noopener">Join</a>` : ''}</li>`;
  }).join('')}</ol>`;
  const d = new Date();
  pop.innerHTML = `<div class="cphead"><div><b>Today</b><small>${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</small></div>${j && j.connected ? `<button class="xbtn sm" data-cal="refresh" aria-label="Refresh">${ic('sync')}</button>` : ''}</div>${body}
    ${j && j.connected && !j.gmail ? `<div class="cpnote">Reconnect once to add Gmail to Needs you. <a href="/auth/google">Reconnect</a></div>` : ''}${j && j.connected ? `<div class="cpfoot"><span>${esc(j.email || 'Google Calendar')}</span><button class="linkbtn" data-cal="disconnect">Disconnect</button></div>` : ''}`;
}
function toggleCal(open) {
  const pop = $('#clockpop'), btn = $('#clock'); open = open === undefined ? pop.hidden : open;
  pop.hidden = !open; btn.setAttribute('aria-expanded', String(open));
  if (open) loadCalendar();
}
$('#clock').addEventListener('click', () => toggleCal());
$('#clockpop').addEventListener('click', e => {
  const b = e.target.closest('[data-cal]'); if (!b) return;
  if (b.dataset.cal === 'refresh') loadCalendar(true);
  if (b.dataset.cal === 'disconnect') post('/api/google/disconnect').then(() => { cal.data = null; loadCalendar(true); toast('Google Calendar disconnected.'); }).catch(() => { });
});
document.addEventListener('click', e => { if (!$('#clockpop').hidden && !e.target.closest('.clockwrap')) toggleCal(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#clockpop').hidden) { toggleCal(false); $('#clock').focus(); } });
setInterval(() => { if (!$('#clockpop').hidden) loadCalendar(); }, 60000);
if (new URLSearchParams(location.search).get('google') === 'connected') { history.replaceState(null, '', '/'); toggleCal(true); toast('Google Calendar connected.'); }
fetch('/api/demo').then(r => r.json()).then(j => { simOn = j.on; }).catch(() => { });

// =====================================================================
// 3D OFFICE — reads the store, never writes it.
// =====================================================================
let syncScene = () => { }, focusGroup = () => { };
let stickBottom = true; // open a channel at its newest message
if (!window.THREE) { connect(); render(); }
else initScene();

function initScene() {
  const THREE = window.THREE;
  const stage = $('#stage'), labelsEl = $('#labels'), hoverEl = $('#hover');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  stage.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const dark = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
  const GRASS = dark ? 0x7E9A45 : 0xA7C25A;
  scene.background = new THREE.Color(GRASS); stage.style.background = hexOf(GRASS);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, .1, 300);
  const DEF_THETA = Math.PI * 0.09; let theta = DEF_THETA, zoom = 1;
  const camTarget = new THREE.Vector3(); let camAnim = null; // the point the camera looks at; groups can pan to it
  const placeCam = () => { const r = 60; cam.position.set(camTarget.x + Math.sin(theta) * r, r * 0.8, camTarget.z + Math.cos(theta) * r); cam.lookAt(camTarget); cam.zoom = zoom; cam.updateProjectionMatrix(); };
  let office = null, L = null; // 3D office group + its floor plan
  // fit the whole floor: its footprint as seen from the camera, plus a margin for the overlays
  const resize = () => {
    const w = stage.clientWidth || 1, h = stage.clientHeight || 1, asp = w / h; renderer.setSize(w, h, false);
    const TW = (L && L.TW) || 16.4, D = 10.4, ct = Math.abs(Math.cos(DEF_THETA)), st = Math.abs(Math.sin(DEF_THETA));
    const half = 1.12 * Math.max(((TW * st + D * ct) * .625 + 1.6) / 2, (TW * ct + D * st) / 2 / asp); cam.left = -half * asp; cam.right = half * asp; cam.top = half; cam.bottom = -half; placeCam(); };
  new ResizeObserver(resize).observe(stage);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7a8a4a, .72));
  const sun = new THREE.DirectionalLight(0xffffff, .78); sun.position.set(14, 24, 10); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 }); sun.shadow.bias = -0.0008; scene.add(sun);
  const mats = {};
  const mat = (c, o) => { const k = c + '|' + (o || 1); if (!mats[k]) mats[k] = new THREE.MeshLambertMaterial({ color: c, transparent: !!o && o < 1, opacity: o || 1 }); return mats[k]; };
  const box = (w, h, d, c, x, y, z, parent, o) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), o && o < 1 ? mat(c, o) : mat(c)); m.position.set(x, y, z); m.castShadow = !(o && o < 1); m.receiveShadow = true; (parent || scene).add(m); return m; };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), mat(GRASS)); ground.rotation.x = -Math.PI / 2; ground.position.y = -.3; ground.receiveShadow = true; scene.add(ground);
  const V = (x, z) => new THREE.Vector3(x, 0, z);

  // ---- floor plan, sized to the team ----
  // left → right: front door | open office (one desk each) | Meeting room (top) + Pantry (bottom).
  // Everyone walks along the aisle at z = 0, which runs through the door gaps in each wall.
  // Offline people walk out the front door and disappear; they walk back in when they come online.
  const zoneLbl = (t, s) => { const el = document.createElement('div'); el.className = 'lbl zone'; labelsEl.appendChild(el); const z = { el, x: 0, y: 1.3, z: 0 }; z.set = sub => { el.innerHTML = `<span>${t}<small>${sub}</small></span>`; }; z.set(s); return z; };
  const ZONES = { meet: zoneLbl('Meeting room', 'in a meeting'), pantry: zoneLbl('Pantry', 'on break') };
  // Groups become sections of desks, right to left from the meeting room: each group, then "Everyone else".
  function sectionsFor(list) {
    const gs = (db.groups || []).map(g => ({ id: g.id, name: g.name, style: g.style, color: g.color, people: list.filter(w => g.members.includes(w.id)) }));
    const inGroup = new Set(gs.flatMap(g => g.people.map(w => w.id)));
    const rest = list.filter(w => !inGroup.has(w.id));
    if (rest.length || !gs.length) gs.push({ id: null, name: gs.length ? 'Everyone else' : '', style: 'glass', color: null, people: rest });
    gs.forEach(s => { s.cols = Math.max(1, Math.ceil(s.people.length / 4)); });
    const total = gs.reduce((a, s) => a + s.cols, 0); if (total < 3) gs[gs.length - 1].cols += 3 - total;
    return gs;
  }
  const mixHex = (a, b, t) => { const p = c => [c >> 16 & 255, c >> 8 & 255, c & 255], x = p(a), y = p(b); return x.reduce((acc, v, i) => (acc << 8) | Math.round(v + (y[i] - v) * t), 0); };
  let groupLbls = [];
  function buildOffice(list) {
    if (office) { scene.remove(office); office.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    groupLbls.forEach(z => z.el.remove()); groupLbls = [];
    office = new THREE.Group(); scene.add(office);
    const ob = (w, h, d, c, x, y, z, o) => box(w, h, d, c, x, y, z, office, o);
    const sections = sectionsFor(list), GAP = 1.2, deskCols = sections.reduce((a, s) => a + s.cols, 0);
    const OW = deskCols * 2.2 + GAP * (sections.length - 1) + .8, RW = 5.4, TW = OW + RW, H = 5.1;
    const xL = -TW / 2, xS = xL, xR = xS + OW, xE = xL + TW;
    L = { TW, desks: [], deskFor: {}, sections: [], meet: [], pantry: [], exit: { pos: V(xL - 2.2, 0), approach: [] } };
    // floors + walls (door gaps at |z| < 1; the left one is the front door)
    ob(TW + .4, .3, 10.4, 0xEDE7DC, 0, -.15, 0);
    ob(OW - .1, .02, 10, 0xE2D2B2, xS + OW / 2, .01, 0);
    ob(RW - .3, .02, 4.8, 0xC9C2DA, xR + RW / 2, .012, -2.6);
    ob(RW - .3, .02, 4.8, 0xEADFCB, xR + RW / 2, .012, 2.6);
    ob(TW + .4, 1.3, .2, 0xCFC6B6, 0, .65, -H);
    ob(.2, 1.3, 4.2, 0xCFC6B6, xL - .1, .65, -3.1); ob(.2, 1.3, 4.2, 0xCFC6B6, xL - .1, .65, 3.1);
    ob(1.8, .02, 1.6, 0x8C8577, xL - 1.0, .01, 0); // doormat + path outside the front door
    ob(.14, 1.1, 4.1, 0xDCD5C8, xR, .55, -3.05); ob(.14, 1.1, 4.1, 0xDCD5C8, xR, .55, 3.05);
    ob(RW - 1.3, 1.1, .14, 0xDCD5C8, xR + 1.3 + (RW - 1.3) / 2, .55, 0);

    // desks, one section per group: rows next to the aisle fill first; you get the first desk of your section
    let right = xR - .4;
    sections.forEach((sec, si) => {
      const width = sec.cols * 2.2, cx = right - width / 2, col = sec.color ? colorNum(sec.color) : null;
      if (col != null) ob(width - .1, .015, 9.7, col, cx, .024, 0, .22); // the group's floor
      const panel = col != null ? mixHex(col, 0x8C8577, .55) : 0x8C8577;
      for (let i = 0; i < sec.cols * 4; i++) {
        const c = Math.floor(i / 4), row = i % 4, x = right - 1.1 - c * 2.2, w = sec.people[i];
        const z = [-1.1, 1.1, -4.0, 4.0][row], f = [1, -1, -1, 1][row], own = !!(w && w.is_owner);
        const g = new THREE.Group(); g.position.set(x, 0, z); office.add(g);
        box(1.6, .08, .8, own ? 0xE9DFC8 : 0xF4EFE6, 0, .72, 0, g); box(.06, .7, .7, 0xB8A58A, -.74, .36, 0, g); box(.06, .7, .7, 0xB8A58A, .74, .36, 0, g);
        box(.66, .4, .05, 0x2A2F36, 0, 1.0, f * .2, g);
        const screen = new THREE.Mesh(new THREE.PlaneGeometry(.58, .32), new THREE.MeshBasicMaterial({ color: 0x1b2026 }));
        screen.position.set(0, 1.0, f * .2 - f * .03); screen.rotation.y = f > 0 ? Math.PI : 0; g.add(screen);
        box(.12, .2, .12, 0x2A2F36, 0, .82, f * .22, g);
        if (sec.style === 'glass') box(1.9, 1.05, .05, 0xA7B8C4, 0, .52, f * .5, g, .35);
        else if (sec.style === 'cubicle') { // solid fabric walls on three sides, with a trim on top
          box(1.9, 1.3, .07, panel, 0, .65, f * .5, g); box(.07, 1.3, 1.0, panel, -.95, .65, 0, g); box(.07, 1.3, 1.0, panel, .95, .65, 0, g);
          box(1.94, .05, .1, 0x5E5A52, 0, 1.32, f * .5, g);
        } else box(.22, .26, .22, 0xC9B38F, -.6, .89, f * .1, g), box(.26, .22, .26, 0x5E9E4A, -.6, 1.12, f * .1, g); // open desk: a little plant
        box(.18, .18, .18, [0xE07A5F, 0x3D405B, 0xF2CC8F, 0x81B29A][i % 4], .55, .85, -f * .05, g);
        box(.46, .08, .46, 0x3A4450, 0, .44, -f * .85, g); box(.46, .5, .08, 0x3A4450, 0, .72, -f * 1.07, g); box(.08, .4, .08, 0x2A2F36, 0, .2, -f * .85, g);
        const seatZ = z - f * .85, desk = { pos: V(x, seatZ), rot: f > 0 ? 0 : Math.PI, screen, approach: [V(x + 1.1, 0), V(x + 1.1, seatZ)] };
        L.desks.push(desk); if (w) L.deskFor[w.id] = desk;
      }
      if (sec.name) {
        const el = document.createElement('div'); el.className = 'lbl zone grp'; if (sec.color) el.style.setProperty('--gc', sec.color); labelsEl.appendChild(el);
        groupLbls.push({ el, x: cx, y: 1.5, z: -4.75, id: sec.id, people: sec.people, name: sec.name, style: sec.style });
      }
      L.sections.push({ id: sec.id, cx, width });
      right -= width;
      if (si < sections.length - 1) { // walkway between groups, with planters
        const gx = right - GAP / 2; ob(.34, .45, 3.4, 0xB8A58A, gx, .22, -3.2); ob(.34, .45, 3.4, 0xB8A58A, gx, .22, 3.2);
        ob(.3, .3, 3.2, 0x5E9E4A, gx, .6, -3.2); ob(.3, .3, 3.2, 0x5E9E4A, gx, .6, 3.2);
        right -= GAP;
      }
    });

    // meeting room: 8 chairs around the table, then standing room
    const mx = xR + 3.0, mz = -2.6;
    ob(2.9, .08, 1.2, 0xF4EFE6, mx, .7, mz); ob(.1, .66, .1, 0xB8A58A, mx - 1.3, .35, mz); ob(.1, .66, .1, 0xB8A58A, mx + 1.3, .35, mz); ob(1.8, .9, .06, 0x2A2F36, mx, 1.2, -H + .15);
    for (const side of [1, -1]) for (const dx of [-1.05, -.35, .35, 1.05]) {
      const cz = mz + side * .95, lane = side > 0 ? -.9 : -4.45;
      ob(.4, .4, .4, 0x7B5EA7, mx + dx, .2, cz + side * .25);
      L.meet.push({ pos: V(mx + dx, cz), face: V(mx, mz), approach: [V(xR + .7, 0), V(xR + .7, lane), V(mx + dx, lane)] });
    }
    for (let k = 0; k < 7; k++) L.meet.push({ pos: V(xR + .7, -1.0 - k * .55), face: V(mx, mz), approach: [V(xR + .7, 0)] });

    // pantry: dining table + counter, fridge and coffee
    const px = xR + 3.0, pz = 2.3;
    ob(2.9, .08, 1.1, 0xC89F72, px, .7, pz); ob(.1, .66, .1, 0x8C6A48, px - 1.3, .35, pz); ob(.1, .66, .1, 0x8C6A48, px + 1.3, .35, pz);
    ob(.36, .14, .36, 0xE9EEF2, px, .81, pz); ob(.12, .12, .12, 0xE07A5F, px - .07, .92, pz); ob(.12, .12, .12, 0xF2CC8F, px + .08, .92, pz + .05); ob(.1, .1, .1, 0x81B29A, px, .93, pz - .08);
    for (const side of [-1, 1]) for (const dx of [-1.05, -.35, .35, 1.05]) {
      const cz = pz + side * .9, lane = side < 0 ? .75 : 3.85;
      ob(.36, .42, .36, 0xE07A5F, px + dx, .21, cz + side * .22);
      ob(.26, .02, .26, 0xFFFFFF, px + dx, .75, pz + side * .35);
      L.pantry.push({ pos: V(px + dx, cz), face: V(px + dx, pz), approach: [V(xR + .7, 0), V(xR + .7, lane), V(px + dx, lane)] });
    }
    const cx0 = xR + 1.4, cx1 = xE - 1.2;
    ob(cx1 - cx0, .9, .5, 0xE9E3D6, (cx0 + cx1) / 2, .45, 4.75); ob(cx1 - cx0 + .04, .06, .54, 0x8C8577, (cx0 + cx1) / 2, .93, 4.75);
    ob(.8, 1.7, .6, 0xDDE3E8, xE - .7, .85, 4.65); ob(.04, .5, .04, 0x8A949E, xE - 1.0, 1.1, 4.33);
    ob(.3, .42, .3, 0x2F343B, cx0 + .4, 1.17, 4.75); ob(.1, .1, .1, 0xFFFFFF, cx0 + .4, 1.0, 4.55);
    ob(.62, .36, .42, 0x5E6770, cx0 + 1.4, 1.14, 4.75); ob(.2, .24, .2, 0xB23A3A, cx0 + 2.2, 1.08, 4.75);
    for (let k = 0; k < 6; k++) L.pantry.push({ pos: V(cx0 + .3 + k * .55, 3.95), face: V(cx0 + .3 + k * .55, 5), approach: [V(xR + .7, 0), V(xR + .7, 3.95)] });

    // greenery
    const plant = (x, z, s = 1) => { ob(.34 * s, .34 * s, .34 * s, 0xC9B38F, x, .17 * s, z); ob(.5 * s, .6 * s, .5 * s, 0x5E9E4A, x, .64 * s, z); };
    plant(xL + .4, -4.7); plant(xL - .5, 1.4); plant(xL - .5, -1.4); plant(xR - .3, -4.7); plant(xE - .4, -4.6, 1.2); plant(xL + .4, 4.7);
    const tree = (x, z, s) => { ob(.3 * s, 1 * s, .3 * s, 0x7A5230, x, .5 * s - .3, z); ob(1.3 * s, 1.2 * s, 1.3 * s, 0x4F8A3C, x, 1.4 * s - .3, z); ob(.8 * s, .6 * s, .8 * s, 0x6BAA4B, x, 2.2 * s - .3, z); };
    [[xL - 3, -7, 1.1], [xE + 2.5, -6, 1], [xE + 3.5, 3, 1.3], [xL - 3.5, 5, 1], [0, 9, .9], [xL + 4, -9, 1.2], [xE - 2, 8, 1.1], [xL + 1, 9, .8], [TW * .2, -9, 1]].forEach(p => tree(...p));

    Object.assign(ZONES.meet, { x: xR + RW / 2, z: -4.7 }); Object.assign(ZONES.pantry, { x: xR + RW / 2, z: 4.9 });
    Object.assign(sun.shadow.camera, { left: -TW / 2 - 2, right: TW / 2 + 2 }); sun.shadow.camera.updateProjectionMatrix();
    resize();
  }

  // avatars are (re)built whenever the set of people in the office changes
  let view3 = {}, clickMeshes = [], seatedKey = '', hovered = null;
  function seated() {
    // everyone in Slack (ClickUp-only people have no presence to show); you first so you get the desk by the door
    const own = db.workers.find(w => w.is_owner);
    const rest = db.workers.filter(w => !w.is_owner && (w.slack_user_id || db.mode.slack !== 'live')).sort((a, b) => a.name.localeCompare(b.name));
    return own ? [own, ...rest] : rest;
  }
  const ROOM = { meeting: 'meet', break: 'pantry' };
  function assignSlots(list) {
    // meeting room and pantry seats are shared: keep your seat while you stay, newcomers take the first free one
    for (const [st, room] of Object.entries(ROOM)) {
      const here = list.map(w => view3[w.id]).filter(v => v && v.status === st), used = new Set(here.map(v => v.slot).filter(s => s != null));
      for (const v of here) if (v.slot == null) { let k = 0; while (used.has(k)) k++; v.slot = k; used.add(k); }
    }
    for (const w of list) { const v = view3[w.id]; if (v && !ROOM[v.status]) v.slot = null; }
  }
  function spotFor(v, st) {
    if (st === 'offline') return L.exit;
    if (ROOM[st]) { const a = L[ROOM[st]]; return a[(v.slot || 0) % a.length]; }
    return L.deskFor[v.id] || L.desks[v.idx % L.desks.length];
  }
  function buildAvatars(list) {
    for (const v of Object.values(view3)) { scene.remove(v.g); v.lbl.remove(); }
    view3 = {}; clickMeshes = [];
    list.forEach((w, i) => {
      const g = new THREE.Group(); scene.add(g); const inner = new THREE.Group(); g.add(inner);
      const col = colorNum(w.color), hair = [0x2B1B12, 0x5A3A1E, 0x151515, 0x3B2314, 0x6B4423, 0xC9A15B][i % 6];
      const legs = box(.34, .42, .22, 0x2F3B4A, 0, .21, 0, inner), body = box(.44, .46, .28, col, 0, .66, 0, inner), headM = box(.32, .32, .32, 0xE5B48B, 0, 1.06, 0, inner);
      box(.34, .1, .34, hair, 0, 1.25, 0, inner); box(.34, .2, .08, hair, 0, 1.12, -.14, inner); box(.1, .36, .12, col, -.27, .66, 0, inner); box(.1, .36, .12, col, .27, .66, 0, inner);
      // focus: headphones · break: a bowl of food
      const phones = new THREE.Group(); inner.add(phones); box(.4, .06, .08, 0x2A2F36, 0, 1.26, 0, phones); box(.08, .16, .14, 0xD9622B, -.2, 1.08, 0, phones); box(.08, .16, .14, 0xD9622B, .2, 1.08, 0, phones); phones.visible = false;
      const food = new THREE.Group(); inner.add(food); box(.2, .08, .2, 0xFFFFFF, 0, .8, .28, food); box(.14, .04, .14, 0xE9A23B, 0, .85, .28, food); food.visible = false;
      const marker = box(.16, .16, .16, 0xE6A04A, 0, 1.62, 0, g); marker.visible = false;
      let bell = null;
      if (w.is_owner) {
        bell = new THREE.Group(); bell.position.y = 1.72; g.add(bell); const bm = new THREE.MeshLambertMaterial({ color: 0xF2B233 });
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(.07, .2, .24, 12), bm); cup.position.y = -.1; bell.add(cup);
        const lip = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, .04, 12), bm); lip.position.y = -.23; bell.add(lip);
        const clap = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 8), new THREE.MeshLambertMaterial({ color: 0xB23A3A })); clap.position.y = -.28; bell.add(clap); bell.visible = false;
      }
      const ring = new THREE.Mesh(new THREE.RingGeometry(.42, .52, 24), new THREE.MeshBasicMaterial({ color: 0x1F2A1C, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = .04; ring.visible = false; g.add(ring);
      [legs, body, headM].forEach(m => { m.userData.id = w.id; clickMeshes.push(m); });
      const lbl = document.createElement('button'); lbl.className = 'lbl'; lbl.type = 'button'; labelsEl.appendChild(lbl);
      lbl.addEventListener('click', () => selectWorker(w.id));
      lbl.addEventListener('mouseenter', () => { hovered = w.id; }); lbl.addEventListener('mouseleave', () => { if (hovered === w.id) hovered = null; });
      lbl.addEventListener('focus', () => { hovered = w.id; }); lbl.addEventListener('blur', () => { if (hovered === w.id) hovered = null; });
      view3[w.id] = { g, inner, phones, food, marker, bell, ring, lbl, status: displayStatus(w), slot: null, at: null, path: [], phase: Math.random() * 6, idx: i, id: w.id };
    });
    assignSlots(list);
    for (const v of Object.values(view3)) { v.at = spotFor(v, v.status); v.g.position.copy(v.at.pos); v.g.visible = v.status !== 'offline'; }
  }
  function goTo(v, spot) {
    const p = [], cur = v.g.position;
    v.g.visible = true; // coming back in through the front door, or already inside
    if (v.path.length) p.push(V(cur.x, 0)); else if (v.at) p.push(...v.at.approach.slice().reverse());
    p.push(...spot.approach, spot.pos);
    v.path = p.map(q => q.clone()); v.at = spot;
  }
  const emo = statusIcon;
  // profile picture (or initial) with the status dot on its bottom-right corner, like Slack
  const tagAvatar = (w, st) => `<span class="lav${w.avatar_url ? ' img' : ''}" style="background-color:${hexOf(w.color)}${w.avatar_url ? `;background-image:url('${esc(w.avatar_url)}')` : ''}">${esc(w.name[0])}<i style="background:${STATUS_HEX[st]}" title="${STATUS_LBL[st]}"></i></span>`;
  syncScene = function () {
    // rebuild when people or groups change (who's in which group, a group's style, color or name)
    const list = seated(), key = list.map(w => w.id).join(',') + '|' + JSON.stringify((db.groups || []).map(g => [g.id, g.name, g.style, g.color, g.members]));
    if (key !== seatedKey) { seatedKey = key; buildOffice(list); buildAvatars(list); }
    for (const z of groupLbls) { const inNow = z.people.filter(w => displayStatus(W(w.id) || w) !== 'offline').length; z.el.innerHTML = `<span>${esc(z.name)}<small>${inNow} in · ${z.people.length} ${z.people.length === 1 ? 'person' : 'people'}${z.id ? ' · ' + STYLE_LBL[z.style] : ''}</small></span>`; }
    const unread = unreadNeeds().length, needs = openNeeds().length, count = { offline: 0, meeting: 0, break: 0 };
    const moved = [];
    for (const w of list) { const v = view3[w.id], st = displayStatus(w); if (!v) continue; if (st in count) count[st]++; if (st !== v.status) { if (ROOM[v.status] !== ROOM[st]) v.slot = null; v.status = st; moved.push(v); } }
    assignSlots(list);
    for (const v of moved) goTo(v, spotFor(v, v.status));
    ZONES.meet.set(`${count.meeting} in a meeting`); ZONES.pantry.set(`${count.break} on break`);
    for (const w of list) {
      const v = view3[w.id]; if (!v) continue;
      const st = v.status, cur = currentTask(w.id), att = attention(w.id), gone = st === 'offline' && !v.path.length;
      v.ring.visible = selected === w.id;
      v.lbl.className = 'lbl' + (selected === w.id ? ' sel' : '') + (att ? ' attn' : '') + (gone ? ' off' : '');
      const first = esc(w.is_owner ? 'You' : w.name.split(' ')[0]);
      v.lbl.innerHTML = `${tagAvatar(w, st)}<span>${first}${w.is_owner && needs ? `<span class="bdg">${needs}</span>` : ''}<small>${esc(ROOM[st] || st === 'focus' ? STATUS_LBL[st] + (w.slack_status_text ? ' · ' + short(w.slack_status_text, 24) : '') : cur ? short(cur.name, 30) : STATUS_LBL[st])}</small></span>${emo(w)}`;
      v.lbl.setAttribute('aria-label', `${w.name}, ${STATUS_LBL[st]}${w.slack_status_text ? ', ' + w.slack_status_text : ''}${cur ? ', ' + cur.name : ''}`);
      const ts = cur ? hqState(cur) : null, desk = L.deskFor[w.id] || L.desks[v.idx % L.desks.length];
      desk.screen.material.color.setHex(['offline', 'meeting', 'break', 'away'].includes(st) ? 0x1b2026 : st === 'focus' ? 0xE9A46B : ts === 'in_progress' || ts === 'changes_requested' ? 0x6FA8DC : ts === 'in_review' || ts === 'blocked' ? 0xF2C27A : 0x49576A);
      v.marker.visible = !!att && !w.is_owner;
      if (v.bell) v.bell.visible = needs > 0; v.unread = unread;
    }
  };

  const cvs = renderer.domElement; let drag = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const hit = e => { const r = cvs.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam); const h = ray.intersectObjects(clickMeshes.filter(m => { let o = m; while (o.parent && o.parent !== scene) o = o.parent; return o.visible; }), false)[0]; return h ? h.object.userData.id : null; };
  cvs.addEventListener('pointerdown', e => { drag = { x: e.clientX, th: theta, moved: false }; cvs.setPointerCapture(e.pointerId); });
  cvs.addEventListener('pointermove', e => { if (drag) { const dx = e.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true; if (drag.moved) { theta = drag.th - dx * .008; placeCam(); } return; } const h = hit(e); hovered = h; cvs.style.cursor = h ? 'pointer' : 'grab'; });
  cvs.addEventListener('pointerleave', () => { if (!drag) hovered = null; });
  cvs.addEventListener('pointerup', e => { if (drag && !drag.moved) { const id = hit(e); if (id) selectWorker(id); else closePanels(); } drag = null; });
  cvs.addEventListener('pointercancel', () => { drag = null; });
  cvs.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.min(2.6, Math.max(.6, zoom * (e.deltaY < 0 ? 1.1 : .91))); placeCam(); }, { passive: false });
  $('#zin').onclick = () => { zoom = Math.min(2.6, zoom * 1.2); placeCam(); };
  $('#zout').onclick = () => { zoom = Math.max(.6, zoom / 1.2); placeCam(); };
  $('#reset').onclick = () => { theta = DEF_THETA; camAnim = { t0: performance.now(), from: camTarget.clone(), to: new THREE.Vector3(), z0: zoom, z1: 1 }; };
  // pan and zoom to a group's section of the office
  focusGroup = id => {
    const sec = L && L.sections.find(x => x.id === id); if (!sec) return;
    camAnim = { t0: performance.now(), from: camTarget.clone(), to: new THREE.Vector3(sec.cx, 0, 0), z0: zoom, z1: Math.min(2.4, Math.max(1.2, L.TW / (sec.width + 6))) };
    const z = groupLbls.find(x => x.id === id); if (z) { z.el.classList.remove('flash'); void z.el.offsetWidth; z.el.classList.add('flash'); }
  };

  const hoverHTML = w => {
    const st = displayStatus(w), c = currentTask(w.id) || nextTask(w.id), la = lastActivity(w.id), att = attention(w.id), n = openNeeds().length;
    return `<b>${esc(w.name)}<span style="font:500 11.5px 'IBM Plex Sans';color:#5F6B59">${esc(w.role || '')}</span></b>
    <div class="st"><i style="background:${STATUS_HEX[st]}"></i>${STATUS_LBL[st]}${w.slack_status_text ? ` <span class="m">· ${esc(w.slack_status_text)}</span>` : ''}${statusIcon(w)}</div>
    ${c ? `<div class="k">${currentTask(w.id) ? 'Current task' : 'Up next'}</div><div class="v">${esc(c.name)}</div><div class="m">${esc(listName(c))} · ${STATE_LBL[hqState(c)]} · ${esc(dueInfo(c.due_date).txt)}</div>` : '<div class="m">No task assigned</div>'}
    ${la ? `<div class="m" style="margin-top:6px">${esc(la.text)} · ${ago(la.ts)}</div>` : ''}
    ${!w.is_owner && att ? `<div class="amb">${att} waiting on you</div>` : ''}${w.is_owner && n ? `<div class="amb">${n} item${n === 1 ? '' : 's'} need you</div>` : ''}`;
  };
  const clock = new THREE.Clock(), tmp = new THREE.Vector3();
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const proj = (x, y, z) => { tmp.set(x, y, z).project(cam); return [(tmp.x + 1) / 2 * stage.clientWidth, (-tmp.y + 1) / 2 * stage.clientHeight]; };
  const project = (x, y, z, el) => { const [sx, sy] = proj(x, y, z); el.style.transform = `translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px) translate(-50%,-100%)`; };
  let hoverFor = null, hoverStamp = 0;
  function frame() {
    const dt = Math.min(clock.getDelta(), .05), t = clock.elapsedTime;
    for (const [id, v] of Object.entries(view3)) {
      const g = v.g, w = W(id); if (!w) continue;
      if (v.path.length) {
        const tgt = v.path[0]; tmp.subVectors(tgt, g.position); tmp.y = 0; const d = tmp.length(), step = 2.4 * dt;
        if (d <= step) { g.position.copy(tgt); v.path.shift(); if (!v.path.length) syncScene(); }
        else { tmp.multiplyScalar(step / d); g.position.add(tmp); g.rotation.y = Math.atan2(tmp.x, tmp.z); }
        v.inner.rotation.x = 0; v.inner.position.y = reduce ? 0 : Math.abs(Math.sin(t * 11 + v.phase)) * .07;
      } else if (v.status === 'offline') { g.visible = false; // walked out the front door
      } else if (ROOM[v.status]) { // meeting: face the table · break: sit and eat
        v.inner.rotation.x = 0; g.rotation.y = Math.atan2(v.at.face.x - g.position.x, v.at.face.z - g.position.z);
        v.inner.position.y = v.status === 'break' && !reduce ? Math.abs(Math.sin(t * 6 + v.phase)) * .025 : 0;
      } else { v.inner.rotation.x = 0; g.rotation.y = v.at.rot; v.inner.position.y = -.1 + (['working', 'focus'].includes(v.status) && !reduce ? Math.sin(t * 3 + v.phase) * .012 : 0); }
      v.phones.visible = v.status === 'focus'; v.food.visible = v.status === 'break' && !v.path.length;
      if (v.marker.visible) { v.marker.position.y = 1.62 + (reduce ? 0 : Math.sin(t * 4) * .06); v.marker.rotation.y = t * 1.5; }
      if (v.bell && v.bell.visible) { const shaking = !reduce && ((v.unread > 0 && (t % 2.2) < .8) || performance.now() < ringUntil); v.bell.rotation.z = shaking ? Math.sin(t * 28) * .45 : 0; v.bell.position.y = 1.72 + (reduce ? 0 : Math.sin(t * 3) * .03); }
      if (g.visible) project(g.position.x, g.position.y + (v.bell && v.bell.visible ? 2.05 : 1.75), g.position.z, v.lbl);
    }
    Object.values(ZONES).forEach(z => project(z.x, z.y, z.z, z.el)); groupLbls.forEach(z => project(z.x, z.y, z.z, z.el));
    if (camAnim) { const k = Math.min(1, (performance.now() - camAnim.t0) / 650), e = 1 - Math.pow(1 - k, 3); camTarget.lerpVectors(camAnim.from, camAnim.to, e); zoom = camAnim.z0 + (camAnim.z1 - camAnim.z0) * e; placeCam(); if (k >= 1) camAnim = null; }
    if (hovered && view3[hovered] && view3[hovered].g.visible && !drag && W(hovered)) {
      const v = view3[hovered];
      if (hoverFor !== hovered || t - hoverStamp > 1) { hoverEl.innerHTML = hoverHTML(W(hovered)); hoverFor = hovered; hoverStamp = t; }
      const [sx, sy] = proj(v.g.position.x, v.g.position.y + 1.75, v.g.position.z);
      const H = hoverEl.offsetHeight || 150; let x = sx + 26, y = sy - H / 2; if (x + 250 > stage.clientWidth - 10) x = sx - 276; y = Math.max(10, Math.min(y, stage.clientHeight - H - 10));
      hoverEl.style.transform = `translate(${x.toFixed(0)}px,${y.toFixed(0)}px)`; hoverEl.classList.add('on');
    } else { hoverEl.classList.remove('on'); hoverFor = null; }
    renderer.render(scene, cam); requestAnimationFrame(frame);
  }
  resize(); render(); connect(); requestAnimationFrame(frame);
}
