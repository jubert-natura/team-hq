import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { db, hq, loadPersisted, persist, applyChange, rebuildMap, addClient, publicState, logEvent, logError, logActivity } from './store.js';
import { cuStatusFor, task as getTask, worker as getWorker, owner as getOwner, STATE_LBL, MANUAL_STATUSES, canEditTask } from '../shared/model.js';
import * as cu from './clickup.js';
import * as slack from './slack.js';
import { fullSync, pollPresence, ensureWebhook, onWebhook } from './sync.js';
import { loadDemo, simulate, randomSim } from './demo.js';
import * as google from './google.js';
import { resolveEmoji, emojifyText } from './emoji.js';
import { pollMail, markDone } from './mail.js';

const PORT = +(process.env.PORT || 3000);
const LIVE = cu.clickupEnabled() || slack.slackEnabled();
const PUBLIC_URL = process.env.PUBLIC_URL || (process.env.CODESPACE_NAME ? `https://${process.env.CODESPACE_NAME}-${PORT}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}` : '');

const app = express();

// ClickUp webhook: raw body for signature check. Not behind the password (verified by HMAC instead).
app.post('/webhooks/clickup', express.raw({ type: '*/*', limit: '2mb' }), (req, res) => {
  const secret = db.meta.webhook && db.meta.webhook.secret;
  if (!cu.verifySignature(req.body, req.get('X-Signature'), secret)) { logEvent('hq', 'webhook_rejected', 'bad signature'); return res.status(401).end(); }
  res.status(200).end();
  let body; try { body = JSON.parse(req.body.toString('utf8')); } catch { return; }
  onWebhook(body);
});

// Optional password for everything else (set HQ_PASSWORD when the port is public).
app.use((req, res, next) => {
  const pw = process.env.HQ_PASSWORD; if (!pw) return next();
  const [, b64] = (req.get('authorization') || '').split(' ');
  const [, pass] = Buffer.from(b64 || '', 'base64').toString().split(':');
  if (pass === pw) return next();
  res.set('WWW-Authenticate', 'Basic realm="Team HQ"').status(401).send('Password required');
});
app.use(express.json());
app.use('/shared', express.static(path.resolve('shared')));
app.use(express.static(path.resolve('web')));

const ok = res => res.json({ ok: true });
const fail = (res, e, code = 500) => { logError('api', e); res.status(code).json({ ok: false, error: String(e.message || e) }); };
const need = (res, cond, msg) => { if (!cond) { res.status(400).json({ ok: false, error: msg }); return false; } return true; };

