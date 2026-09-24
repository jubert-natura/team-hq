import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { db, hq, loadPersisted, persist, applyChange, rebuildMap, addClient, publicState, logEvent, logError, logActivity } from './store.js';
import { cuStatusFor, task as getTask, worker as getWorker, owner as getOwner, STATE_LBL } from '../shared/model.js';
import * as cu from './clickup.js';
import * as slack from './slack.js';
import { fullSync, pollPresence, ensureWebhook, onWebhook } from './sync.js';
import { loadDemo, simulate, randomSim } from './demo.js';

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
  const t = getTask(db, req.params.id), { state, note } = req.body || {};
  if (!need(res, t, 'task not found')) return;
  const status = cuStatusFor(db, t.list_id, state);
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
  const { name, assignee, list_id, priority, due, state } = req.body || {};
  if (!need(res, name, 'name required')) return;
  const w = getWorker(db, assignee);
  const listId = list_id || process.env.CLICKUP_DEFAULT_LIST_ID || (db.lists[0] && db.lists[0].id);
  if (!need(res, listId, 'No ClickUp list to create in. Set CLICKUP_DEFAULT_LIST_ID.')) return;
  const status = cuStatusFor(db, listId, state || 'todo') || undefined;
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
app.post('/api/workers/:id/status', (req, res) => {
  const w = getWorker(db, req.params.id), s = req.body.status; if (!need(res, w && ['none', 'meeting', 'break', 'offline'].includes(s), 'bad status')) return;
  applyChange(() => { if (s === 'none') delete hq.manual[w.id]; else hq.manual[w.id] = s; logEvent('hq', 'manual_status', `${w.name} → ${s}`); }); ok(res);
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
  setInterval(pollPresence, 120000);
});
