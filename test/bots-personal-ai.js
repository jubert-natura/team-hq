import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createPersonalAI } from '../server/bots-personal-ai.js';
import { createBotStore } from '../server/bots-store.js';
import { createBotsRouter, botsErrorHandler } from '../server/bots-router.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hq-personal-'));
process.env.HQ_STORE = path.join(dir, 'human.json');
const { createSession, sessionEmail } = await import('../server/users.js');
let seq = 0;
const file = () => path.join(dir, `accounts-${++seq}.json`);
const a = 'alice@example.com', b = 'bob@example.com', owner = 'owner@example.com';
const keyA = 'test-alice-key-123456789', keyB = 'test-bob-key-987654321';
const config = (api_key, provider = 'openai') => ({ provider, api_key, model: 'test-model' });
const reply = (text = 'A draft for review.') => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }));
after(async () => { await new Promise(r => setTimeout(r, 300)); fs.rmSync(dir, { recursive: true, force: true }); });

test('personal keys are encrypted, bound to identity, and recover only with their matching key file', async () => {
  const f = file(), ai = createPersonalAI({ file: f, fetcher: async () => reply() });
  ai.save(a, config(keyA)); ai.save(b, config(keyB)); await ai.verify(a);
  const raw = fs.readFileSync(f, 'utf8');
  assert.ok(!raw.includes(keyA) && !raw.includes(keyB));
  assert.ok(!JSON.stringify(ai.status(a)).includes(keyA));
  assert.equal(ai.status(a).connected, true); assert.equal(ai.status(b).connected, false);
  assert.equal(createPersonalAI({ file: f }).status(a).connected, true);
  const originalKey = fs.readFileSync(`${f}.key`);
  fs.writeFileSync(`${f}.key`, Buffer.alloc(32, 1));
  assert.throws(() => createPersonalAI({ file: f }), /matching encrypted file and key/);
  assert.equal(fs.readFileSync(f, 'utf8'), raw);
  fs.unlinkSync(`${f}.key`); assert.throws(() => createPersonalAI({ file: f }), /key is missing/);
  fs.writeFileSync(`${f}.key`, originalKey);
  const tampered = JSON.parse(raw); tampered.profiles[a] = tampered.profiles[b]; fs.writeFileSync(f, JSON.stringify(tampered));
  assert.throws(() => createPersonalAI({ file: f }), /cannot be read/);
});