app.get('/api/state', (req, res) => res.json(publicState()));
app.get('/api/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
  res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`); addClient(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000); res.on('close', () => clearInterval(ping));
});
app.get('/api/health', (req, res) => res.json({ ok: true, mode: db.mode, publicUrl: PUBLIC_URL || null, webhook: !!(db.meta.webhook && db.meta.webhook.secret), lastSync: db.meta.last_sync, errors: db.meta.errors.slice(-5) }));

// --- task workflow (writes go to ClickUp first) ---
app.post('/api/tasks/:id/status', async (req, res) => {
  const t = getTask(db, req.params.id), { state, note, clickup_status } = req.body || {};
  if (!need(res, t, 'task not found')) return;
  // Only the assignee moves a task. The one exception is answering your own Needs You item (approve, request changes, decide).
  const viaNeed = db.needs.some(n => n.task === t.id && n.state !== 'resolved' && ['approval', 'decision'].includes(n.type));
  if (!need(res, canEditTask(db, t) || viaNeed, `Only ${t.assignee ? (getWorker(db, t.assignee) || {}).name || 'the assignee' : 'the assignee'} can change this task's status.`)) return;
  const list = db.lists.find(l => l.id === t.list_id);
  const status = clickup_status && list && list.statuses.some(s => s.status === clickup_status) ? clickup_status : cuStatusFor(db, t.list_id, state);
  if (!need(res, status, `No ClickUp status in "${t.list_name}" is mapped to "${STATE_LBL[state] || state}". Map one in Automations.`)) return;
  try {
    if (db.mode.demo) { applyChange(() => { t.clickup_status = status; t.updated = Date.now(); logEvent('clickup', 'taskStatusUpdated', `${t.name.slice(0, 34)} → ${status}`); }); return ok(res); }
    await cu.setStatus(t.cu_id, status);
    if (note) await cu.addComment(t.cu_id, note);
    logEvent('hq', 'PUT task status', `${t.name.slice(0, 34)} → ${status}`);
    await onWebhook({ event: 'hqWriteBack', task_id: t.cu_id });
    ok(res);
  } catch (e) { fail(res, e); }
});
app.post('/api/tasks', async (req, res) => {
  const { name, assignee, list_id, priority, due, state, clickup_status } = req.body || {};
  if (!need(res, name, 'name required')) return;
  const w = getWorker(db, assignee);
  const listId = list_id || process.env.CLICKUP_DEFAULT_LIST_ID || (db.lists[0] && db.lists[0].id);
  if (!need(res, listId, 'No ClickUp list to create in. Set CLICKUP_DEFAULT_LIST_ID.')) return;
  const list = db.lists.find(l => l.id === listId);
  const status = (clickup_status && list && list.statuses.some(s => s.status === clickup_status) ? clickup_status : cuStatusFor(db, listId, state || 'todo')) || undefined;
  try {
    if (db.mode.demo) {
      applyChange(() => db.tasks.push({ id: 't' + Date.now().toString(36), cu_id: 'demo', name, assignee: w ? w.id : null, list_id: listId, list_name: (db.lists.find(l => l.id === listId) || {}).name, clickup_status: status, clickup_status_type: '', client: 'Internal', priority: +priority || 3, due_date: due || '', tags: [], url: '', updated: Date.now() }));
      return ok(res);
    }
    if (!need(res, !w || w.clickup_user_id, `${w && w.name} has no matched ClickUp account.`)) return;
    const r = await cu.createTask(listId, { name, assigneeClickupId: w && w.clickup_user_id, priority: +priority || 3, dueMs: due ? new Date(due + 'T17:00:00').getTime() : undefined, status, description: 'Created from Team HQ' });
    logEvent('hq', 'POST task', name.slice(0, 40));
    await onWebhook({ event: 'hqWriteBack', task_id: r.id });
    ok(res);
  } catch (e) { fail(res, e); }
});
app.post('/api/tasks/:id/comment', async (req, res) => {
  const t = getTask(db, req.params.id); if (!need(res, t && req.body.text, 'task + text required')) return;
  try { if (!db.mode.demo) await cu.addComment(t.cu_id, req.body.text); logEvent('hq', 'POST comment', t.name.slice(0, 40)); ok(res); } catch (e) { fail(res, e); }
});

// --- needs you ---
app.post('/api/needs/ack', (req, res) => { const ids = new Set(req.body.ids || []); applyChange(() => { for (const n of db.needs) if (ids.has(n.id) && n.state === 'open') { n.state = 'acknowledged'; n.ack = Date.now(); } }); ok(res); });
app.post('/api/needs/:id/resolve', async (req, res) => {
  const n = db.needs.find(x => x.id === req.params.id), { action, text } = req.body || {};
  if (!need(res, n, 'item not found')) return;
  if (n.type === 'email') { markDone(n); applyChange(() => { n.state = 'resolved'; n.resolved = Date.now(); }); return ok(res); }
  try {
    const t = n.task && getTask(db, n.task);
    if (text && t && !db.mode.demo) await cu.addComment(t.cu_id, text);
    const own = getOwner(db), from = getWorker(db, n.from);
    applyChange(() => { n.state = 'resolved'; n.resolved = Date.now(); logActivity(own && own.id, 'commented', `${action === 'reply' ? 'Replied to' : action === 'confirm' ? 'Confirmed' : 'Declined'} ${from ? from.name : ''}: ${n.title.slice(0, 40)}`); });
    ok(res);
  } catch (e) { fail(res, e); }
});

