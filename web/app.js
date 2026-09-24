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
ui.view = ui.view || 'hq'; ui.tscope = ui.tscope || 'mine'; ui.tgroup = ui.tgroup || 'status';
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
const statusPill = st => `<span class="pill"><i class="dot s-${st}"></i>${STATUS_LBL[st]}</span>`;
const prioTag = p => `<span class="prio p${p}">${PRIO[p] || 'Normal'}</span>`;
const dueTag = iso => { const d = dueInfo(iso); return `<span class="due${d.late ? ' late' : ''}">${esc(d.txt)}</span>`; };
const P = {
  hq: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z', needs: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0',
  team: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  tasks: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', board: 'M3 4h6v16H3zM11 4h4v10h-4zM17 4h4v13h-4z', activity: 'M22 12h-4l-3 9L9 3l-3 9H2',
  clients: 'M3 7h18v13H3zM8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18', automations: 'M13 2L3 14h9l-1 8 10-12h-9z',
  integrations: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  x: 'M18 6L6 18M6 6l12 12', list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01', msg: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z', ext: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3', approval: 'M9 12l2 2 4-4M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20',
  decision: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  question: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM9.5 8.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6M12 14.5h.01',
  confirmation: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', plus: 'M12 5v14M5 12h14', sync: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5'
};
const ic = k => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[k]}"/></svg>`;
let toastT; function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3600); }

// ---------- UI ----------
let selected = null, drawerMode = null, openForm = null, openFormKind = null, newTaskOpen = false, lastUnread = 0;

function rNav() {
  const needs = openNeeds().length, unread = unreadNeeds().length, open = db.tasks.filter(t => !['approved', 'cancelled'].includes(hqState(t))).length;
  const item = (k, label, cnt, hot, extra) => `<button class="nitem" data-nav="${k}" id="nav-${k}"${ui.view === k ? ' aria-current="page"' : ''}>${ic(k)}<span>${label}</span>${cnt != null ? `<span class="cnt${hot ? ' hot' : ''}${extra || ''}">${cnt}</span>` : ''}</button>`;
  $('#navWork').innerHTML = item('hq', 'Headquarters') + item('needs', 'Needs you', needs, needs > 0, unread ? ' unread' : '') + item('team', 'Team', db.workers.length) + item('tasks', 'Tasks', open) + item('board', 'Board') + item('activity', 'Activity');
  $('#navMgmt').innerHTML = item('clients', 'Clients') + item('automations', 'Automations') + item('integrations', 'Integrations');
  if (unread > lastUnread) { const el = $('#nav-needs'); if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); } }
  lastUnread = unread;
  const pill = (el, m) => { el.textContent = m === 'live' ? 'Live' : m === 'demo' ? 'Demo' : 'Not set'; el.className = m === 'live' ? 'live' : m === 'demo' ? 'demo' : ''; };
  pill($('#pill-cu'), db.mode.clickup); pill($('#pill-sl'), db.mode.slack);
}
const head = (h, p, extra) => `<header class="phead"><div><h2>${h}</h2><p>${p}</p></div><div style="display:flex;gap:8px;align-items:center">${extra || ''}<button class="xbtn" data-nav="hq" aria-label="Close">${ic('x')}</button></div></header>`;
const stateSelect = t => `<select data-state="${t.id}" aria-label="Status">${HQ_STATES.filter(s => cuStatusFor(t.list_id, s) || s === hqState(t)).map(s => `<option value="${s}"${s === hqState(t) ? ' selected' : ''}>${STATE_LBL[s]} · ${esc(s === hqState(t) ? t.clickup_status : cuStatusFor(t.list_id, s))}</option>`).join('')}</select>`;
const TYPE_LBL = { approval: 'Approval', decision: 'Decision', question: 'Question', confirmation: 'Confirmation' };