test('fixed provider adapters use only the selected person key and refuse incomplete or tool results', async () => {
  const requests = [], ai = createPersonalAI({ file: file(), fetcher: async (url, options) => {
    requests.push({ url, ...options, body: JSON.parse(options.body) });
    return url.includes('anthropic') ? new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Claude draft.' }] })) : reply(keyA);
  } });
  ai.save(a, config(keyA)); ai.save(b, config(keyB, 'anthropic')); await ai.verify(a); await ai.verify(b);
  const result = await ai.runtime(a).draft('My brief'); await ai.runtime(b).draft('Bob brief');
  assert.equal(result.text, '[credential removed]');
  assert.equal(requests[2].headers.authorization, `Bearer ${keyA}`); assert.equal(requests[2].body.store, false);
  assert.equal(requests[3].headers['x-api-key'], keyB); assert.equal(requests[3].headers['anthropic-version'], '2023-06-01');
  assert.equal(requests[3].body.model, 'test-model'); assert.equal(requests[3].redirect, 'error');
  assert.ok(!requests[3].body.tools && !JSON.stringify(requests[3].body).includes(keyB));
  const truncated = createPersonalAI({ file: file(), fetcher: async () => new Response(JSON.stringify({ status: 'incomplete', output: [] })) });
  truncated.save(a, config(keyA)); await assert.rejects(truncated.verify(a), /did not finish/); assert.equal(truncated.status(a).connected, false);
  const tool = createPersonalAI({ file: file(), fetcher: async () => new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use' }] })) });
  tool.save(a, config(keyA, 'anthropic')); await assert.rejects(tool.verify(a), /text-only/);
});

test('provider error bodies never reach the browser and a changed connection invalidates an old runtime', async () => {
  let reject = false;
  const ai = createPersonalAI({ file: file(), fetcher: async () => reject ? new Response(`sensitive ${keyA}`, { status: 401 }) : reply() });
  ai.save(a, config(keyA)); await ai.verify(a); const stale = ai.runtime(a);
  ai.save(a, config(keyB)); assert.equal(ai.status(a).connected, false);
  await assert.rejects(stale.draft('brief'), /connection changed/);
  reject = true; await assert.rejects(ai.verify(a), /rejected your API key/);
  assert.ok(!ai.status(a).error.includes(keyA));
  ai.disconnect(a); assert.equal(ai.status(a).configured, false);
  assert.throws(() => ai.runtime(a), /own API account/);
});

test('an active personal request prevents credential replacement and failed runs clear verification', async () => {
  let hold = false, release, failRequest = false;
  const ai = createPersonalAI({ file: file(), fetcher: async () => {
    if (hold) await new Promise(r => { release = r; });
    return failRequest ? new Response('private diagnostics', { status: 403 }) : reply();
  } });
  ai.save(a, config(keyA)); await ai.verify(a); hold = true;
  const request = ai.runtime(a).draft('A real draft');
  assert.equal(ai.status(a).busy, true);
  assert.throws(() => ai.save(a, config(keyB)), /active request/);
  assert.throws(() => ai.disconnect(a), /active request/);
  await assert.rejects(ai.verify(a), /active request/);
  assert.equal(ai.status(a).connected, true); release(); await request;
  hold = false; failRequest = true;
  await assert.rejects(ai.runtime(a).draft('Another draft'), /cannot access/);
  assert.equal(ai.status(a).connected, false); assert.equal(ai.status(a).busy, false);
});

async function harness({ ready = true, sync = async () => ({}) } = {}) {
  const dispatched = [], ai = createPersonalAI({ file: file(), fetcher: async (url, options) => { dispatched.push({ url, ...options }); return reply('A verified personal draft.'); } });
  const store = createBotStore({ file: path.join(dir, `bots-${++seq}.json`) });
  let cliCalls = 0;
  const app = express(); app.use(express.json());
  const sessions = Object.fromEntries([a, b, owner].map(email => [email, createSession(email)]));
  app.use((req, res, next) => {
    req.email = sessionEmail((req.get('cookie') || '').replace(/^hq_sid=/, ''));
    if (!req.email) return res.status(401).json({ ok: false, error: 'Sign in to Human HQ.' });
    req.admin = req.email === owner; next();
  });
  app.use('/api/bots', createBotsRouter({ store, ownerEmail: () => owner, personalAI: ai, authReady: () => ready, candidates: () => [{ email: a }, { email: b }],
    runtime: { status: () => ({ connected: true, provider: 'Owner CLI' }), draft: () => { cliCalls++; throw new Error('Must never run'); } },
    knowledge: { status: () => ({ notes: [] }), sync, note: async () => { throw new Error('No notes selected'); } }
  }), botsErrorHandler);
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { ai, store, dispatched, cliCalls: () => cliCalls,
    async call(email, route, body, extra = {}) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/api/bots${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: `hq_sid=${sessions[email] || 'invalid'}`, 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, ...await res.json() };
    }, close: () => new Promise(r => server.close(r))
  };
}
const brief = { title: 'Personal draft', project: 'Team onboarding', criteria: 'Return a short draft for review.', bot: 'claude', output_url: '' };

test('real HQ sessions, explicit approval and task ownership isolate two people without CLI fallback', async () => {
  const h = await harness();
  try {
    assert.equal((await h.call(a, '/state')).status, 403);
    assert.equal((await h.call('invalid', '/state', undefined, { 'x-user-email': owner })).status, 401);
    assert.equal((await h.call(owner, '/access', { email: 'stranger@example.com', enabled: true })).status, 403);
    for (const email of [a, b]) assert.equal((await h.call(owner, '/access', { email, enabled: true })).status, 200);
    const createdA = await h.call(a, '/tasks', { ...brief, created_by: b }), createdB = await h.call(b, '/tasks', brief);
    assert.equal(createdA.task.created_by, a);
    const id = createdA.task.id;
    assert.equal((await h.call(a, `/tasks/${id}/run`, {})).status, 409);
    assert.equal(h.cliCalls(), 0);
    assert.equal((await h.call(a, '/state')).tasks.length, 1);
    for (const suffix of ['run', 'review', 'execution', 'note']) assert.equal((await h.call(b, `/tasks/${id}/${suffix}`, { status: 'passed', text: 'malicious edit' })).status, 404);
    assert.equal((await h.call(a, '/roster/claude/enabled', { enabled: false })).status, 403);
    assert.equal((await h.call(a, '/state', undefined, { 'x-bot-dataset': 'demo' })).status, 403);
    assert.equal((await h.call(a, '/account', { ...config(keyA), email: b })).status, 200);
    await h.call(b, '/account', config(keyB)); await h.call(a, '/runtime/verify', {}); await h.call(b, '/runtime/verify', {});
    assert.equal((await h.call(a, `/tasks/${id}/run`, {})).status, 200);
    let done;
    for (let i = 0; i < 40; i++) { done = (await h.call(a, '/state')).tasks[0]; if (done.execution === 'completed') break; await new Promise(r => setTimeout(r, 20)); }
    assert.equal(done.execution, 'completed'); assert.equal(done.review, 'pending'); assert.equal(done.run.executed_by, a); assert.equal(done.run.model, 'test-model');
    assert.equal(h.dispatched.at(-1).headers.authorization, `Bearer ${keyA}`); assert.equal(h.cliCalls(), 0);
    await h.call(b, `/tasks/${createdB.task.id}/run`, {});
    for (let i = 0; i < 40; i++) { if ((await h.call(b, '/state')).tasks[0].execution === 'completed') break; await new Promise(r => setTimeout(r, 20)); }
    assert.equal(h.dispatched.at(-1).headers.authorization, `Bearer ${keyB}`);
    const reviewed = await h.call(a, `/tasks/${id}/review`, { status: 'passed', note: 'Checked the complete result.' });
    assert.equal(reviewed.task.reviews[0].reviewed_by, a);
    await h.call(a, '/account/disconnect', {});
    assert.equal((await h.call(b, '/account')).runtime.connected, true);
    assert.ok(!JSON.stringify(await h.call(owner, '/state')).includes(keyA));
    await h.call(owner, '/access', { email: a, enabled: false });
    assert.equal((await h.call(a, '/state')).status, 403); assert.equal((await h.call(b, '/state')).status, 200);
  } finally { await h.close(); }
});

test('teammate grants require configured Human HQ identity and cross-site credential writes are refused', async () => {
  const h = await harness({ ready: false });
  try {
    assert.equal((await h.call(owner, '/access', { email: a, enabled: true })).status, 409);
    assert.equal((await h.call(owner, '/account', config(keyA), { origin: 'https://evil.example' })).status, 403);
    assert.equal(h.ai.status(owner).configured, false);
  } finally { await h.close(); }
});

test('revoking access during note loading prevents provider dispatch', async () => {
  let release;
  const h = await harness({ sync: () => new Promise(r => { release = r; }) });
  try {
    await h.call(owner, '/access', { email: a, enabled: true });
    await h.call(a, '/account', config(keyA)); await h.call(a, '/runtime/verify', {});
    const { task } = await h.call(a, '/tasks', brief);
    await h.call(a, `/tasks/${task.id}/run`, {});
    await h.call(owner, '/access', { email: a, enabled: false }); release({});
    let record;
    for (let i = 0; i < 40; i++) { record = h.store.read('real').tasks[0]; if (record.execution === 'blocked') break; await new Promise(r => setTimeout(r, 20)); }
    assert.equal(record.execution, 'blocked'); assert.match(record.run.error, /access was revoked/);
    assert.equal(h.dispatched.length, 1); assert.equal(h.cliCalls(), 0);
  } finally { await h.close(); }
});