// --- people ---
app.post('/api/workers/:id/message', async (req, res) => {
  const w = getWorker(db, req.params.id); if (!need(res, w && w.slack_user_id && req.body.text, 'person has no Slack account, or empty message')) return;
  try { if (!db.mode.demo) await slack.sendDM(w.slack_user_id, req.body.text); logEvent('slack', 'chat.postMessage', `DM to ${w.name}`); ok(res); } catch (e) { fail(res, e); }
});
app.post('/api/workers/:id/status', async (req, res) => {
  const w = getWorker(db, req.params.id), s = req.body.status; if (!need(res, w && MANUAL_STATUSES.includes(s), 'bad status')) return;
  applyChange(() => { if (s === 'none') delete hq.manual[w.id]; else hq.manual[w.id] = s; logEvent('hq', 'manual_status', `${w.name} → ${s}`); });
  let slackSync = 'off';
  if (w.is_owner && slack.userTokenEnabled() && !db.mode.demo) {
    try { await pushStatusToSlack(w, s); slackSync = 'ok'; } catch (e) { logError('slack status', e); slackSync = e.message; }
  }
  res.json({ ok: true, slack: slackSync });
});

// Your HQ status -> your Slack status (needs SLACK_USER_TOKEN). HQ only clears a Slack status that HQ set.
const SLACK_STATUS = {
  focus: { text: 'Focus', emoji: ':dart:', snooze: 60 },
  meeting: { text: 'In a meeting', emoji: ':spiral_calendar_pad:' },
  break: { text: 'On a break', emoji: ':coffee:' }
};
async function pushStatusToSlack(w, s) {
  const want = SLACK_STATUS[s];
  if (want) {
    await slack.setMyStatus(want.text, want.emoji);
    await slack.setMyPresence('auto');
    if (want.snooze) await slack.snooze(want.snooze); else if (hq.slackSet && hq.slackSet.snooze) await slack.endSnooze().catch(() => { });
    hq.slackSet = { status: true, snooze: !!want.snooze };
    applyChange(() => { w.slack_status_text = want.text; w.slack_status_emoji = want.emoji; w.slack_presence = 'active'; });
  } else {
    if (hq.slackSet && hq.slackSet.status) { await slack.setMyStatus('', ''); applyChange(() => { w.slack_status_text = ''; w.slack_status_emoji = ''; }); }
    if (hq.slackSet && hq.slackSet.snooze) await slack.endSnooze().catch(() => { });
    await slack.setMyPresence(s === 'offline' ? 'away' : 'auto');
    hq.slackSet = null;
  }
  logEvent('slack', 'users.profile.set', `Your Slack status → ${want ? want.text : s === 'offline' ? 'away' : 'cleared'}`);
  persist();
}

// --- Google Calendar (clock dropdown) ---
const redirectUri = req => (PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '') + '/auth/google/callback';
app.get('/auth/google', (req, res) => {
  if (!google.googleEnabled()) return res.status(400).send('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env first.');
  res.redirect(google.authUrl(redirectUri(req)));
});
app.get('/auth/google/callback', async (req, res) => {
  try { if (req.query.error) throw new Error(req.query.error); await google.finishAuth(req.query.code, req.query.state, redirectUri(req)); logEvent('hq', 'google_connected', google.googleStatus().email || ''); pollMail(); res.redirect('/?google=connected'); }
  catch (e) { logError('google', e); res.status(400).send(`Google sign-in failed: ${String(e.message).replace(/</g, '&lt;')}. <a href="/">Back to HQ</a>`); }
});
app.get('/api/calendar', async (req, res) => {
  const st = google.googleStatus();
  if (!st.connected) return res.json({ ok: true, ...st, events: [] });
  try { res.json({ ok: true, ...st, events: await google.events(String(req.query.from), String(req.query.to)) }); }
  catch (e) { res.json({ ok: false, ...st, error: e.message, events: [] }); }
});
app.post('/api/google/disconnect', (req, res) => { google.disconnect(); applyChange(() => { for (const n of db.needs) if (n.type === 'email' && n.state !== 'resolved') { n.state = 'resolved'; n.resolved = Date.now(); } }); ok(res); });