function needCard(n, compact) {
  const w = Wx(n.from), t = n.task ? TK(n.task) : null, f = openForm === n.id;
  let acts = '';
  if (pendingNeeds.has(n.id) || (t && pendingTasks.has(t.id))) acts = `<span class="syncing">Syncing with ClickUp…</span>`;
  else if (n.type === 'approval' && t) acts = `<button class="btn ok" data-act="approve" data-id="${n.id}">Approve</button><button class="btn" data-act="form" data-id="${n.id}" data-f="changes">Request changes</button>${compact || !t.url ? '' : `<a class="btn ghost" href="${esc(t.url)}" target="_blank" rel="noopener">${ic('ext')}Review in ClickUp</a>`}`;
  else if (n.type === 'decision' && t) acts = `<button class="btn primary" data-act="form" data-id="${n.id}" data-f="decide">Decide</button>${compact || !t.url ? '' : `<a class="btn ghost" href="${esc(t.url)}" target="_blank" rel="noopener">${ic('ext')}Open in ClickUp</a>`}`;
  else if (n.type === 'question') acts = `<button class="btn primary" data-act="form" data-id="${n.id}" data-f="reply">Reply</button>`;
  else acts = `<button class="btn ok" data-act="confirm" data-id="${n.id}">Confirm</button><button class="btn" data-act="form" data-id="${n.id}" data-f="decline">Decline</button>`;
  const k = f ? openFormKind : '';
  const ph = { changes: `What should ${w.name} change?`, decide: `Your decision for ${w.name}…`, reply: `Reply to ${w.name}…`, decline: 'Why not, or what instead?' }[k];
  const btn = { changes: 'Send back with changes', decide: 'Send decision + unblock', reply: 'Send reply', decline: 'Decline' }[k];
  return `<article class="nycard t-${n.type}">
    <div class="nyhead"><span class="typ">${ic(n.type)}${TYPE_LBL[n.type]}</span>${n.state === 'open' ? '<span class="new">New</span>' : ''}<time>${ago(n.created)}</time></div>
    <h3>${esc(n.title)}</h3><p class="body">${esc(n.body)}</p>
    <p class="who">${avatar(w)}${esc(w.name)}${t ? `<span aria-hidden="true">/</span>${esc(listName(t))}${dueTag(t.due_date)}` : ''}${n.priority === 1 ? prioTag(1) : ''}</p>
    <div class="acts">${acts}</div>
    ${f ? `<div class="inline"><textarea id="nf-${n.id}" rows="2" placeholder="${esc(ph)}"></textarea><button class="btn primary" data-act="formSend" data-id="${n.id}">${btn}</button></div>` : ''}
  </article>`;
}
const sortNeeds = (a, b) => a.priority - b.priority || a.created - b.created;
function rNeeds() {
  const items = openNeeds().sort(sortNeeds);
  const h = head('Needs you', `${items.length} waiting on you. Items clear when the work moves, not when you look.`);
  return h + (items.length ? `<div class="wrap">${items.map(n => needCard(n)).join('')}</div>` : `<div class="empty"><strong>Nothing waiting on you.</strong>Tasks moved to a review status in ClickUp, blocked tasks tagged <code>needs-owner</code>, and comments that @mention you with a question land here.</div>`);
}
function rTeam() {
  const order = { working: 0, online: 1, meeting: 2, break: 3, away: 4, offline: 5 };
  const ws = db.workers.slice().sort((a, b) => (b.is_owner - a.is_owner) || attention(b.id) - attention(a.id) || order[displayStatus(a)] - order[displayStatus(b)]);
  return head('Team', `${ws.length} people${db.mode.slack === 'live' ? ' from Slack' : ''}${db.mode.clickup === 'live' ? ', matched to ClickUp' : ''}.`) + `<div class="tgrid">${ws.map(w => {
    const st = displayStatus(w), cur = currentTask(w.id), att = attention(w.id);
    return `<div class="tmcard${selected === w.id ? ' sel' : ''}">
      <div class="tmtop">${bigAvatar(w)}<b>${esc(w.name)}${w.is_owner ? ' (you)' : ''}</b><span>${esc([w.role, w.department].filter(Boolean).join(' · ') || w.match || '')}</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${statusPill(st)}${w.slack_user_id ? `<span class="pill">Slack: ${w.slack_presence === 'active' ? 'Active' : 'Away'}${w.slack_status_text ? ' · ' + esc(w.slack_status_text) : ''}</span>` : '<span class="pill">No Slack</span>'}${att ? `<span class="pill amber">${att} for you</span>` : ''}</div>
      <div class="tmwork"><div class="k">Current work</div>${cur ? `${esc(cur.name)} <span class="due">· ${STATE_LBL[hqState(cur)]}</span>` : '<span class="due">Nothing in progress</span>'}</div>
      <div class="tmacts">${!w.is_owner && w.slack_user_id ? `<button class="btn" data-act="dMsgOpen" data-id="${w.id}">${ic('msg')}Message</button>` : ''}${w.clickup_user_id ? `<button class="btn" data-act="assign" data-id="${w.id}">${ic('plus')}Assign</button>` : ''}<button class="btn ghost" data-act="pick" data-id="${w.id}">Details</button></div>
    </div>`;
  }).join('')}</div>`;
}
function taskRow(t) {
  const w = Wx(t.assignee);
  return `<div class="trow2"><span class="t">${t.url ? `<a href="${esc(t.url)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">${esc(t.name)}</a>` : esc(t.name)}</span>${pendingTasks.has(t.id) ? `<span class="syncing" style="grid-row:1/3;grid-column:2">Syncing with ClickUp…</span>` : stateSelect(t)}
    <span class="m">${avatar(w)}${esc(w.name)} · ${esc(listName(t))} ${prioTag(t.priority)} ${dueTag(t.due_date)}</span></div>`;
}
function rTasks() {
  const sc = ui.tscope, g = ui.tgroup, own = OWNER();
  let ts = db.tasks.filter(t => hqState(t) !== 'cancelled'), title = 'All tasks';
  if (sc === 'mine') { ts = ts.filter(t => own && t.assignee === own.id); title = 'My tasks'; }
  else if (sc.startsWith('p:') && W(sc.slice(2))) { const w = W(sc.slice(2)); ts = ts.filter(t => t.assignee === w.id); title = `${w.name}'s tasks`; }
  const ord = s => HQ_STATES.indexOf(s);
  ts.sort((a, b) => ord(hqState(a)) - ord(hqState(b)) || (a.due_date || '9').localeCompare(b.due_date || '9') || a.priority - b.priority);
  const keyOf = { none: () => '', person: t => Wx(t.assignee).name, department: t => Wx(t.assignee).department || 'No department', status: t => STATE_LBL[hqState(t)], priority: t => PRIO[t.priority] || 'Normal', due: t => DUE_B[dueInfo(t.due_date).bucket], project: t => listName(t) };
  const gorder = { status: t => ord(hqState(t)), priority: t => t.priority, due: t => dueInfo(t.due_date).bucket };
  const groups = [], idx = {};
  ts.forEach(t => { const k = keyOf[g](t); if (!(k in idx)) { idx[k] = groups.length; groups.push({ k, o: gorder[g] ? gorder[g](t) : k, items: [] }); } groups[idx[k]].items.push(t); });
  groups.sort((a, b) => typeof a.o === 'number' ? a.o - b.o : String(a.o).localeCompare(String(b.o)));
  const pw = sc.startsWith('p:') ? W(sc.slice(2)) : null;
  const scopeChips = `<button class="chipb" data-act="scope" data-id="mine" aria-pressed="${sc === 'mine'}">My tasks</button><button class="chipb" data-act="scope" data-id="all" aria-pressed="${sc === 'all'}">All tasks</button>${pw ? `<button class="chipb" aria-pressed="true" data-act="scope" data-id="all">${avatar(pw)}${esc(pw.name)} ×</button>` : ''}`;
  const gsel = `<label class="hint" for="tgroup">Group by</label><select id="tgroup">${[['none', 'None'], ['status', 'Status'], ['person', 'Person'], ['department', 'Department'], ['priority', 'Priority'], ['due', 'Due date'], ['project', 'Project']].map(([v, l]) => `<option value="${v}"${v === g ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  const assignable = db.workers.filter(w => w.clickup_user_id || db.mode.demo);
  const form = newTaskOpen ? `<div class="newform">
    <label class="full">Task<input id="nt-name" placeholder="What needs doing?"></label>
    <label>Assignee<select id="nt-who">${assignable.map(w => `<option value="${w.id}"${(pw ? pw.id : own && own.id) === w.id ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}</select></label>
    <label>Project (ClickUp list)<select id="nt-list">${db.lists.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>
    <label>Priority<select id="nt-prio">${[1, 2, 3, 4].map(p => `<option value="${p}"${p === 3 ? ' selected' : ''}>${PRIO[p]}</option>`).join('')}</select></label>
    <label>Due<input id="nt-due" type="date" value="${isoDay(3)}"></label>
    <div class="full crow" style="margin:0"><span class="hint">Creates the task in ClickUp.</span><button class="btn primary" data-act="ntCreate">Create in ClickUp</button></div></div>` : '';
  return head(title, `${ts.length} task${ts.length === 1 ? '' : 's'} · ${db.mode.clickup === 'live' ? 'live from ClickUp' : 'demo data'}`, `<button class="btn primary" data-act="ntToggle">${ic('plus')}New task</button>`) +
    `<div class="tbar">${scopeChips}<span class="grow"></span>${gsel}</div>${form}
    <div class="wrap">${ts.length ? groups.map(gr => `${g !== 'none' ? `<div class="gh"><span>${esc(gr.k)}</span><span>${gr.items.length}</span></div>` : ''}${gr.items.map(taskRow).join('')}`).join('') : `<div class="empty"><strong>No tasks here.</strong>${sc === 'mine' && !own ? 'Set OWNER_EMAIL so HQ knows which person is you.' : 'Create one, or switch to All tasks.'}</div>`}</div>`;
}
function rBoard() {
  const cols = ['todo', 'in_progress', 'in_review', 'changes_requested', 'blocked', 'approved'];
  return head('Board', 'Columns are HQ workflow states. Each ClickUp list maps its own statuses onto them.') + `<div class="board">${cols.map(k => {
    const ts = db.tasks.filter(t => hqState(t) === k);
    return `<section class="col"><h4>${STATE_LBL[k]}<span>${ts.length}</span></h4>${ts.slice(0, 60).map(t => `<div class="tcard">${esc(t.name)}<p class="who">${avatar(Wx(t.assignee))}${esc(Wx(t.assignee).name)}<span aria-hidden="true">/</span>${esc(t.clickup_status)}</p>${pendingTasks.has(t.id) ? '<span class="syncing">Syncing…</span>' : stateSelect(t)}</div>`).join('')}${ts.length > 60 ? `<p class="hint">+${ts.length - 60} more</p>` : ''}</section>`;
  }).join('')}</div>`;
}
function rActivity() {
  const l = db.activity.slice().reverse().slice(0, 60);
  const nowRows = db.workers.map(w => { const st = displayStatus(w), c = currentTask(w.id); return `<div class="nowrow">${avatar(w)}<b>${esc(w.name)}</b><span><span class="arrow">→</span> ${c ? esc(short(c.name, 52)) : '<span class="due">No active task</span>'}</span>${statusPill(st)}</div>`; }).join('');
  return head('Activity', 'What everyone is on right now, and what changed.') + `<div class="wrap"><div class="sect" style="margin-top:0">Right now</div><div class="now">${nowRows}</div>
  <div class="sect">Recent</div><div class="feed">${l.length ? l.map(e => { const w = W(e.worker); return `<div class="fi">${w ? avatar(w) : ''}<span>${w ? `<b>${esc(w.name)}</b> ` : ''}${esc(e.text)}</span><time>${ago(e.ts)}</time></div>`; }).join('') : '<div class="fi"><span class="due">Activity appears as tasks and statuses change.</span></div>'}</div></div>`;
}
function rClients() {
  const g = {}; db.tasks.forEach(t => { const k = t.client || 'No folder'; (g[k] = g[k] || []).push(t); });
  const names = Object.keys(g).sort();
  return head('Clients', 'Work grouped by ClickUp folder or space.') + `<div class="wrap">${names.map(n => {
    const ts = g[n], open = ts.filter(t => !['approved', 'cancelled'].includes(hqState(t))).length;
    return `<div class="ccard"><h3>${esc(n)}<span>${open} open · ${ts.length - open} done</span></h3><ul>${ts.slice(0, 25).map(t => `<li>${avatar(Wx(t.assignee))}${esc(t.name)}<em>${STATE_LBL[hqState(t)]}</em></li>`).join('')}</ul></div>`;
  }).join('')}</div>`;
}
let simOn = true;
function rAutomations() {
  return head('Automations', 'Status mapping and routing rules.') + `<div class="wrap">
  ${db.mode.demo ? `<label class="switch"><span><b>Demo simulator</b><p>Sends fake ClickUp and Slack events every few seconds.</p></span><input type="checkbox" id="demoToggle"${simOn ? ' checked' : ''}></label>` : ''}
  <div class="sect">ClickUp status mapping</div>
  <p class="hint" style="margin:0 2px 10px">HQ guessed a mapping from each list's status names. Fix any that are wrong. “In review” creates an Approval in Needs You; “Blocked” creates a Decision when the task is tagged <code>needs-owner</code> or assigned to you.</p>
  ${db.lists.length ? db.lists.map(l => `<div class="maplist"><h4>${esc(l.name)}<span>${l.statuses.length} statuses</span></h4>${l.statuses.map(s => {
    const m = db.map.find(r => r.list_id === l.id && r.clickup_status === s);
    return `<div class="maprow"><span>${esc(s)}</span><i>→</i><select data-map="${esc(l.id)}" data-status="${esc(s)}">${HQ_STATES.map(h => `<option value="${h}"${m && m.hq_state === h ? ' selected' : ''}>${STATE_LBL[h]}</option>`).join('')}</select></div>`;
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
  <div class="dwho">${bigAvatar(w)}<span><b>${esc(w.name)}</b><span>${esc([w.role, w.department].filter(Boolean).join(' · '))}</span></span></div>
  <div class="dbox"><div class="dstat"><i class="dot s-${st}"></i>${STATUS_LBL[st]}</div><div class="dsub" style="margin-top:4px">${slackLine}${w.manual_status !== 'none' ? ` · set to ${STATUS_LBL[w.manual_status]} in HQ` : ''}</div>
    ${w.is_owner ? `<div class="segs" role="group" aria-label="My status">${[['none', 'Auto'], ['meeting', 'Meeting'], ['break', 'Break'], ['offline', 'Offline']].map(([v, l]) => `<button data-act="myStatus" data-id="${v}" aria-pressed="${w.manual_status === v}">${l}</button>`).join('')}</div>` : ''}</div>
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
  view.hidden = isHQ; view.classList.toggle('wide', ui.view === 'board'); $('#app').classList.toggle('vopen', !isHQ);
  if (!isHQ) keepTyping(view, () => { view.innerHTML = { needs: rNeeds, team: rTeam, tasks: rTasks, board: rBoard, activity: rActivity, clients: rClients, automations: rAutomations, integrations: rIntegrations }[ui.view](); });
  if (selected && !W(selected)) selected = null;
  const din = $('#dinner'); keepTyping(din, () => { din.innerHTML = rDrawer(); });
  $('#app').classList.toggle('dopen', !!selected);
  const c = { working: 0, meeting: 0, brk: 0, offline: 0 }; db.workers.forEach(w => { const s = displayStatus(w); if (s === 'working') c.working++; else if (s === 'meeting') c.meeting++; else if (s === 'break') c.brk++; else if (s === 'offline') c.offline++; });
  $('#hqline').textContent = `${new Date().toLocaleDateString([], { weekday: 'long' })} · ${db.workers.length - c.offline} in · ${c.meeting} in meetings · ${c.brk} on break · ${c.offline} offline`;
  $('#stats').innerHTML = [[c.working, 'Working'], [c.meeting, 'Meeting'], [c.brk, 'Break'], [openNeeds().length, 'Need you']].map(([n, l]) => `<div class="stat"><strong>${n}</strong><span>${l}</span></div>`).join('');
  clearTimeout(ackTimer);
  const vis = ui.view === 'needs' ? openNeeds() : (selected ? openNeeds().filter(n => n.from === selected) : []);
  const toAck = vis.filter(n => n.state === 'open').map(n => n.id);
  if (toAck.length) ackTimer = setTimeout(() => post('/api/needs/ack', { ids: toAck }).catch(() => { }), 1800);
  syncScene(); saveUi();
}

// ---------- events ----------
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
    case 'confirm': pendingNeeds.add(id); render(); post(`/api/needs/${id}/resolve`, { action: 'confirm' }).then(() => toast('Confirmed.')).catch(() => { pendingNeeds.delete(id); render(); }); return;
    case 'pick': selected === id ? closeDrawer() : selectWorker(id); return;
    case 'close': closeDrawer(); return;
    case 'assign': selectWorker(id, 'instr'); focus('di-' + id); return;
    case 'viewTasks': ui.view = 'tasks'; ui.tscope = W(id).is_owner ? 'mine' : 'p:' + id; break;
    case 'scope': ui.tscope = id; break;
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
    case 'myStatus': post(`/api/workers/${OWNER().id}/status`, { status: id }).catch(() => { }); return;
    case 'sim': post('/api/sim/' + id).catch(() => { }); return;
    case 'sync': toast('Syncing…'); post('/api/sync').then(() => toast('Synced.')).catch(() => { }); return;
  }
  render();
});
document.addEventListener('change', e => {
  const el = e.target;
  if (el.id === 'demoToggle') { simOn = el.checked; post('/api/demo', { on: simOn }).catch(() => { }); return; }
  if (el.id === 'tgroup') { ui.tgroup = el.value; render(); return; }
  if (el.dataset.state) { const tid = el.dataset.state; taskAction(tid, () => post(`/api/tasks/${tid}/status`, { state: el.value })); return; }
  if (el.dataset.map) { post('/api/statusmap', { list_id: el.dataset.map, clickup_status: el.dataset.status, hq_state: el.value }).catch(() => { }); return; }
  if (el.dataset.match) { toast('Re-matching…'); post('/api/matches', { slack_user_id: el.dataset.match, clickup_user_id: el.value }).catch(() => { }); }
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
setInterval(() => { if (['activity', 'integrations', 'needs'].includes(ui.view)) render(); }, 30000);
fetch('/api/demo').then(r => r.json()).then(j => { simOn = j.on; }).catch(() => { });

// =====================================================================
// 3D OFFICE — reads the store, never writes it.
// =====================================================================
let syncScene = () => { };
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
  const DEF_THETA = Math.PI * 0.23; let theta = DEF_THETA, zoom = 1;
  const placeCam = () => { const r = 60; cam.position.set(Math.sin(theta) * r, r * 0.8, Math.cos(theta) * r); cam.lookAt(0, 0, 0); cam.zoom = zoom; cam.updateProjectionMatrix(); };
  const resize = () => { const w = stage.clientWidth || 1, h = stage.clientHeight || 1, asp = w / h; renderer.setSize(w, h, false); const half = Math.max(6.2, 10.5 / asp); cam.left = -half * asp; cam.right = half * asp; cam.top = half; cam.bottom = -half; placeCam(); };
  new ResizeObserver(resize).observe(stage);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7a8a4a, .72));
  const sun = new THREE.DirectionalLight(0xffffff, .78); sun.position.set(14, 24, 10); sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 }); sun.shadow.bias = -0.0008; scene.add(sun);
  const mats = {};
  const mat = (c, o) => { const k = c + '|' + (o || 1); if (!mats[k]) mats[k] = new THREE.MeshLambertMaterial({ color: c, transparent: !!o && o < 1, opacity: o || 1 }); return mats[k]; };
  const box = (w, h, d, c, x, y, z, parent, o) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), o && o < 1 ? mat(c, o) : mat(c)); m.position.set(x, y, z); m.castShadow = !(o && o < 1); m.receiveShadow = true; (parent || scene).add(m); return m; };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat(GRASS)); ground.rotation.x = -Math.PI / 2; ground.position.y = -.3; ground.receiveShadow = true; scene.add(ground);
  box(16.4, .3, 10.4, 0xEDE7DC, 0, -.15, 0); box(11.4, .02, 10, 0xE2D2B2, -2.3, .01, 0);
  box(4.3, .02, 4.6, 0xC9C2DA, 5.85, .012, -2.7); box(4.3, .02, 4.8, 0xB9D3CC, 5.85, .012, 2.6);
  box(16.4, 1.3, .2, 0xCFC6B6, 0, .65, -5.1); box(.2, 1.3, 10.4, 0xCFC6B6, -8.1, .65, 0);
  box(.14, 1.1, 4, 0xDCD5C8, 3.6, .55, -3); box(.14, 1.1, 4, 0xDCD5C8, 3.6, .55, 3); box(3.4, 1.1, .14, 0xDCD5C8, 6.3, .55, -.35);
  const DESKS = [];
  [-6.6, -4.4, -2.2, 0].forEach(x => { DESKS.push({ x, z: -2.7, face: -1 }); DESKS.push({ x, z: 2.7, face: 1 }); });
  DESKS.push({ x: 2.2, z: -2.7, face: -1, owner: true });
  DESKS.forEach(d => {
    const g = new THREE.Group(); g.position.set(d.x, 0, d.z); scene.add(g); const f = d.face;
    box(1.6, .08, .8, d.owner ? 0xE9DFC8 : 0xF4EFE6, 0, .72, 0, g); box(.06, .7, .7, 0xB8A58A, -.74, .36, 0, g); box(.06, .7, .7, 0xB8A58A, .74, .36, 0, g);
    box(.66, .4, .05, 0x2A2F36, 0, 1.0, f * .2, g);
    d.screen = new THREE.Mesh(new THREE.PlaneGeometry(.58, .32), new THREE.MeshBasicMaterial({ color: 0x1b2026 }));
    d.screen.position.set(0, 1.0, f * .2 - f * .03); d.screen.rotation.y = f > 0 ? Math.PI : 0; g.add(d.screen);
    box(.12, .2, .12, 0x2A2F36, 0, .82, f * .22, g); box(1.9, 1.05, .05, 0xA7B8C4, 0, .52, f * .5, g, .35);
    box(.18, .18, .18, pick([0xE07A5F, 0x3D405B, 0xF2CC8F, 0x81B29A]), .55, .85, -f * .05, g);
    box(.46, .08, .46, 0x3A4450, 0, .44, -f * .85, g); box(.46, .5, .08, 0x3A4450, 0, .72, -f * 1.07, g); box(.08, .4, .08, 0x2A2F36, 0, .2, -f * .85, g);
    d.seat = new THREE.Vector3(d.x, 0, d.z - f * .85); d.faceRot = f > 0 ? 0 : Math.PI;
  });
  const MT = new THREE.Vector3(5.9, 0, -2.9);
  box(2.6, .08, 1.2, 0xF4EFE6, MT.x, .7, MT.z); box(.1, .66, .1, 0xB8A58A, MT.x - 1.1, .35, MT.z); box(.1, .66, .1, 0xB8A58A, MT.x + 1.1, .35, MT.z); box(1.6, .9, .06, 0x2A2F36, MT.x, 1.2, -4.95);
  const MEET = [[4.9, -2.0], [5.9, -2.0], [6.9, -2.0], [4.9, -3.8], [5.9, -3.8], [6.9, -3.8]].map(p => new THREE.Vector3(p[0], 0, p[1]));
  MEET.forEach(s => box(.4, .4, .4, 0x7B5EA7, s.x, .2, s.z + (s.z > MT.z ? .25 : -.25)));
  box(1.4, .1, .4, 0x8C5A3C, 5.4, .4, 3.4); box(.08, .4, .3, 0x2F343B, 4.9, .2, 3.4); box(.08, .4, .3, 0x2F343B, 5.9, .2, 3.4);
  box(1.2, .04, .8, 0x7A9E7E, 7.0, .03, 1.6); box(.34, .9, .34, 0xE9EEF2, 4.2, .45, 4.5); box(.3, .3, .3, 0x8FC1E3, 4.2, 1.05, 4.5);
  box(.9, .5, .5, 0x5E6770, 7.4, .25, 4.3); box(.5, .12, .5, 0xF2CC8F, 7.4, .56, 4.3);
  const BREAK = [[5.0, 1.2], [6.1, 1.6], [7.2, 2.4], [5.4, 2.7], [6.6, 3.3], [4.8, 4.0]].map(p => new THREE.Vector3(p[0], 0, p[1]));
  const plant = (x, z, s = 1) => { box(.34 * s, .34 * s, .34 * s, 0xC9B38F, x, .17 * s, z); box(.5 * s, .6 * s, .5 * s, 0x5E9E4A, x, .64 * s, z); };
  plant(-7.6, -4.6); plant(3.2, -4.6); plant(-7.6, 4.6); plant(7.7, -4.6, 1.2); plant(2.2, 3.6);
  const tree = (x, z, s) => { box(.3 * s, 1 * s, .3 * s, 0x7A5230, x, .5 * s - .3, z); box(1.3 * s, 1.2 * s, 1.3 * s, 0x4F8A3C, x, 1.4 * s - .3, z); box(.8 * s, .6 * s, .8 * s, 0x6BAA4B, x, 2.2 * s - .3, z); };
  [[-11, -7, 1.1], [10.5, -6, 1], [12, 3, 1.3], [-12, 5, 1], [4, 9, .9], [-5, -9, 1.2], [9, 8, 1.1], [-9, 9, .8]].forEach(p => tree(...p));
  const DOOR_IN = new THREE.Vector3(3.0, 0, 0), DOOR_OUT = new THREE.Vector3(4.2, 0, 0), EXIT = new THREE.Vector3(1.1, 0, 5.8);
  const zoneLbl = (t, s, x, y, z) => { const el = document.createElement('div'); el.className = 'lbl zone'; el.innerHTML = `<span>${t}<small>${s}</small></span>`; labelsEl.appendChild(el); return { el, x, y, z }; };
  const ZONES = [zoneLbl('Meeting room', 'from Slack status', 7.4, 1.3, -4.7), zoneLbl('Break area', 'set in HQ', 6.8, 1.2, 4.6)];

  // avatars are (re)built whenever the set of seated people changes
  let view3 = {}, clickMeshes = [], seatedKey = '', hovered = null;
  function seated() {
    // owner at the owner desk + first 8 teammates (people waiting on you and matched people first)
    const own = db.workers.find(w => w.is_owner);
    const rest = db.workers.filter(w => !w.is_owner).sort((a, b) => attention(b.id) - attention(a.id) || (b.clickup_user_id ? 1 : 0) - (a.clickup_user_id ? 1 : 0) || a.name.localeCompare(b.name)).slice(0, 8);
    return own ? [own, ...rest] : rest;
  }
  function spotFor(v, st) { if (st === 'meeting') return MEET[v.idx % MEET.length].clone(); if (st === 'break') return BREAK[v.idx % BREAK.length].clone(); if (st === 'offline') return EXIT.clone(); return v.desk.seat.clone(); }
  function buildAvatars(list) {
    for (const v of Object.values(view3)) { scene.remove(v.g); v.lbl.remove(); }
    view3 = {}; clickMeshes = [];
    let d = 0;
    list.forEach((w, i) => {
      const g = new THREE.Group(); scene.add(g); const inner = new THREE.Group(); g.add(inner);
      const col = colorNum(w.color), hair = [0x2B1B12, 0x5A3A1E, 0x151515, 0x3B2314, 0x6B4423, 0xC9A15B][i % 6];
      const legs = box(.34, .42, .22, 0x2F3B4A, 0, .21, 0, inner), body = box(.44, .46, .28, col, 0, .66, 0, inner), headM = box(.32, .32, .32, 0xE5B48B, 0, 1.06, 0, inner);
      box(.34, .1, .34, hair, 0, 1.25, 0, inner); box(.34, .2, .08, hair, 0, 1.12, -.14, inner); box(.1, .36, .12, col, -.27, .66, 0, inner); box(.1, .36, .12, col, .27, .66, 0, inner);
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
      const desk = w.is_owner ? DESKS[8] : DESKS[d++];
      const v = { g, inner, marker, bell, ring, lbl, desk, status: null, path: [], next: 3 + Math.random() * 6, phase: Math.random() * 6, idx: i, hideAtEnd: false };
      view3[w.id] = v;
      const st = displayStatus(w); v.status = st; g.position.copy(spotFor(v, st)); if (st === 'offline') g.visible = false;
    });
  }
  const inRight = p => p.x > 3.6;
  function goTo(v, target) {
    const p = [], from = v.g.position, fr = inRight(from), tr = inRight(target);
    if (!fr && Math.abs(from.z) > .6) p.push(new THREE.Vector3(from.x, 0, 0));
    if (fr !== tr) { p.push(fr ? DOOR_OUT.clone() : DOOR_IN.clone()); p.push(fr ? DOOR_IN.clone() : DOOR_OUT.clone()); }
    if (!tr && Math.abs(target.z) > .6) p.push(new THREE.Vector3(target.x, 0, 0));
    p.push(target.clone()); v.path = p;
  }
  syncScene = function () {
    const list = seated(), key = list.map(w => w.id).join(',');
    if (key !== seatedKey) { seatedKey = key; buildAvatars(list); }
    const unread = unreadNeeds().length, needs = openNeeds().length;
    for (const w of list) {
      const v = view3[w.id]; if (!v) continue;
      const st = displayStatus(w), cur = currentTask(w.id), att = attention(w.id);
      v.ring.visible = selected === w.id;
      v.lbl.className = 'lbl' + (selected === w.id ? ' sel' : '') + (att ? ' attn' : '') + (st === 'offline' && !v.path.length ? ' off' : '');
      v.lbl.innerHTML = `<i style="background:${STATUS_HEX[st]}"></i><span>${esc(w.is_owner ? 'You' : w.name.split(' ')[0])}${w.is_owner && needs ? `<span class="bdg">${needs}</span>` : ''}<small>${esc(cur ? short(cur.name, 30) : STATUS_LBL[st])}</small></span>`;
      v.lbl.setAttribute('aria-label', `${w.name}, ${STATUS_LBL[st]}${cur ? ', ' + cur.name : ''}`);
      const ts = cur ? hqState(cur) : null;
      v.desk.screen.material.color.setHex(['offline', 'meeting', 'break', 'away'].includes(st) ? 0x1b2026 : ts === 'in_progress' || ts === 'changes_requested' ? 0x6FA8DC : ts === 'in_review' || ts === 'blocked' ? 0xF2C27A : 0x49576A);
      v.marker.visible = !!att && !w.is_owner;
      if (v.bell) v.bell.visible = needs > 0; v.unread = unread;
      if (st === v.status) continue;
      const was = v.status; v.status = st;
      if (was === 'offline') { v.g.position.copy(EXIT); v.g.visible = true; }
      v.hideAtEnd = st === 'offline'; goTo(v, spotFor(v, st));
    }
  };

  const cvs = renderer.domElement; let drag = null;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const hit = e => { const r = cvs.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam); const h = ray.intersectObjects(clickMeshes.filter(m => { let o = m; while (o.parent && o.parent !== scene) o = o.parent; return o.visible; }), false)[0]; return h ? h.object.userData.id : null; };
  cvs.addEventListener('pointerdown', e => { drag = { x: e.clientX, th: theta, moved: false }; cvs.setPointerCapture(e.pointerId); });
  cvs.addEventListener('pointermove', e => { if (drag) { const dx = e.clientX - drag.x; if (Math.abs(dx) > 4) drag.moved = true; if (drag.moved) { theta = drag.th - dx * .008; placeCam(); } return; } const h = hit(e); hovered = h; cvs.style.cursor = h ? 'pointer' : 'grab'; });
  cvs.addEventListener('pointerleave', () => { if (!drag) hovered = null; });
  cvs.addEventListener('pointerup', e => { if (drag && !drag.moved) { const id = hit(e); if (id) selectWorker(id); else if (selected) closeDrawer(); } drag = null; });
  cvs.addEventListener('pointercancel', () => { drag = null; });
  cvs.addEventListener('wheel', e => { e.preventDefault(); zoom = Math.min(2.6, Math.max(.6, zoom * (e.deltaY < 0 ? 1.1 : .91))); placeCam(); }, { passive: false });
  $('#zin').onclick = () => { zoom = Math.min(2.6, zoom * 1.2); placeCam(); };
  $('#zout').onclick = () => { zoom = Math.max(.6, zoom / 1.2); placeCam(); };
  $('#reset').onclick = () => { theta = DEF_THETA; zoom = 1; placeCam(); };

  const hoverHTML = w => {
    const st = displayStatus(w), c = currentTask(w.id) || nextTask(w.id), la = lastActivity(w.id), att = attention(w.id), n = openNeeds().length;
    return `<b>${esc(w.name)}<span style="font:500 11.5px 'IBM Plex Sans';color:#5F6B59">${esc(w.role || '')}</span></b>
    <div class="st"><i style="background:${STATUS_HEX[st]}"></i>${STATUS_LBL[st]}${w.slack_status_text ? ` <span class="m">· ${esc(w.slack_status_text)}</span>` : ''}</div>
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
        if (d <= step) { g.position.copy(tgt); v.path.shift(); if (!v.path.length && v.hideAtEnd) { g.visible = false; syncScene(); } }
        else { tmp.multiplyScalar(step / d); g.position.add(tmp); g.rotation.y = Math.atan2(tmp.x, tmp.z); }
        v.inner.position.y = reduce ? 0 : Math.abs(Math.sin(t * 11 + v.phase)) * .07;
      } else if (v.status === 'break') { v.inner.position.y = 0; v.next -= dt; if (v.next <= 0) { v.next = 6 + Math.random() * 8; goTo(v, pick(BREAK)); } }
      else if (v.status === 'meeting') { v.inner.position.y = 0; g.rotation.y = Math.atan2(MT.x - g.position.x, MT.z - g.position.z); }
      else if (v.status !== 'offline') { g.rotation.y = v.desk.faceRot; v.inner.position.y = -.1 + (v.status === 'working' && !reduce ? Math.sin(t * 3 + v.phase) * .012 : 0); }
      if (v.marker.visible) { v.marker.position.y = 1.62 + (reduce ? 0 : Math.sin(t * 4) * .06); v.marker.rotation.y = t * 1.5; }
      if (v.bell && v.bell.visible) { const shaking = v.unread > 0 && !reduce && (t % 2.2) < .8; v.bell.rotation.z = shaking ? Math.sin(t * 28) * .45 : 0; v.bell.position.y = 1.72 + (reduce ? 0 : Math.sin(t * 3) * .03); }
      if (g.visible) project(g.position.x, g.position.y + (v.bell && v.bell.visible ? 2.05 : 1.75), g.position.z, v.lbl);
    }
    ZONES.forEach(z => project(z.x, z.y, z.z, z.el));
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
