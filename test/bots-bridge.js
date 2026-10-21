import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createKnowledgeBridge, createClaudeRuntime, createCodexRuntime, BridgeError, noteAllowed } from '../server/bots-bridge.js';
import { createBotStore } from '../server/bots-store.js';
import { createBotsRouter, botsErrorHandler } from '../server/bots-router.js';

const commit = 'a'.repeat(40), content = '# Shared skill\nCite facts and identify missing evidence.';
const sha = crypto.createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');
function fakeKnowledge({ privateRepo = true, corrupt = false } = {}) {
  const paths = ['AI/Skills/Review.md', 'Home.md', 'Projects/RASPHIL/Secret.md', 'AI/Inbox/Draft.md', '.obsidian/test.md', 'Submissions/New.md', 'link.md'];
  return createKnowledgeBridge({ run: async (exe, args) => {
    const endpoint = args[1];
    if (endpoint === 'repos/natura-hq/team-knowledge') return JSON.stringify({ private: privateRepo, full_name: 'natura-hq/team-knowledge', default_branch: 'main' });
    if (endpoint.includes('/commits/')) return JSON.stringify({ sha: commit });
    if (endpoint.includes('/git/trees/')) return JSON.stringify({ tree: paths.map(p => ({ type: 'blob', mode: p === 'link.md' ? '120000' : '100644', path: p, sha, size: content.length })) });
    if (endpoint.includes('/git/blobs/')) return JSON.stringify({ encoding: 'base64', size: content.length, content: Buffer.from(corrupt ? 'tampered' : content).toString('base64') });
    throw new Error('Unexpected endpoint');
  }, vault: '' });
}

test('knowledge reads only a private pinned source, excludes unapproved paths and checks blob integrity', async () => {
  const kn = fakeKnowledge();
  const status = await kn.sync();
  assert.deepEqual(status.notes.map(n => n.path), ['AI/Skills/Review.md', 'Home.md']);
  const note = await kn.note('Home.md'); assert.equal(note.content, content); assert.equal(note.commit, commit);
  assert.ok(note.url.includes(`/blob/${commit}/`));
  await assert.rejects(kn.note('../personal.md'), /eligible note/);
  for (const p of ['..\\private.md', '/secret.md', 'AI/Needs Review/a.md', 'Projects/rasphil-copy.md']) assert.equal(noteAllowed(p), false);
  await assert.rejects(fakeKnowledge({ privateRepo: false }).sync(), /private repository/);
  await assert.rejects(fakeKnowledge({ corrupt: true }).note('Home.md'), /integrity/);
});