// --- groups: named teams of people, each with its own area and station style in the 3D office ---
const STYLES = ['glass', 'cubicle', 'open'];
app.post('/api/groups', (req, res) => {
  const { id, name, style, color, members } = req.body || {};
  const nm = String(name || '').trim().slice(0, 40);
  if (!need(res, nm, 'Give the group a name.')) return;
  if (!need(res, STYLES.includes(style), 'Pick a station style.')) return;
  const ids = [...new Set((members || []).filter(m => getWorker(db, m)))];
  hq.groups = hq.groups || [];
  if (!need(res, !hq.groups.some(g => g.id !== id && g.name.toLowerCase() === nm.toLowerCase()), `There's already a group called ${nm}.`)) return;
  const g = (id && hq.groups.find(x => x.id === id)) || { id: 'g' + Date.now().toString(36) };
  Object.assign(g, { name: nm, style, color: /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#7B5EA7', members: ids });
  if (!hq.groups.includes(g)) hq.groups.push(g);
  // a person sits in one group, so joining this one moves them out of any other
  for (const o of hq.groups) if (o !== g) o.members = o.members.filter(m => !ids.includes(m));
  applyChange(() => logEvent('hq', 'group_saved', `${nm} · ${ids.length} people · ${style}`));
  res.json({ ok: true, id: g.id });
});
app.post('/api/groups/:id/delete', (req, res) => {
  const g = (hq.groups || []).find(x => x.id === req.params.id); if (!need(res, g, 'group not found')) return;
  hq.groups = hq.groups.filter(x => x !== g);
  applyChange(() => logEvent('hq', 'group_deleted', g.name)); ok(res);
});

// --- channel messages + threads, read as you (user token) ---
const people = new Map(); // Slack user id -> { name, avatar }, for people not in HQ
async function whoIs(ids) {
  const out = {};
  for (const id of ids) {
    const w = db.workers.find(x => x.slack_user_id === id);
    if (w) { out[id] = { name: w.name, avatar: w.avatar_url || '', color: w.color, hq: w.id }; continue; }
    if (!people.has(id)) {
      try { const u = await slack.userInfo(id); const p = u.profile || {}; people.set(id, { name: p.display_name || p.real_name || u.name, avatar: p.image_72 || '', color: '#8A94A6' }); }
      catch { people.set(id, { name: 'Someone', avatar: '', color: '#8A94A6' }); }
    }
    out[id] = people.get(id);
  }
  return out;
}
function shapeMessages(msgs) {
  return msgs.filter(m => !['channel_join', 'channel_leave'].includes(m.subtype)).map(m => ({
    ts: m.ts, user: m.user || null, bot: (m.bot_profile && m.bot_profile.name) || m.username || null, bot_icon: (m.bot_profile && m.bot_profile.icons && m.bot_profile.icons.image_48) || '',
    text: emojifyText(m.text || ''), subtype: m.subtype || null, edited: !!m.edited,
    files: (m.files || []).map(f => ({ name: f.name || f.title || 'file', url: f.permalink || '' })),
    reactions: (m.reactions || []).map(r => ({ name: r.name, count: r.count, icon: resolveEmoji(r.name) })),
    thread_ts: m.thread_ts || null, reply_count: m.reply_count || 0, latest_reply: m.latest_reply || null, reply_users: m.reply_users || []
  }));
}
async function withUsers(msgs) {
  const ids = new Set();
  for (const m of msgs) { if (m.user) ids.add(m.user); m.reply_users.forEach(u => ids.add(u)); for (const x of m.text.matchAll(/<@([UW][A-Z0-9]+)/g)) ids.add(x[1]); }
  return { messages: msgs, users: await whoIs([...ids]) };
}
const slackErr = (res, e) => res.json({ ok: false, error: e.message, needsHistory: /missing_scope/.test(e.message) });
app.get('/api/channels/:id/messages', async (req, res) => {
  if (!need(res, slack.userTokenEnabled(), 'Add SLACK_USER_TOKEN to read channels in HQ.')) return;
  try { res.json({ ok: true, ...(await withUsers(shapeMessages((await slack.history(req.params.id)).reverse()))) }); } catch (e) { slackErr(res, e); }
});
app.get('/api/channels/:id/thread/:ts', async (req, res) => {
  if (!need(res, slack.userTokenEnabled(), 'Add SLACK_USER_TOKEN to read threads in HQ.')) return;
  try { res.json({ ok: true, ...(await withUsers(shapeMessages(await slack.replies(req.params.id, req.params.ts)))) }); } catch (e) { slackErr(res, e); }
});

// --- channels: the Slack channels you are in ---
let chCache = { at: 0, data: null };
app.get('/api/channels', async (req, res) => {
  const own = getOwner(db);
  if (!need(res, slack.slackEnabled() && own && own.slack_user_id, 'Connect Slack and set OWNER_EMAIL to see your channels.')) return;
  try {
    if (!chCache.data || Date.now() - chCache.at > 5 * 60000 || req.query.refresh) chCache = { at: Date.now(), data: await slack.myChannels(own.slack_user_id) };
    res.json({ ok: true, channels: chCache.data, team: db.meta.slack_team_id, byUser: slack.userTokenEnabled() });
  } catch (e) { res.status(200).json({ ok: false, error: e.message, byUser: slack.userTokenEnabled() }); }
});
app.post('/api/matches', async (req, res) => { const { slack_user_id, clickup_user_id } = req.body || {}; if (clickup_user_id) hq.matches[slack_user_id] = String(clickup_user_id); else delete hq.matches[slack_user_id]; persist(); await fullSync(); ok(res); });

// --- admin ---
app.post('/api/statusmap', (req, res) => {
  const { list_id, clickup_status, hq_state } = req.body || {};
  hq.overrides[`${list_id}|${String(clickup_status).toLowerCase()}`] = hq_state; rebuildMap();
  logEvent('hq', 'status_map', `${clickup_status} → ${STATE_LBL[hq_state]}`); applyChange(() => {}); ok(res);
});
app.post('/api/sync', async (req, res) => { if (db.mode.demo) return ok(res); await fullSync(); ok(res); });
app.post('/api/sim/:kind', (req, res) => { if (!need(res, db.mode.demo, 'Simulator only runs in demo mode')) return; simulate(req.params.kind); ok(res); });
let simOn = process.env.DEMO_SIM !== 'off';
app.post('/api/demo', (req, res) => { simOn = !!req.body.on; ok(res); });
app.get('/api/demo', (req, res) => res.json({ on: simOn }));

// --- boot ---
loadPersisted();
app.listen(PORT, async () => {
  console.log(`Team HQ on http://localhost:${PORT}${PUBLIC_URL ? '  public: ' + PUBLIC_URL : ''}`);
  if (!LIVE) { loadDemo(); setInterval(() => simOn && randomSim(), 11000); console.log('No tokens set — running the demo workspace.'); return; }
  await fullSync();
  console.log(`Synced: ${db.workers.length} people, ${db.tasks.length} tasks. Mode:`, db.mode);
  await ensureWebhook(PUBLIC_URL);
  const hasHook = () => !!(db.meta.webhook && db.meta.webhook.secret);
  setInterval(fullSync, 1000 * +(process.env.POLL_SECONDS || 0) || (hasHook() ? 300000 : 60000));
  setInterval(pollPresence, 60000);
  pollMail(); setInterval(pollMail, 2 * 60000); // Gmail -> Needs You, once Google is connected
});
