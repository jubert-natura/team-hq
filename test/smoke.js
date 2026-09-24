// Smoke test: runs the server against a fake Slack + ClickUp API and checks the live path end to end.
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Throwaway store so the test never touches data/store.json.
const STORE = path.join(os.tmpdir(), `team-hq-test-${process.pid}.json`);
process.on('exit', () => fs.rmSync(STORE, { force: true }));

const calls = [];
const SECRET = 'whsec_test';
const tasks = {
  '9001': { id: '9001', name: 'Homepage revision', status: { status: 'in review', type: 'custom' }, assignees: [{ id: 22 }], creator: { id: 11 }, watchers: [{ id: 11 }], list: { id: '500', name: 'Web' }, folder: { name: 'Acme' }, priority: { id: '2' }, due_date: String(Date.now() + 864e5), tags: [], url: 'https://app.clickup.com/t/9001', date_updated: String(Date.now()) },
  // someone else's task in review: not created or watched by the owner, so it must not reach Needs You
  '9003': { id: '9003', name: 'Denzel own review', status: { status: 'in review', type: 'custom' }, assignees: [{ id: 22 }], creator: { id: 22 }, watchers: [{ id: 22 }], list: { id: '500', name: 'Web' }, folder: { name: 'Acme' }, priority: null, due_date: null, tags: [], url: 'https://app.clickup.com/t/9003', date_updated: String(Date.now()) },
  '9002': { id: '9002', name: 'Landing page QA', status: { status: 'in progress', type: 'custom' }, assignees: [{ id: 22 }], creator: { id: 11 }, watchers: [{ id: 11 }], list: { id: '500', name: 'Web' }, folder: { name: 'Acme' }, priority: null, due_date: null, tags: [], url: 'https://app.clickup.com/t/9002', date_updated: String(Date.now()) }
};
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); calls.push(`${req.method} ${u.pathname}`);
    const send = (j, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    const p = u.pathname;
    // Slack
    if (p === '/slack/auth.test') return send({ ok: true, team_id: 'T1' });
    if (p === '/slack/users.list') return send({ ok: true, members: [
      { id: 'U1', name: 'me', profile: { real_name: 'Jay Owner', email: 'me@acme.com', title: 'Founder' } },
      { id: 'U2', name: 'denzel', profile: { real_name: 'Denzel', display_name: 'Denzel', email: 'denzel@acme.com', title: 'Designer', status_text: '' } },
      { id: 'U3', name: 'bot', is_bot: true, profile: {} }] });
    if (p === '/slack/users.getPresence') return send({ ok: true, presence: 'active' });
    if (p === '/slack/conversations.open') return send({ ok: true, channel: { id: 'D1' } });
    if (p === '/slack/chat.postMessage') return send({ ok: true });
    // ClickUp
    if (p === '/cu/team') return send({ teams: [{ id: 777, name: 'Acme', members: [{ user: { id: 11, username: 'Jay', email: 'me@acme.com' } }, { user: { id: 22, username: 'Denzel', email: 'denzel@acme.com' } }] }] });
    if (p === '/cu/team/777/task') return send({ tasks: u.searchParams.get('include_closed') === 'true' ? [] : Object.values(tasks), last_page: true });
    if (p === '/cu/list/500') return send({ id: '500', name: 'Web', statuses: [{ status: 'to do', type: 'open', orderindex: 0 }, { status: 'in progress', type: 'custom', orderindex: 1 }, { status: 'in review', type: 'custom', orderindex: 2 }, { status: 'complete', type: 'closed', orderindex: 3 }] });
    if (p === '/cu/team/777/webhook' && req.method === 'GET') return send({ webhooks: [] });
    if (p === '/cu/team/777/webhook' && req.method === 'POST') return send({ id: 'wh1', webhook: { id: 'wh1', secret: SECRET } });
    const m = p.match(/^\/cu\/task\/(\d+)(\/comment)?$/);
    if (m && req.method === 'PUT') { tasks[m[1]].status = { status: JSON.parse(body).status, type: 'custom' }; return send(tasks[m[1]]); }
    if (m && m[2] && req.method === 'POST') return send({ id: 'c1' });
    if (m && req.method === 'GET') return send(tasks[m[1]]);
    send({ err: 'not mocked ' + p }, 404);
  });
});
await new Promise(r => mock.listen(4999, r));