test('Claude verification needs a usable response; arguments disable tools, MCP, hooks and persistence', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-runtime-'));
  try {
    let release, seen;
    const runtime = createClaudeRuntime({ cwd: dir, run: async (exe, args, options) => { seen = { args, options }; await new Promise(r => { release = r; }); return JSON.stringify({ result: 'Draft ready.' }); } });
    assert.equal(runtime.status().connected, false);
    const first = runtime.draft('Shared selected context');
    assert.equal(runtime.status().busy, true);
    await assert.rejects(runtime.draft('duplicate'), /already running/);
    release(); await first;
    assert.equal(runtime.status().connected, true);
    assert.equal(seen.args[seen.args.indexOf('--tools') + 1], '');
    assert.ok(seen.args.includes('--strict-mcp-config')); assert.ok(seen.args.includes('--disable-slash-commands'));
    assert.ok(seen.args.includes('{"disableAllHooks":true}')); assert.ok(seen.args.includes('--no-session-persistence'));
    assert.ok(!seen.args.join(' ').includes('Shared selected context')); assert.equal(seen.options.input, 'Shared selected context');
    const expired = createClaudeRuntime({ cwd: dir, run: async () => JSON.stringify({ is_error: true, result: 'OAuth access token is invalid. 401' }) });
    await assert.rejects(expired.verify(), /claude auth login/); assert.equal(expired.status().connected, false);
    const codex = createCodexRuntime({ cwd: dir, run: async (exe, args) => {
      assert.ok(args.includes('view_image')); assert.ok(args.includes('shell_tool')); assert.ok(args.includes('apps')); assert.ok(args.includes('--ignore-user-config'));
      return [{ type: 'thread.started', thread_id: 'probe' }, { type: 'item.completed', item: { type: 'error', message: 'Code Mode is unavailable because code-mode host is disabled. Code mode will fail closed.' } }, { type: 'item.completed', item: { type: 'agent_message', text: 'Ready.' } }, { type: 'turn.completed' }].map(x => JSON.stringify(x)).join('\n');
    } });
    await codex.verify(); assert.equal(codex.status().provider, 'Codex');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

async function harness({ admin = true, store, knowledge, runtime }) {
  const app = express(); app.use(express.json()); app.use((req, res, next) => { req.admin = admin; next(); });
  app.use('/api', createBotsRouter({ store, knowledge, runtime }), botsErrorHandler);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return {
    async call(p, body, dataset = 'real') {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-bot-dataset': dataset }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, ...await r.json() };
    }, close: () => new Promise(r => server.close(r))
  };
}

test('owner pipeline imports reviewed skills, executes selected sources, isolates demo and preserves evidence after restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-pipeline-')), file = path.join(dir, 'store.json');
  const store = createBotStore({ file }), knowledge = fakeKnowledge();
  let finish, supplied, calls = 0;
  const runtime = { status: () => ({ adapter: true, connected: true, provider: 'Test runtime', busy: false }), draft: async input => { calls++; supplied = JSON.parse(input); await new Promise(r => { finish = r; }); return { text: 'Draft with Home.md evidence.' }; } };
  const hq = await harness({ store, knowledge, runtime });
  const newTask = () => hq.call('/tasks', { title: 'Draft shared review', project: 'Bridge check', bot: 'reviewer', criteria: 'Use selected notes and cite the exact source.' });
  try {
    assert.equal((await hq.call('/knowledge/sync', {}, 'demo')).status, 400);
    await hq.call('/knowledge/sync', {});
    assert.equal((await hq.call('/roster/reviewer/knowledge', { paths: ['../../Noah.md'] })).status, 400);
    await hq.call('/roster/reviewer/knowledge', { paths: ['Home.md'] });
    assert.equal((await hq.call('/roster/reviewer/knowledge/import', { path: 'AI/Skills/Review.md', sha: 'outdated' })).status, 409);
    const imported = await hq.call('/roster/reviewer/knowledge/import', { path: 'AI/Skills/Review.md', sha });
    assert.equal(imported.skill.origin.sha, sha);
    const offSkill = await hq.call('/roster/reviewer/skills', { name: 'Disabled secret instruction', trigger: 'Always', instructions: 'Should not reach the model.' });
    await hq.call(`/roster/reviewer/skills/${offSkill.skill.id}/enabled`, { enabled: false });
    const t = (await newTask()).task;
    assert.equal((await hq.call(`/tasks/${t.id}/run`, {}, 'demo')).status, 400);
    assert.equal((await hq.call(`/tasks/${t.id}/run`, {})).task.execution, 'in_progress');
    assert.equal((await hq.call(`/tasks/${t.id}/run`, {})).status, 409);
    assert.equal((await hq.call(`/tasks/${t.id}/execution`, { status: 'completed' })).status, 409);
    assert.equal((await hq.call(`/tasks/${t.id}/review`, { status: 'passed' })).status, 409);
    assert.equal(calls, 1); assert.equal(supplied.bot.skills.length, 1); assert.equal(supplied.shared_reference_notes[0].sha, sha);
    finish();
    for (let i = 0; i < 30 && store.read('real').tasks[0].run.status === 'running'; i++) await new Promise(r => setTimeout(r, 10));
    const result = store.read('real').tasks[0];
    assert.equal(result.execution, 'completed'); assert.equal(result.review, 'pending'); assert.equal(result.reviews.length, 0);
    assert.equal(result.run.sources[0].commit, commit); assert.equal(result.run.skills[0].version, 1); assert.ok(result.run.output);
    assert.equal(createBotStore({ file }).read('real').tasks[0].run.output, result.run.output);
    await hq.call('/roster/reviewer/enabled', { enabled: false });
    const another = (await hq.call('/tasks', { title: 'Another bot', project: 'Bridge check', bot: 'claude', criteria: 'Do a complete documented draft.' })).task;
    await hq.call('/roster/claude/enabled', { enabled: false });
    assert.equal((await hq.call(`/tasks/${another.id}/run`, {})).status, 400);
    store.mutate('real', d => { d.tasks[0].run.status = 'running'; d.tasks[0].execution = 'in_progress'; });
    const reboot = await harness({ store: createBotStore({ file }), knowledge, runtime });
    try { const st = await reboot.call('/state'); assert.equal(st.tasks[0].run.status, 'interrupted'); assert.equal(st.tasks[0].execution, 'blocked'); }
    finally { await reboot.close(); }
    const noOwner = await harness({ admin: false, store, knowledge, runtime });
    try { assert.equal((await noOwner.call('/knowledge/sync', {})).status, 403); assert.equal((await noOwner.call('/runtime/verify', {})).status, 403); }
    finally { await noOwner.close(); }
  } finally { await hq.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