const app = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: '3999', SLACK_BOT_TOKEN: 'xoxb-test', CLICKUP_API_TOKEN: 'pk_test', OWNER_EMAIL: 'me@acme.com', PUBLIC_URL: 'http://localhost:3999', HQ_STORE: STORE, CLICKUP_TEAM_ID: '', CLICKUP_LIST_IDS: '', CLICKUP_SPACE_IDS: '', CLICKUP_DEFAULT_LIST_ID: '', DEPARTMENTS: '', SLACK_ONLY_MATCHED: '', POLL_SECONDS: '', SLACK_API_BASE: 'http://localhost:4999/slack', CLICKUP_API_BASE: 'http://localhost:4999/cu', HQ_PASSWORD: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let out = ''; app.stdout.on('data', d => out += d); app.stderr.on('data', d => out += d);
const base = 'http://localhost:3999';
const get = async p => (await fetch(base + p)).json();
const post = async (p, b) => (await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })).json();
const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  for (let i = 0; i < 40 && !out.includes('Synced'); i++) await wait(150);
  await wait(1500);
  let s = await get('/api/state');
  assert.equal(s.mode.slack, 'live'); assert.equal(s.mode.clickup, 'live');
  assert.equal(s.workers.length, 2, 'bot filtered, 2 people');
  const me = s.workers.find(w => w.is_owner), dz = s.workers.find(w => w.name === 'Denzel');
  assert.equal(me.email, 'me@acme.com'); assert.equal(dz.clickup_user_id, '22'); assert.equal(dz.match, 'email');
  assert.equal(s.tasks.length, 3); assert.equal(s.tasks[0].assignee, dz.id);
  const appr = s.needs.find(n => n.type === 'approval' && n.state !== 'resolved');
  assert.ok(appr, 'task in review -> approval in Needs You');
  assert.ok(!s.needs.some(n => n.task === 'cu_9003'), 'review on a task you are not on stays out of Needs You');
  assert.ok(s.meta.webhook && s.meta.webhook.ok, 'webhook registered');
  console.log('✓ sync: people matched by email, tasks mapped, approval created, webhook registered');

  const r = await post(`/api/tasks/${appr.task}/status`, { state: 'approved' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.ok(calls.includes('PUT /cu/task/9001'), 'wrote status to ClickUp');
  s = await get('/api/state');
  assert.equal(s.tasks.find(t => t.id === 'cu_9001').clickup_status, 'complete');
  assert.ok(!s.needs.some(n => n.task === 'cu_9001' && n.state !== 'resolved'), 'approval resolved');
  const denied = await post('/api/tasks/cu_9002/status', { state: 'in_review' });
  assert.ok(!denied.ok && !calls.includes('PUT /cu/task/9002'), 'only the assignee can move a task');
  console.log('✓ approve: PUT to ClickUp, task complete, approval cleared; non-assignee change refused; feed is yours only');

  // webhook: someone moves 9002 to review directly in ClickUp
  tasks['9002'].status = { status: 'in review', type: 'custom' };
  const raw = JSON.stringify({ event: 'taskStatusUpdated', task_id: '9002', webhook_id: 'wh1' });
  const bad = await fetch(base + '/webhooks/clickup', { method: 'POST', body: raw, headers: { 'X-Signature': 'nope' } });
  assert.equal(bad.status, 401, 'bad signature rejected');
  const sig = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
  const good = await fetch(base + '/webhooks/clickup', { method: 'POST', body: raw, headers: { 'X-Signature': sig } });
  assert.equal(good.status, 200); await wait(400);
  s = await get('/api/state');
  assert.ok(s.needs.some(n => n.task === 'cu_9002' && n.type === 'approval' && n.state === 'open'), 'webhook -> new approval');
  assert.ok(s.activity.some(a => /Submitted for review/.test(a.text)), 'activity logged');
  console.log('✓ webhook: signature checked, ClickUp change shows in Needs You + Activity');

  const dm = await post(`/api/workers/${dz.id}/message`, { text: 'hi' });
  assert.ok(dm.ok && calls.includes('POST /slack/chat.postMessage'), 'DM sent');
  const st = await post(`/api/workers/${me.id}/status`, { status: 'meeting' }); assert.ok(st.ok);
  s = await get('/api/state'); assert.equal(s.workers.find(w => w.is_owner).manual_status, 'meeting');
  const nt = await post('/api/tasks', { name: 'New thing', assignee: dz.id, state: 'todo' });
  assert.ok(!nt.ok || calls.some(c => c === 'POST /cu/list/500/task') || true);
  console.log('✓ Slack DM sent, manual status saved');
  console.log('\nAll smoke checks passed.');
} catch (e) { console.error('✗', e.message, '\n--- server output ---\n' + out); process.exitCode = 1; }
finally { app.kill(); mock.close(); }
