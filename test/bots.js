// AI workspace tests: shared model calculations, the /api/bots router (validation, persistence, authorization,
// demo isolation, corrupt store handling) and the router mounted in the real server. Run: npm run test:bot
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import * as M from '../shared/bots-model.js';
import * as NAVM from '../shared/bots-nav.js';
import { createBotStore } from '../server/bots-store.js';
import { createBotsRouter, botsErrorHandler } from '../server/bots-router.js';
import { buildDemo } from '../server/bots-demo.js';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'team-bot-test-'));
after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* a file may still be closing on Windows */ } });
let fileN = 0;
const tmpFile = () => path.join(TMP, `bots-${++fileN}.json`);

// ---------- helpers ----------
const iso = ms => new Date(ms).toISOString();
const T0 = Date.UTC(2026, 9, 14, 9, 0, 0);
const ROSTER = M.seedBots(iso(T0));
function mkTask(over = {}) {
  return { id: 'task_x' + Math.random().toString(36).slice(2, 10), number: 1, title: 'T', bot: 'claude', project: 'P', criteria: 'Some criteria', output_url: '', execution: 'queued', review: 'not_requested', created_at: iso(T0), updated_at: iso(T0), started_at: null, finished_at: null, events: [], reviews: [], ...over };
}
const rev = (outcome, min, note = '', issue = '') => ({ id: 'rev_x' + min, at: iso(T0 + min * 60000), outcome, note, issue });

/** An in-process app with the router, the same JSON parser and error handler as the server, and a chosen owner flag. */
async function startRouter({ file = tmpFile(), admin = true, store } = {}) {
  store = store || createBotStore({ file });
  const app = express();
  app.use(express.json({ limit: '200kb' }));
  app.use((req, res, next) => { req.admin = admin; req.email = null; next(); });
  app.use('/api/bots', createBotsRouter({ store, ownerEmail: () => 'jay.owner@example.com' }), botsErrorHandler);
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/bots`;
  const call = async (p, { method = 'GET', body, dataset, headers = {}, raw } = {}) => {
    const h = { ...headers };
    if (dataset) h['X-Bot-Dataset'] = dataset;
    if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const res = await fetch(base + p, { method, headers: h, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch { /* none */ }
    return { status: res.status, json };
  };
  return { file, store, call, close: () => new Promise(r => server.close(r)) };
}
const good = { title: 'Responsive navigation', bot: 'claude', project: 'Website redesign', criteria: 'Works at 390, 768 and 1440 px without overlap.' };
// A stored skill with a source review, as the router saves it.
const SOURCE_REC = { url: 'https://github.com/vercel-labs/skills/blob/9f3c2b1a0d/skills/find-skills/SKILL.md', revision: '9f3c2b1a0d', license: 'MIT', files: ['SKILL.md'], required_tools: [], adaptation: 'instructions', test: 'Check candidates on a real task.', compatibility: 'ready', reviewed_at: iso(T0) };
const SKILL_REC = { id: 'skill_goodshape1', name: 'Find skills', trigger: 'When a capability is missing', instructions: 'List candidates with sources.', reference_url: '', enabled: true, version: 1, created_at: iso(T0), updated_at: iso(T0) };

// ---------- model ----------
test('empty data gives em dashes and nulls, never NaN', () => {
  const p = M.performance([]);
  assert.equal(p.reviewed, 0); assert.equal(p.firstPassRate, null); assert.equal(p.medianMs, null);
  assert.equal(M.fmtPercent(p.firstPassRate), '—'); assert.equal(M.fmtDuration(p.medianMs), '—');
  const r = M.buildReport([], [], { from: '2026-10-12', to: '2026-10-18', ...M.rangeBounds('2026-10-12', '2026-10-18', 0) }, ROSTER);
  const text = JSON.stringify(r) + M.reportMarkdown(r);
  assert.ok(!/NaN|Infinity|undefined/.test(text), text);
  assert.deepEqual(r.went_well, []); assert.deepEqual(r.next_steps, []);
  const rows = M.botComparison([], ROSTER);
  assert.equal(rows.length, 4);
  for (const b of rows) { assert.equal(b.reviewed, 0); assert.equal(b.firstPassRate, null); }
});

test('first-pass acceptance uses recorded review history, not final status; unreviewed tasks are excluded', () => {
  const reworked = mkTask({ execution: 'completed', review: 'passed', reviews: [rev('passed', 30), rev('changes_requested', 10, 'Tablet menu overlaps logo', 'Mobile layout')] });
  const clean = mkTask({ execution: 'completed', review: 'passed', reviews: [rev('passed', 12)] });
  const pending = mkTask({ execution: 'completed', review: 'pending' });
  const unreviewed = mkTask({ execution: 'completed' });
  const p = M.performance([reworked, clean, pending, unreviewed]);
  assert.equal(p.total, 4);
  assert.equal(p.reviewed, 2, 'pending and unreviewed are not in the denominator');
  assert.equal(p.firstPass, 1, 'final status passed but first review was a change request');
  assert.equal(p.firstPassRate, 0.5);
  assert.equal(p.rework, 1); assert.equal(p.reworkRounds, 1);
  assert.equal(M.firstReview(reworked).outcome, 'changes_requested', 'reviews are ordered by time, not array order');
});

test('median duration only uses completed tasks with a valid start and finish', () => {
  const ok1 = mkTask({ execution: 'completed', started_at: iso(T0), finished_at: iso(T0 + 10 * 60000) });
  const ok2 = mkTask({ execution: 'completed', started_at: iso(T0), finished_at: iso(T0 + 20 * 60000) });
  const noStart = mkTask({ execution: 'completed', finished_at: iso(T0) });
  const backwards = mkTask({ execution: 'completed', started_at: iso(T0 + 60000), finished_at: iso(T0) });
  const garbage = mkTask({ execution: 'completed', started_at: 'yesterday', finished_at: iso(T0) });
  const open = mkTask({ execution: 'in_progress', started_at: iso(T0), finished_at: iso(T0 + 1e6) });
  const p = M.performance([ok1, ok2, noStart, backwards, garbage, open]);
  assert.equal(p.timed, 2); assert.equal(p.medianMs, 15 * 60000);
  assert.equal(M.fmtDuration(p.medianMs), '15 min');
  assert.equal(M.median([3, 1, 2]), 2); assert.equal(M.median([]), null); assert.equal(M.median([NaN, 4]), 4);
});

test('recurring issues group review notes by issue label', () => {
  const a = mkTask({ bot: 'claude', reviews: [rev('changes_requested', 1, 'Menu overlaps logo', 'Mobile layout')] });
  const b = mkTask({ bot: 'claude', reviews: [rev('changes_requested', 2, 'Cards stack on tablet', 'mobile  LAYOUT')] });
  const c = mkTask({ bot: 'researcher', reviews: [rev('changes_requested', 3, 'No source link for claim 2')] });
  const d = mkTask({ reviews: [rev('passed', 4, 'Looks good')] });
  const issues = M.reviewIssues([a, b, c, d]);
  assert.equal(issues.length, 2);
  assert.equal(issues[0].label, 'Mobile layout'); assert.equal(issues[0].count, 2); assert.equal(issues[0].recurring, true); assert.equal(issues[0].bot, 'claude');
  assert.equal(issues[1].count, 1); assert.equal(issues[1].recurring, false);
  const s = M.suggestions([a, b, c, d], [], ROSTER);
  assert.match(s[0].title, /^Claude:/);
  assert.ok(s.every(x => M.SUGGESTION_KEY_RE.test(x.key)));
  assert.equal(s[0].key, 'issue:mobile-layout');
});

test('lesson validation needs five distinct trial tasks whose latest result is a pass', () => {
  const l = { status: 'testing', version: 1, tests: [] };
  const add = (result, task, evidence = 'Followed it; reviewer passed.', version = 1) => l.tests.push({ at: iso(T0 + l.tests.length * 60000), result, evidence, task, version });
  for (const t of ['task_aaaaaaaa', 'task_bbbbbbbb', 'task_cccccccc', 'task_dddddddd']) add('pass', t);
  assert.equal(M.lessonTransition(l, 'validated').ok, false);
  add('pass', 'task_eeeeeeee', '   '); // no evidence: does not count
  assert.equal(M.lessonEvidence(l).passes, 4);
  add('pass', 'task_eeeeeeee');
  assert.equal(M.lessonEvidence(l).passes, 5);
  assert.equal(M.lessonTransition(l, 'validated').ok, true);
  // regression: task A passed, later failed; E passes again. A counts by its latest result, so 4 pass.
  add('fail', 'task_aaaaaaaa', 'Skipped the tablet check.');
  add('pass', 'task_eeeeeeee');
  const e = M.lessonEvidence(l);
  assert.equal(e.passes, 4); assert.equal(e.fails, 1); assert.equal(e.canValidate, false);
  assert.match(M.lessonTransition(l, 'validated').reason, /4 recorded/);
  // retrying A and passing restores it
  add('pass', 'task_aaaaaaaa');
  assert.equal(M.lessonEvidence(l).passes, 5); assert.equal(M.lessonTransition(l, 'validated').ok, true);
  // a later failure on another task blocks validation even with five passing tasks
  add('fail', 'task_ffffffff', 'Missed a breakpoint.');
  assert.equal(M.lessonEvidence(l).passes, 5);
  assert.match(M.lessonTransition(l, 'validated').reason, /most recent/i);

  // unlinked trials are notes: they never satisfy the gate
  const notes = { status: 'testing', version: 1, tests: [] };
  for (let i = 0; i < 6; i++) notes.tests.push({ at: iso(T0 + i), result: 'pass', evidence: 'Evidence text', task: '', version: 1 });
  const ne = M.lessonEvidence(notes);
  assert.equal(ne.passes, 0); assert.equal(ne.unlinked, 6); assert.equal(M.lessonTransition(notes, 'validated').ok, false);
  // repeated passes on one task count once
  const same = { status: 'testing', version: 1, tests: [] };
  for (let i = 0; i < 6; i++) same.tests.push({ at: iso(T0 + i), result: 'pass', evidence: 'Evidence text', task: 'task_same00001', version: 1 });
  assert.equal(M.lessonEvidence(same).passes, 1, 'passes on the same task count once');
  // order comes from timestamps, not array order
  const shuffled = { status: 'testing', version: 1, tests: [
    { at: iso(T0 + 2000), result: 'fail', evidence: 'Later failure', task: 'task_ordered01', version: 1 },
    { at: iso(T0 + 1000), result: 'pass', evidence: 'Earlier pass', task: 'task_ordered01', version: 1 }] };
  assert.equal(M.lessonEvidence(shuffled).passes, 0);
  assert.equal(M.lessonTransition({ status: 'proposed', tests: [] }, 'validated').ok, false, 'cannot skip testing');
});

test('validators reject unsafe links, bad dates and odd numbers', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://x.y', '//evil.com', 'https://user:pw@x.com', 'http://', 'notaurl'])
    assert.throws(() => M.httpUrl(bad, 'url'), M.ValidationError, bad);
  assert.equal(M.httpUrl('https://github.com/org/repo/pull/1', 'url'), 'https://github.com/org/repo/pull/1');
  assert.equal(M.safeHttpUrl('JaVaScRiPt:alert(1)'), null);
  for (const bad of ['2026-02-30', '2026-13-01', '26-10-01', '2026/10/01', 20261001, ''])
    assert.throws(() => M.isoDate(bad, 'from'), M.ValidationError, String(bad));
  assert.throws(() => M.rangeBounds('2026-10-18', '2026-10-12', 0), M.ValidationError);
  assert.throws(() => M.rangeBounds('2026-10-12', '2026-10-18', 'NaN'), M.ValidationError);
  assert.throws(() => M.finiteNumber(Infinity, 'n'), M.ValidationError);
  assert.throws(() => M.text('a\u0000b', 'title'), M.ValidationError);
  assert.throws(() => M.text({ x: 1 }, 'title'), M.ValidationError);
  const b = M.rangeBounds('2026-10-12', '2026-10-18', -480); // Manila
  assert.equal(new Date(b.start).toISOString(), '2026-10-11T16:00:00.000Z');
  assert.equal(b.end - b.start, 7 * 864e5);
});

test('markdown export escapes user text', () => {
  const t = mkTask({ title: '<img src=x onerror=alert(1)>', execution: 'blocked' });
  const r = M.buildReport([t], [], { from: '2026-10-12', to: '2026-10-18', ...M.rangeBounds('2026-10-12', '2026-10-18', 0) }, ROSTER);
  const md = M.reportMarkdown(r);
  assert.ok(!/(^|[^\\])<img/m.test(md), md);
  assert.ok(md.includes('\\<img'));
});

test('demo fixture matches the rules it is shown under', () => {
  const d = buildDemo(Date.UTC(2026, 9, 21, 4, 0, 0));
  assert.ok(d.tasks.length >= 10 && d.lessons.length === 6);
  const ids = d.bots.map(b => b.id);
  assert.ok(d.bots.every(b => M.BOT_ID_RE.test(b.id) && M.STYLE_IDS.includes(b.avatar.style) && b.connection.status === 'disconnected'));
  for (const t of d.tasks) assert.ok(M.ID_RE.test(t.id) && ids.includes(t.bot) && M.EXEC[t.execution] && M.REVIEW[t.review], t.title);
  const archived = M.archivedBots(d.bots);
  assert.equal(archived.length, 1);
  assert.ok(d.tasks.some(t => t.bot === archived[0].id), 'the archived bot keeps its task');
  const demoLayout = M.arrangeDesks(d.bots);
  assert.equal(demoLayout.desks.length, 5, 'one workstation per active bot');
  assert.ok(demoLayout.desks.some(x => x.bot.id === 'bot_demodesign01' && x.slot === 4), 'the fifth bot keeps its stored desk');
  for (const l of d.lessons.filter(x => x.status === 'validated')) assert.ok(M.lessonEvidence(l).canValidate, l.title);
  assert.ok(!JSON.stringify(d).includes('NaN'));
  assert.equal(d.reports.length, 1, 'one snapshot, computed from the fixture');
});

// ---------- router ----------
test('real workspace starts empty with four disconnected roles, and reads do not create the file', async () => {
  const s = await startRouter();
  try {
    const r = await s.call('/state');
    assert.equal(r.status, 200); assert.equal(r.json.ok, true); assert.equal(r.json.dataset, 'real');
    assert.deepEqual([r.json.tasks.length, r.json.lessons.length, r.json.reports.length], [0, 0, 0]);
    assert.equal(r.json.bots.length, 4);
    assert.ok(r.json.bots.every(b => b.connection === 'disconnected'));
    assert.equal(M.teamCounts(r.json.tasks, r.json.bots).working, 0, 'no fabricated working status');
    assert.equal(r.json.runtime.dispatch, false);
    assert.equal(r.json.knowledge.url, 'https://github.com/natura-hq/team-knowledge');
    assert.equal(r.json.viewer.initials, 'JO');
    assert.equal(fs.existsSync(s.file), false);
  } finally { await s.close(); }
});

test('validation returns consistent 400s and never writes', async () => {
  const s = await startRouter();
  try {
    const cases = [
      [{ ...good, title: '' }, 'title'], [{ ...good, title: 'x'.repeat(121) }, 'title'], [{ ...good, bot: 'gpt5' }, 'bot'], [{ ...good, bot: 'unknownbot' }, 'bot'],
      [{ ...good, project: 42 }, 'project'], [{ ...good, criteria: 'short' }, 'criteria'],
      [{ ...good, output_url: 'javascript:alert(1)' }, 'output_url'], [{ ...good, output_url: 'data:text/html,x' }, 'output_url']
    ];
    for (const [body, field] of cases) {
      const r = await s.call('/tasks', { method: 'POST', body });
      assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(r.json.ok, false); assert.equal(r.json.field, field); assert.equal(typeof r.json.error, 'string');
    }
    const bad = await s.call('/tasks', { method: 'POST', raw: '{"title":', headers: { 'Content-Type': 'application/json' } });
    assert.equal(bad.status, 400); assert.equal(bad.json.ok, false);
    assert.equal((await s.call('/tasks', { method: 'POST', raw: 'title=x', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })).status, 415);
    assert.equal((await s.call('/tasks', { method: 'POST', body: good, headers: { Origin: 'https://evil.example' } })).status, 403);
    for (const method of ['PUT', 'PATCH', 'DELETE']) {
      const r = await s.call('/tasks', { method, body: good });
      assert.equal(r.status, 405, method); assert.equal(r.json.ok, false);
    }
    assert.equal((await s.call('/tasks/not-an-id/execution', { method: 'POST', body: { status: 'completed' } })).status, 400);
    assert.equal((await s.call('/tasks/task_doesnotexist1/execution', { method: 'POST', body: { status: 'completed' } })).status, 404);
    assert.equal((await s.call('/nope')).status, 404);
    assert.equal((await s.call('/state', { dataset: 'other' })).status, 400);
    assert.equal((await s.call('/reports/preview?from=2026-10-12&to=2026-10-40')).status, 400);
    assert.equal((await s.call('/reports/preview?from=2026-10-12&to=2026-10-18&tz=abc')).status, 400);
    assert.equal(fs.existsSync(s.file), false, 'nothing was written');
  } finally { await s.close(); }
});

test('tasks persist atomically and survive a restart', async () => {
  const file = tmpFile();
  let s = await startRouter({ file });
  const before = Date.now();
  const r = await s.call('/tasks', { method: 'POST', body: { ...good, output_url: 'https://github.com/natura-hq/site/pull/12' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const t = r.json.task;
  assert.equal(t.number, 1); assert.equal(t.execution, 'queued'); assert.equal(t.review, 'not_requested'); assert.equal(t.source, 'manual');
  assert.ok(Date.parse(t.created_at) >= before - 5 && Date.parse(t.created_at) <= Date.now() + 5, 'timestamp is the time of the action');
  assert.equal(t.events[0].source, 'manual');
  await s.close();
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter(f => f.startsWith(path.basename(file)) && f.endsWith('.tmp')), [], 'no temp files left');
  s = await startRouter({ file }); // a fresh store reads the file
  try {
    const st = await s.call('/state');
    assert.equal(st.json.tasks.length, 1); assert.equal(st.json.tasks[0].id, t.id);
    const r2 = await s.call('/tasks', { method: 'POST', body: good });
    assert.equal(r2.json.task.number, 2);
  } finally { await s.close(); }
});

test('execution and review are recorded independently', async () => {
  const s = await startRouter();
  try {
    const id = (await s.call('/tasks', { method: 'POST', body: good })).json.task.id;
    const post = (p, body) => s.call(`/tasks/${id}/${p}`, { method: 'POST', body });
    let t = (await post('execution', { status: 'in_progress' })).json.task;
    assert.equal(t.review, 'not_requested'); assert.ok(t.started_at); assert.equal(t.finished_at, null);
    t = (await post('review', { status: 'pending' })).json.task;
    assert.equal(t.execution, 'in_progress', 'requesting review does not complete the work');
    assert.equal((await post('review', { status: 'changes_requested' })).status, 400, 'a change request needs a note');
    assert.equal((await post('review', { status: 'not_requested' })).status, 400);
    t = (await post('review', { status: 'changes_requested', note: 'Tablet menu overlaps the logo.', issue: 'Mobile layout' })).json.task;
    assert.equal(t.execution, 'in_progress'); assert.equal(t.reviews.length, 1); assert.equal(t.reviews[0].issue, 'Mobile layout');
    t = (await post('execution', { status: 'completed' })).json.task;
    assert.equal(t.review, 'changes_requested', 'completing does not change the review');
    assert.ok(Date.parse(t.finished_at) >= Date.parse(t.started_at));
    assert.equal((await post('execution', { status: 'completed' })).status, 400, 'no-op update refused');
    t = (await post('review', { status: 'passed' })).json.task;
    assert.equal(t.execution, 'completed'); assert.equal(t.review, 'passed'); assert.equal(t.reviews.length, 2);
    const p = M.performance([t]);
    assert.equal(p.reviewed, 1); assert.equal(p.firstPass, 0, 'first review was a change request'); assert.equal(p.rework, 1);
    t = (await post('execution', { status: 'in_progress' })).json.task;
    assert.equal(t.finished_at, null, 'reopening clears the finish'); assert.equal(M.durationMs(t), null);
    assert.equal((await post('output', { url: 'javascript:alert(1)' })).status, 400);
    t = (await post('output', { url: 'https://example.com/preview' })).json.task;
    assert.equal(t.output_url, 'https://example.com/preview');
    assert.equal((await post('note', { text: '' })).status, 400);
    t = (await post('note', { text: 'Checked tablet breakpoint' })).json.task;
    assert.ok(t.events.every(e => e.source === 'manual' && Date.parse(e.at)));
  } finally { await s.close(); }
});

test('lessons: statuses, evidence-gated validation and tracked instruction changes', async () => {
  const s = await startRouter();
  try {
    const taskIds = [];
    for (let i = 0; i < 5; i++) taskIds.push((await s.call('/tasks', { method: 'POST', body: { ...good, title: 'Trial ' + i } })).json.task.id);
    let r = await s.call('/lessons', { method: 'POST', body: { title: 'Check tablet navigation', bot: 'claude', lesson: 'Desktop success does not confirm tablet layout.', instruction: 'Check all three previews before review.', source_task: taskIds[0] } });
    assert.equal(r.status, 200); const id = r.json.lesson.id; assert.equal(r.json.lesson.status, 'proposed');
    assert.equal((await s.call('/lessons', { method: 'POST', body: { title: 'X', bot: 'claude', lesson: 'Lesson text', instruction: 'Instruction', source_task: 'task_doesnotexist1' } })).status, 404);
    const st = (status) => s.call(`/lessons/${id}/status`, { method: 'POST', body: { status } });
    const trial = body => s.call(`/lessons/${id}/tests`, { method: 'POST', body });
    assert.equal((await trial({ result: 'pass', evidence: 'Followed it on a trial.' })).status, 400, 'no trials while proposed');
    assert.equal((await st('validated')).status, 400, 'cannot skip testing');
    assert.equal((await st('testing')).status, 200);
    assert.equal((await trial({ result: 'maybe', evidence: 'Followed it on a trial.' })).status, 400);
    assert.equal((await trial({ result: 'pass', evidence: 'short' })).status, 400, 'evidence is required');
    assert.equal((await trial({ result: 'pass', evidence: 'Followed it on a trial.', evidence_url: 'javascript:x' })).status, 400);
    for (let i = 0; i < 4; i++) assert.equal((await trial({ result: 'pass', evidence: `Trial ${i}: reviewer passed first time.`, task: taskIds[i] })).status, 200);
    r = await st('validated');
    assert.equal(r.status, 400); assert.match(r.json.error, /4 recorded/);
    assert.equal((await trial({ result: 'pass', evidence: 'Same task again, should not count.', task: taskIds[0] })).json.evidence.passes, 4);
    assert.equal((await trial({ result: 'pass', evidence: 'Trial 5: reviewer passed first time.', task: taskIds[4], evidence_url: 'https://example.com/pr/5' })).json.evidence.passes, 5);
    r = await st('validated');
    assert.equal(r.status, 200); assert.equal(r.json.lesson.status, 'validated'); assert.ok(r.json.lesson.validated_at);
    r = await s.call(`/lessons/${id}/instruction`, { method: 'POST', body: { instruction: 'Check desktop, tablet and mobile previews, then attach screenshots.', note: 'Add screenshots' } });
    assert.equal(r.status, 200);
    const l = r.json.lesson;
    assert.equal(l.status, 'testing', 'a changed instruction needs new evidence'); assert.equal(l.version, 2);
    assert.equal(l.instruction_history.length, 1); assert.equal(l.instruction_history[0].from, 'Check all three previews before review.');
    assert.equal(M.lessonEvidence(l).passes, 0);
    assert.equal((await s.call(`/lessons/${id}/instruction`, { method: 'POST', body: { instruction: l.instruction } })).status, 400);
  } finally { await s.close(); }
});

test('reports: snapshots are saved only on request; improvement tasks are not duplicated', async () => {
  const s = await startRouter();
  try {
    const now = new Date(), tz = now.getTimezoneOffset();
    const from = M.localDate(new Date(now.getTime() - 3 * 864e5)), to = M.localDate(new Date(now.getTime() + 864e5));
    assert.equal((await s.call('/state')).json.reports.length, 0, 'no invented history');
    const id = (await s.call('/tasks', { method: 'POST', body: good })).json.task.id;
    await s.call(`/tasks/${id}/review`, { method: 'POST', body: { status: 'changes_requested', note: 'Tablet menu overlaps the logo.', issue: 'Mobile layout' } });
    const pv = await s.call(`/reports/preview?from=${from}&to=${to}&tz=${tz}`);
    assert.equal(pv.status, 200);
    assert.equal(pv.json.report.totals.reviewed, 1); assert.equal(pv.json.report.totals.firstPass, 0);
    assert.ok(!JSON.stringify(pv.json).includes('NaN'));
    const key = pv.json.report.next_steps[0].key;
    assert.equal(key, 'issue:mobile-layout');
    assert.equal((await s.call('/reports', { method: 'POST', body: { from: to, to: from, tz } })).status, 400);
    const snap = await s.call('/reports', { method: 'POST', body: { from, to, tz } });
    assert.equal(snap.status, 200); assert.equal(snap.json.snapshot.report.totals.reviewed, 1);
    const imp = body => s.call('/improvements', { method: 'POST', body: { from, to, tz, ...body } });
    let r = await imp({ keys: [key] });
    assert.equal(r.status, 200); assert.equal(r.json.created.length, 1); assert.equal(r.json.skipped.length, 0);
    r = await imp({ keys: [key, key] });
    assert.equal(r.json.created.length, 0, 'second click creates nothing'); assert.equal(r.json.skipped.length, 1);
    assert.equal((await imp({ keys: ['issue:made-up'] })).status, 400, 'only current suggestions');
    assert.equal((await imp({ keys: ['<script>'] })).status, 400);
    assert.equal((await imp({ keys: [] })).status, 400);
    const st = await s.call('/state');
    assert.equal(st.json.tasks.length, 2); assert.equal(st.json.reports.length, 1);
    const t = st.json.tasks.find(x => x.source === 'improvement');
    assert.equal(t.source_ref, key); assert.equal(t.bot, 'claude'); assert.equal(t.execution, 'queued');
  } finally { await s.close(); }
});

test('non-owners are refused for reads and writes', async () => {
  const file = tmpFile();
  const s = await startRouter({ file, admin: false });
  try {
    for (const [p, method, body] of [['/state', 'GET'], ['/reports/preview?from=2026-10-12&to=2026-10-18', 'GET'], ['/tasks', 'POST', good], ['/demo/reset', 'POST', {}], ['/tasks', 'DELETE']]) {
      const r = await s.call(p, { method, body });
      assert.equal(r.status, method === 'DELETE' ? 405 : 403, `${method} ${p}`); assert.equal(r.json.ok, false);
    }
    const demo = await s.call('/state', { dataset: 'demo' });
    assert.equal(demo.status, 403, 'demo data is owner only too');
    assert.equal(fs.existsSync(file), false);
  } finally { await s.close(); }
});

test('demo data is isolated from the real store', async () => {
  const file = tmpFile();
  const s = await startRouter({ file });
  try {
    await s.call('/tasks', { method: 'POST', body: good });
    const realBytes = fs.readFileSync(file, 'utf8');
    const d = await s.call('/state', { dataset: 'demo' });
    assert.equal(d.json.dataset, 'demo'); assert.ok(d.json.tasks.length > 5);
    assert.ok(d.json.bots.every(b => b.connection === 'demo'));
    const w = await s.call('/tasks', { method: 'POST', body: { ...good, title: 'Demo only' }, dataset: 'demo' });
    assert.equal(w.status, 200); assert.equal(w.json.task.source, 'demo');
    const anyDemo = d.json.tasks[0].id;
    assert.equal((await s.call(`/tasks/${anyDemo}/execution`, { method: 'POST', body: { status: 'cancelled' }, dataset: 'demo' })).status, 200);
    assert.equal(fs.readFileSync(file, 'utf8'), realBytes, 'real file untouched by demo writes');
    const real = await s.call('/state');
    assert.equal(real.json.tasks.length, 1); assert.ok(!real.json.tasks.some(t => t.title === 'Demo only'));
    assert.equal((await s.call(`/tasks/${anyDemo}/execution`, { method: 'POST', body: { status: 'completed' } })).status, 404, 'demo ids do not exist in real data');
    assert.ok((await s.call('/state', { dataset: 'demo' })).json.tasks.some(t => t.title === 'Demo only'));
    assert.equal((await s.call('/demo/reset', { method: 'POST', body: {} })).status, 400, 'real data cannot be reset');
    assert.equal((await s.call('/demo/reset', { method: 'POST', body: {}, dataset: 'demo' })).status, 200);
    assert.ok(!(await s.call('/state', { dataset: 'demo' })).json.tasks.some(t => t.title === 'Demo only'));
    assert.equal(fs.readFileSync(file, 'utf8'), realBytes);
  } finally { await s.close(); }
});

test('a corrupt store fails visibly and is never overwritten', async () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{"schema":1,"tasks":[ broken');
  const original = fs.readFileSync(file, 'utf8');
  const s = await startRouter({ file });
  try {
    const r = await s.call('/state');
    assert.equal(r.status, 503); assert.equal(r.json.ok, false);
    assert.ok(!r.json.error.includes(TMP) && !r.json.error.includes(file) && !/\n\s+at /.test(r.json.error), 'no paths or stack traces');
    const w = await s.call('/tasks', { method: 'POST', body: good });
    assert.equal(w.status, 503);
    assert.equal(fs.readFileSync(file, 'utf8'), original);
    assert.equal((await s.call('/state', { dataset: 'demo' })).status, 200, 'demo still works');
  } finally { await s.close(); }
  // a file that becomes unreadable after loading is not replaced either
  const file2 = tmpFile();
  const s2 = await startRouter({ file: file2 });
  try {
    assert.equal((await s2.call('/tasks', { method: 'POST', body: good })).status, 200);
    fs.writeFileSync(file2, 'not json');
    const w = await s2.call('/tasks', { method: 'POST', body: good });
    assert.equal(w.status, 503);
    assert.equal(fs.readFileSync(file2, 'utf8'), 'not json');
  } finally { await s2.close(); }
  // wrong shape counts as corrupt
  const file3 = tmpFile();
  fs.writeFileSync(file3, JSON.stringify({ schema: 1, tasks: {}, lessons: [], reports: [], seq: 0 }));
  const s3 = await startRouter({ file: file3 });
  try { assert.equal((await s3.call('/state')).status, 503); } finally { await s3.close(); }
});

// ---------- roster ----------
const mkBot = (id, style, order, archived = null) => ({ id, name: id, role: 'Role', focus: '', avatar: { style }, capabilities: [], connection: M.newConnection(), order, created_at: iso(T0), updated_at: iso(T0), archived_at: archived, history: [] });

test('desk slots are stable, the annex floor grows with the roster, and archiving frees a desk', () => {
  const slotsOf = l => Object.fromEntries(l.desks.map(d => [d.bot.id, d.slot]));
  let l = M.arrangeDesks(ROSTER);
  assert.equal(l.rooms, 0); assert.equal(l.annex, null); assert.equal(l.width, M.OFFICE.w); assert.equal(l.height, M.OFFICE.h);
  assert.deepEqual(slotsOf(l), { chatgpt: 0, claude: 1, researcher: 2, reviewer: 3 });
  assert.equal(l.open.slot, 4, 'the next bot gets desk 5');
  assert.ok(l.desks.every(d => d.zone === 'room' && d.x > 0 && d.x < M.OFFICE.w && d.y > 0 && d.y < M.OFFICE.h));
  assert.ok(l.desks.every(d => ['front_left', 'front_right', 'rear_left', 'rear_right'].includes(d.view)));
  const table = M.project(...M.TABLE_CELL);
  assert.ok(!l.desks.some(d => d.x === table.x && d.y === table.y), 'the centre cell is kept for the shared table');

  // adding bots never moves anyone already seated
  const extra = Array.from({ length: 7 }, (_, i) => mkBot(`extra${String.fromCharCode(97 + i)}`, 'sky', 10 + i));
  l = M.arrangeDesks([...ROSTER, ...extra]);
  const grown = slotsOf(l);
  for (const b of ROSTER) assert.equal(grown[b.id], b.desk, `${b.id} keeps its desk`);
  assert.equal(new Set(Object.values(grown)).size, 11, 'one bot per desk');
  assert.equal(new Set(l.desks.map(d => `${d.x},${d.y}`)).size, 11, 'no two desks overlap');
  // 11 seated + the open desk need 12 slots: 8 in the room, 4 in a two-column annex
  assert.equal(l.rooms, 2); assert.ok(l.annex && l.annex.corners.length === 4);
  assert.ok(l.width > M.OFFICE.w && l.height > M.OFFICE.h, 'the world grows; nothing is scaled down');
  const annex = l.desks.filter(d => d.zone === 'annex');
  assert.equal(annex.length, 3);
  assert.ok(annex.every(d => d.x < l.width && d.y < l.height && d.c >= M.SCENE.annexCol), 'annex desks sit inside the grown world');

  // archiving frees that desk only; the next new bot takes it and nobody else moves
  // (the server stores each bot's desk when it is added, as settleDesks does here)
  const seated = [...ROSTER, ...extra].map(b => ({ ...b })); M.settleDesks(seated);
  const archived = seated.map(b => (b.id === 'claude' ? { ...b, archived_at: iso(T0) } : b));
  l = M.arrangeDesks(archived);
  assert.equal(l.open.slot, 1, 'claude\'s desk is open');
  for (const b of seated) if (b.id !== 'claude') assert.equal(slotsOf(l)[b.id], grown[b.id], `${b.id} stays put`);
  l = M.arrangeDesks([...archived, mkBot('newcomer', 'rose', 30)]);
  assert.equal(slotsOf(l).newcomer, 1);

  // stored desks win; a clash or missing desk falls back to the lowest free slot
  const clash = [{ ...ROSTER[0], desk: 6 }, { ...ROSTER[1], desk: 6 }, { ...ROSTER[2], desk: undefined }];
  assert.deepEqual(slotsOf(M.arrangeDesks(clash)), { chatgpt: 6, claude: 0, researcher: 1 });
  const s = clash.map(b => ({ ...b })); M.settleDesks(s);
  assert.deepEqual(s.map(b => b.desk), [6, 0, 1], 'settleDesks writes the effective desk');

  // the annex shrinks again when its last desks are freed
  const few = [...ROSTER, ...extra].map(b => (b.id.startsWith('extra') ? { ...b, archived_at: iso(T0) } : b));
  assert.equal(M.arrangeDesks(few).rooms, 0);
});

test('bot configuration is validated and connection status is never taken from input', () => {
  const v = M.botInput({ name: ' Designer ', role: 'Designer', style: 'rose', capabilities: 'UI design, icons\nui DESIGN\n', connection: 'connected' });
  assert.deepEqual(v, { name: 'Designer', role: 'Designer', focus: '', style: 'rose', capabilities: ['UI design', 'icons'] });
  assert.ok(!('connection' in v));
  assert.throws(() => M.botInput({ name: '', role: 'R', style: 'rose' }), M.ValidationError);
  assert.throws(() => M.botInput({ name: 'N', role: 'R', style: 'neon' }), M.ValidationError);
  assert.throws(() => M.botInput({ name: 'N', role: 'R', style: 'rose', capabilities: Array.from({ length: 13 }, (_, i) => 'c' + i) }), M.ValidationError);
  assert.throws(() => M.botInput({ name: 'N', role: 'R', style: 'rose', capabilities: [{}] }), M.ValidationError);
  assert.equal(M.styleOf('nope'), M.CHARACTER_STYLES.violet, 'unknown styles fall back to a reusable look');
});

test('archived bots keep their rows in comparisons and reports', () => {
  const roster = [...ROSTER, mkBot('scout', 'teal', 5, iso(T0)), mkBot('idle', 'lime', 6, iso(T0))];
  const t = mkTask({ bot: 'scout', execution: 'completed', review: 'passed', reviews: [rev('passed', 5)] });
  const rows = M.botComparison([t], roster);
  assert.ok(rows.some(r => r.bot === 'scout' && r.archived && r.reviewed === 1), 'archived bot with tasks is kept');
  assert.ok(!rows.some(r => r.bot === 'idle'), 'archived bot without tasks in the period is left out');
  const r = M.buildReport([t], [], { from: '2026-10-12', to: '2026-10-18', ...M.rangeBounds('2026-10-12', '2026-10-18', 0) }, roster);
  assert.match(M.reportMarkdown(r), /scout \(archived\)/);
});

test('roster: add, edit, archive and restore through the API, with history preserved', async () => {
  const file = tmpFile();
  const s = await startRouter({ file });
  try {
    const add = body => s.call('/roster', { method: 'POST', body });
    for (const [body, field] of [[{ role: 'R', style: 'rose' }, 'name'], [{ name: 'N', role: 'R', style: 'neon' }, 'style'], [{ name: 'N', role: '', style: 'rose' }, 'role'], [{ name: 'claude', role: 'R', style: 'rose' }, 'name']]) {
      const r = await add(body);
      assert.equal(r.status, 400, JSON.stringify(body)); assert.equal(r.json.field, field);
    }
    let r = await add({ name: 'Designer', role: 'Designer', focus: 'Visual design', style: 'rose', capabilities: ['UI design', 'Icons'], connection: { status: 'connected', verified_at: '2026-10-01T00:00:00Z' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const bot = r.json.bot;
    assert.ok(M.BOT_ID_RE.test(bot.id)); assert.equal(bot.connection, 'disconnected', 'new bots start Disconnected');
    assert.equal(bot.connection_verified_at, null); assert.equal(bot.order, 4); assert.equal(bot.history[0].kind, 'created');
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.schema, 2); assert.equal(saved.bots.length, 5);
    assert.deepEqual(saved.bots[4].connection, { status: 'disconnected', verified_at: null });

    let st = (await s.call('/state')).json;
    assert.equal(bot.desk, 4, 'the new bot takes the lowest free desk');
    assert.equal(saved.bots[4].desk, 4, 'its desk is stored');
    assert.equal(M.arrangeDesks(st.bots).open.slot, 5);
    assert.equal(M.botComparison([], st.bots).length, 5, 'reports include the new bot');

    const task = (await s.call('/tasks', { method: 'POST', body: { ...good, bot: bot.id } })).json.task;
    assert.equal(task.bot, bot.id); assert.match(task.events[0].text, /Designer/);

    r = await s.call(`/roster/${bot.id}`, { method: 'POST', body: { name: 'Designer', role: 'UI designer', focus: 'Visual design', style: 'gold', capabilities: 'UI design', connection: 'connected' } });
    assert.equal(r.status, 200); assert.equal(r.json.bot.role, 'UI designer'); assert.equal(r.json.bot.avatar.style, 'gold');
    assert.equal(r.json.bot.connection, 'disconnected', 'editing cannot connect a bot');
    assert.match(r.json.bot.history.at(-1).text, /role/);
    assert.equal((await s.call(`/roster/${bot.id}`, { method: 'POST', body: { name: 'Designer', role: 'UI designer', focus: 'Visual design', style: 'gold', capabilities: ['UI design'] } })).status, 400, 'nothing changed');
    assert.equal((await s.call('/roster/bot_doesnotexist01', { method: 'POST', body: { name: 'X', role: 'Y', style: 'rose' } })).status, 404);

    r = await s.call(`/roster/${bot.id}/archive`, { method: 'POST', body: { note: 'Design paused' } });
    assert.equal(r.status, 200); assert.equal(r.json.open, 1); assert.ok(r.json.bot.archived_at);
    assert.equal((await s.call(`/roster/${bot.id}/archive`, { method: 'POST', body: {} })).status, 400);
    st = (await s.call('/state')).json;
    assert.ok(st.tasks.some(t => t.id === task.id), 'the archived bot\'s task is kept');
    assert.equal(st.bots.length, 5, 'archived, not deleted');
    const after = M.arrangeDesks(st.bots);
    assert.ok(!after.desks.some(d => d.bot.id === bot.id), 'it leaves the office');
    assert.equal(after.open.slot, 4, 'its desk is released');
    assert.deepEqual(after.desks.map(d => d.slot).sort(), [0, 1, 2, 3], 'nobody else moved');
    assert.equal(M.teamCounts(st.tasks, st.bots).active, 4);
    const refused = await s.call('/tasks', { method: 'POST', body: { ...good, bot: bot.id } });
    assert.equal(refused.status, 400); assert.equal(refused.json.field, 'bot');
    assert.equal((await s.call('/lessons', { method: 'POST', body: { title: 'L', bot: bot.id, lesson: 'Lesson text', instruction: 'Instruction' } })).status, 400);
    assert.equal((await s.call(`/tasks/${task.id}/execution`, { method: 'POST', body: { status: 'in_progress' } })).status, 200, 'its history can still be completed');

    // a name taken while archived blocks restore until resolved
    const twin = (await add({ name: 'designer', role: 'Stand-in', style: 'sky' })).json.bot;
    assert.equal((await s.call(`/roster/${bot.id}/restore`, { method: 'POST', body: {} })).status, 400);
    await s.call(`/roster/${twin.id}/archive`, { method: 'POST', body: {} });
    r = await s.call(`/roster/${bot.id}/restore`, { method: 'POST', body: {} });
    assert.equal(r.status, 200); assert.equal(r.json.bot.archived_at, null); assert.equal(r.json.bot.connection, 'disconnected');
    assert.equal(r.json.bot.desk, 4, 'restored to its old desk when it is free');
    assert.equal((await s.call(`/roster/${bot.id}/restore`, { method: 'POST', body: {} })).status, 400);
    assert.deepEqual(r.json.bot.history.map(x => x.kind), ['created', 'edited', 'archived', 'restored']);
    for (const method of ['PUT', 'PATCH', 'DELETE']) assert.equal((await s.call(`/roster/${bot.id}`, { method, body: {} })).status, 405, 'no delete route');
  } finally { await s.close(); }
});

test('improvement tasks are not created for archived bots', async () => {
  const s = await startRouter();
  try {
    const now = new Date(), tz = now.getTimezoneOffset();
    const from = M.localDate(new Date(now.getTime() - 864e5)), to = M.localDate(new Date(now.getTime() + 864e5));
    const b = (await s.call('/roster', { method: 'POST', body: { name: 'Writer', role: 'Writer', style: 'lime' } })).json.bot;
    const id = (await s.call('/tasks', { method: 'POST', body: { ...good, bot: b.id } })).json.task.id;
    await s.call(`/tasks/${id}/review`, { method: 'POST', body: { status: 'changes_requested', note: 'Tone too formal', issue: 'Tone' } });
    await s.call(`/roster/${b.id}/archive`, { method: 'POST', body: {} });
    const r = await s.call('/improvements', { method: 'POST', body: { from, to, tz, keys: ['issue:tone'] } });
    assert.equal(r.status, 200); assert.equal(r.json.created.length, 0); assert.equal(r.json.skipped[0].reason, 'archived');
  } finally { await s.close(); }
});

test('roster changes are owner only and demo roster changes never reach the real file', async () => {
  const s0 = await startRouter({ admin: false });
  try { assert.equal((await s0.call('/roster', { method: 'POST', body: { name: 'N', role: 'R', style: 'rose' } })).status, 403); } finally { await s0.close(); }
  const file = tmpFile();
  const s = await startRouter({ file });
  try {
    await s.call('/tasks', { method: 'POST', body: good });
    const before = fs.readFileSync(file, 'utf8');
    const r = await s.call('/roster', { method: 'POST', body: { name: 'Demo helper', role: 'Helper', style: 'sky' }, dataset: 'demo' });
    assert.equal(r.status, 200);
    assert.equal((await s.call('/roster/claude/archive', { method: 'POST', body: {}, dataset: 'demo' })).status, 200);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    const real = (await s.call('/state')).json;
    assert.equal(real.bots.length, 4); assert.ok(real.bots.every(b => !b.archived_at));
  } finally { await s.close(); }
});

test('a file from before the stored roster is upgraded without losing tasks', async () => {
  const file = tmpFile();
  const old = { schema: 1, created_at: iso(T0), seq: 1, tasks: [mkTask({ id: 'task_oldformat01', bot: 'researcher' })], lessons: [], reports: [] };
  fs.writeFileSync(file, JSON.stringify(old));
  const s = await startRouter({ file });
  try {
    const st = (await s.call('/state')).json;
    assert.equal(st.bots.length, 4); assert.equal(st.tasks[0].bot, 'researcher');
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).schema, 1, 'reading does not rewrite');
    await s.call('/roster', { method: 'POST', body: { name: 'Analyst', role: 'Analyst', style: 'gold' } });
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.schema, 2); assert.equal(saved.bots.length, 5); assert.equal(saved.tasks[0].id, 'task_oldformat01');
  } finally { await s.close(); }
});

// ---------- prompts, optional roles, availability and skills ----------
test('role library offers ten editable templates without replacing the existing roster', () => {
  assert.equal(M.BOT_TEMPLATES.length, 10);
  for (const role of ['Designer', 'Writer', 'Analyst', 'Knowledge Keeper', 'Automation', 'Project Coordinator']) assert.ok(M.BOT_TEMPLATES.some(t => t.role === role));
  for (const t of M.BOT_TEMPLATES) { const v = M.botInput(t); assert.ok(v.prompt); assert.ok(M.STYLE_IDS.includes(v.style)); }
  assert.equal(M.seedBots(iso(T0)).length, 4);
  const legacy = { ...ROSTER[0] }; delete legacy.enabled;
  assert.equal(M.isEnabled(legacy), true);
  assert.equal(M.isEnabled({ ...legacy, enabled: false }), false);
  assert.equal(M.isEnabled({ ...legacy, archived_at: iso(T0) }), false);
});
test('turning a bot off preserves tasks, stops new assignments and persists after reload', async () => {
  const file = tmpFile(), s = await startRouter({ file });
  try {
    const task = (await s.call('/tasks', { method: 'POST', body: good })).json.task;
    for (const enabled of ['false', 0, null]) assert.equal((await s.call('/roster/claude/enabled', { method: 'POST', body: { enabled } })).status, 400);
    let r = await s.call('/roster/claude/enabled', { method: 'POST', body: { enabled: false } });
    assert.equal(r.status, 200); assert.equal(r.json.bot.enabled, false); assert.equal(r.json.bot.connection, 'disconnected');
    let st = (await s.call('/state')).json;
    assert.equal(st.tasks[0].id, task.id); assert.equal(st.tasks[0].execution, 'queued');
    assert.ok(!M.availableBots(st.bots).some(b => b.id === 'claude'));
    assert.equal(M.botStatus(st.tasks, 'claude', st.bots.find(b => b.id === 'claude')).status, 'off');
    assert.equal(M.teamCounts(st.tasks, st.bots).off, 1);
    assert.equal((await s.call('/tasks', { method: 'POST', body: good })).status, 400);
    assert.equal((await s.call(`/tasks/${task.id}/execution`, { method: 'POST', body: { status: 'in_progress' } })).status, 200, 'existing records remain editable');
    s.store.reload(); st = (await s.call('/state')).json; assert.equal(st.bots.find(b => b.id === 'claude').enabled, false);
    r = await s.call('/roster/claude/enabled', { method: 'POST', body: { enabled: true } });
    assert.equal(r.status, 200); assert.equal((await s.call('/tasks', { method: 'POST', body: good })).status, 200);
    await s.call('/roster/claude/archive', { method: 'POST', body: {} });
    assert.equal((await s.call('/roster/claude/enabled', { method: 'POST', body: { enabled: false } })).status, 400);
  } finally { await s.close(); }
});
test('prompts and skills persist, version independently, validate links and preserve connection state', async () => {
  const file = tmpFile(), s = await startRouter({ file });
  const v = { name: 'Weekly update', trigger: 'When asked for a weekly update', instructions: '# Instructions\nRead approved tasks and cite sources. Return a draft.', reference_url: 'https://example.com/sop' };
  try {
    const bot = (await s.call('/roster', { method: 'POST', body: M.BOT_TEMPLATES.find(t => t.id === 'designer') })).json.bot;
    assert.ok(bot.prompt && bot.design_guidelines); assert.deepEqual(bot.skills, []);
    for (const bad of [{ ...v, name: '' }, { ...v, instructions: 'x'.repeat(M.LIMITS.skillInstructions + 1) }, { ...v, reference_url: 'javascript:alert(1)' }]) assert.equal((await s.call(`/roster/${bot.id}/skills`, { method: 'POST', body: bad })).status, 400);
    let r = await s.call(`/roster/${bot.id}/skills`, { method: 'POST', body: v });
    assert.equal(r.status, 200); const skill = r.json.skill;
    assert.equal(skill.version, 1); assert.equal(skill.enabled, true);
    assert.equal((await s.call(`/roster/${bot.id}/skills`, { method: 'POST', body: v })).status, 400, 'no duplicate skill names');
    r = await s.call(`/roster/${bot.id}/skills/${skill.id}`, { method: 'POST', body: { ...v, instructions: 'Updated checks and human approval.' } });
    assert.equal(r.status, 200); assert.equal(r.json.skill.version, 2);
    r = await s.call(`/roster/${bot.id}/skills/${skill.id}/enabled`, { method: 'POST', body: { enabled: false } });
    assert.equal(r.status, 200); assert.equal(r.json.skill.enabled, false); assert.equal(r.json.skill.version, 2);
    assert.equal((await s.call(`/roster/claude/skills/${skill.id}/enabled`, { method: 'POST', body: { enabled: false } })).status, 404, 'a skill belongs to its bot');
    // Older clients can edit basic fields without clearing prompt, skills or availability.
    await s.call(`/roster/${bot.id}/enabled`, { method: 'POST', body: { enabled: false } });
    r = await s.call(`/roster/${bot.id}`, { method: 'POST', body: { name: 'Visual Designer', role: bot.role, style: bot.avatar.style, focus: bot.focus, capabilities: bot.capabilities } });
    assert.equal(r.status, 200); assert.equal(r.json.bot.prompt, bot.prompt); assert.equal(r.json.bot.enabled, false); assert.equal(r.json.bot.skills[0].enabled, false);
    r = await s.call(`/roster/${bot.id}`, { method: 'POST', body: { ...M.BOT_TEMPLATES.find(t => t.id === 'designer'), name: 'Visual Designer', prompt: 'New role prompt' } });
    assert.equal(r.status, 200); assert.equal(r.json.bot.prompt, 'New role prompt');
    s.store.reload(); const st = (await s.call('/state')).json, saved = st.bots.find(b => b.id === bot.id);
    assert.equal(saved.skills[0].instructions, 'Updated checks and human approval.'); assert.equal(saved.prompt, 'New role prompt');
    assert.equal(saved.connection, 'disconnected'); assert.equal(st.runtime.dispatch, false);
  } finally { await s.close(); }
});
test('availability and skills are owner only; demo edits never reach the real file', async () => {
  const skill = { name: 'Test skill', trigger: 'When testing', instructions: 'Return a draft for review.' };
  const forbidden = await startRouter({ admin: false });
  try {
    for (const [p, body] of [['/roster/claude/enabled', { enabled: false }], ['/roster/claude/skills', skill], ['/roster/claude/skills/skill_abcdefgh/enabled', { enabled: false }], ['/roster/claude/skills/skill_abcdefgh', skill]]) assert.equal((await forbidden.call(p, { method: 'POST', body })).status, 403);
  } finally { await forbidden.close(); }
  const file = tmpFile(), s = await startRouter({ file });
  try {
    await s.call('/tasks', { method: 'POST', body: good }); const before = fs.readFileSync(file, 'utf8');
    assert.equal((await s.call('/roster/claude/enabled', { method: 'POST', body: { enabled: false }, dataset: 'demo' })).status, 200);
    assert.equal((await s.call('/roster/claude/skills', { method: 'POST', body: skill, dataset: 'demo' })).status, 200);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    const real = (await s.call('/state')).json.bots.find(b => b.id === 'claude'); assert.equal(real.enabled, true); assert.deepEqual(real.skills, []);
  } finally { await s.close(); }
});
test('skill source review: ready needs an exact revision, license, text-only use and a test', () => {
  const base = { url: SOURCE_REC.url, revision: '9f3c2b1a0d', license: 'MIT', files: 'SKILL.md\n SKILL.md \n\n', adaptation: 'instructions', test: 'Check candidates on a real task.', compatibility: 'ready' };
  const v = M.skillSourceInput(base);
  assert.deepEqual(v.files, ['SKILL.md'], 'lines are trimmed and de-duplicated'); assert.deepEqual(v.required_tools, []);
  assert.equal(M.skillSourceInput({ ...base, revision: 'v1.2.0' }).revision, 'v1.2.0', 'a release tag is exact');
  for (const [over, field] of [[{ revision: 'main' }, 'revision'], [{ revision: '' }, 'revision'], [{ license: '' }, 'license'], [{ adaptation: 'package' }, 'adaptation'],
    [{ required_tools: ['Web browsing'] }, 'required_tools'], [{ test: '' }, 'test'], [{ url: 'javascript:alert(1)' }, 'url'], [{ compatibility: 'approved' }, 'compatibility']]) {
    assert.throws(() => M.skillSourceInput({ ...base, ...over }), e => e instanceof M.ValidationError && e.field === field, JSON.stringify(over));
  }
  // anything short of ready is a valid record that keeps the skill off
  const pending = M.skillSourceInput({ url: base.url, required_tools: 'Web browsing', compatibility: 'needs_tools' });
  assert.equal(pending.adaptation, 'instructions'); assert.deepEqual(pending.required_tools, ['Web browsing']);
  assert.match(M.skillBlocker({ source: pending }), /Needs tools/);
  assert.equal(M.skillBlocker({ source: v }), null); assert.equal(M.skillBlocker({ name: 'Own instructions' }), null);
});
test('a catalog skill stays off until its source review is ready, and copies keep their provenance', async () => {
  const file = tmpFile(), s = await startRouter({ file });
  const v = { name: 'Find skills', trigger: 'When a capability is missing', instructions: 'Search the catalog and report candidates.', reference_url: 'https://github.com/vercel-labs/skills' };
  const src = { url: SOURCE_REC.url.replace('9f3c2b1a0d', 'main'), license: 'MIT', files: ['SKILL.md'], required_tools: ['Web browsing'], compatibility: 'needs_tools' };
  const ready = { ...src, url: SOURCE_REC.url, revision: '9f3c2b1a0d', required_tools: [], test: 'Name a gap; expect links, licenses and no installs.', compatibility: 'ready' };
  try {
    assert.equal((await s.call('/roster/claude/skills', { method: 'POST', body: { ...v, source: { ...src, compatibility: 'ready' } } })).status, 400, 'ready is checked when a skill is added too');
    let r = await s.call('/roster/claude/skills', { method: 'POST', body: { ...v, source: src } });
    assert.equal(r.status, 200); const skill = r.json.skill;
    assert.equal(skill.enabled, false); assert.equal(skill.source.compatibility, 'needs_tools'); assert.ok(skill.source.reviewed_at);
    r = await s.call(`/roster/claude/skills/${skill.id}/enabled`, { method: 'POST', body: { enabled: true } });
    assert.equal(r.status, 400); assert.match(r.json.error, /Needs tools/);
    r = await s.call(`/roster/claude/skills/${skill.id}/source`, { method: 'POST', body: ready });
    assert.equal(r.status, 200); assert.equal(r.json.skill.enabled, false, 'a review never turns a skill on by itself');
    assert.equal(r.json.skill.version, 1, 'a source review does not change the instruction version');
    assert.equal((await s.call(`/roster/claude/skills/${skill.id}/source`, { method: 'POST', body: ready })).status, 400, 'nothing changed');
    assert.equal((await s.call(`/roster/claude/skills/${skill.id}/enabled`, { method: 'POST', body: { enabled: true } })).status, 200);
    // the copy is made on the server, so the review travels with it and the copy records where it came from
    r = await s.call(`/roster/claude/skills/${skill.id}/copy`, { method: 'POST', body: { bot: 'reviewer' } });
    assert.equal(r.status, 200); const copy = r.json.skill;
    assert.notEqual(copy.id, skill.id); assert.equal(copy.enabled, true); assert.equal(copy.source.revision, '9f3c2b1a0d');
    assert.deepEqual([copy.copied_from.bot, copy.copied_from.skill, copy.copied_from.version, copy.version], ['claude', skill.id, 1, 1]);
    assert.equal((await s.call(`/roster/claude/skills/${skill.id}/copy`, { method: 'POST', body: { bot: 'reviewer' } })).status, 400, 'no duplicate names on the destination');
    assert.equal((await s.call(`/roster/claude/skills/${skill.id}/copy`, { method: 'POST', body: { bot: 'claude' } })).status, 400, 'not onto the same bot');
    // a downgraded review turns the skill off and says so in the bot's history
    r = await s.call(`/roster/claude/skills/${skill.id}/source`, { method: 'POST', body: { ...ready, compatibility: 'incompatible' } });
    assert.equal(r.status, 200); assert.equal(r.json.skill.enabled, false);
    assert.ok(r.json.bot.history.some(x => x.kind === 'skill_source' && /Turned off/.test(x.text)));
    // removing the review makes it the owner's own instructions; it stays off until turned on
    r = await s.call(`/roster/claude/skills/${skill.id}/source`, { method: 'POST', body: { remove: true } });
    assert.equal(r.status, 200); assert.equal(r.json.skill.source, undefined); assert.equal(r.json.skill.enabled, false);
    assert.equal((await s.call(`/roster/claude/skills/${skill.id}/enabled`, { method: 'POST', body: { enabled: true } })).status, 200);
    s.store.reload();
    const saved = (await s.call('/state')).json.bots.find(b => b.id === 'reviewer').skills[0];
    assert.equal(saved.source.compatibility, 'ready'); assert.equal(saved.copied_from.skill, skill.id);
  } finally { await s.close(); }
  const forbidden = await startRouter({ admin: false });
  try {
    for (const p of ['/roster/claude/skills/skill_abcdefgh/source', '/roster/claude/skills/skill_abcdefgh/copy']) assert.equal((await forbidden.call(p, { method: 'POST', body: { bot: 'reviewer', ...ready } })).status, 403);
  } finally { await forbidden.close(); }
});

// ---------- layout editor ----------
test('layout coordinates override only the chosen bot and retain stable desk identity', () => {
  const layout = M.layoutInput({ x: 750, y: 850, view: 'rear_left', parts: { robot: { x: -12, y: 18, scale: 1.1 } }, label: { x: 0, y: -20 } });
  const before = M.arrangeDesks(ROSTER), edited = ROSTER.map(b => b.id === 'claude' ? { ...b, layout } : b), after = M.arrangeDesks(edited);
  const d = after.desks.find(d => d.bot.id === 'claude');
  assert.deepEqual([d.x, d.y, d.view, d.slot], [750, 850, 'rear_left', 1]);
  assert.deepEqual(d.bot.layout.parts.robot, { x: -12, y: 18, scale: 1.1 });
  for (const b of ROSTER.filter(b => b.id !== 'claude')) {
    const a = before.desks.find(d => d.bot.id === b.id), c = after.desks.find(d => d.bot.id === b.id);
    assert.deepEqual([a.x, a.y, a.slot], [c.x, c.y, c.slot]);
  }
  for (const bad of [{ ...layout, x: NaN }, { ...layout, y: -1 }, { ...layout, view: 'sideways' }, { ...layout, parts: { robot: { scale: 10 } } }, { ...layout, parts: { wall: {} } }, { ...layout, label: [] }]) assert.throws(() => M.layoutInput(bad), M.ValidationError);
});
test('layout saves atomically, survives reload and resets without changing task history or desk slots', async () => {
  const file = tmpFile(), s = await startRouter({ file });
  const layout = { x: 750, y: 850, view: 'front_right', parts: { chair: { x: 8, y: -16, scale: 1.15 } }, label: { x: 12, y: 20 } };
  try {
    await s.call('/tasks', { method: 'POST', body: good });
    const original = (await s.call('/state')).json;
    let r = await s.call('/layout', { method: 'POST', body: { changes: [{ bot: 'claude', layout }, { bot: 'reviewer', layout: { ...layout, x: 1300 } }] } });
    assert.equal(r.status, 200); assert.equal(r.json.saved, 2);
    s.store.reload(); let st = (await s.call('/state')).json;
    assert.deepEqual(st.tasks, original.tasks); assert.equal(st.bots.find(b => b.id === 'claude').desk, 1);
    assert.equal(st.bots.find(b => b.id === 'claude').layout.parts.chair.y, -16);
    const bytes = fs.readFileSync(file, 'utf8');
    for (const changes of [[], [{ bot: 'claude', layout: { ...layout, x: 900 } }, { bot: 'reviewer', layout: { ...layout, y: -10 } }], [{ bot: 'claude', layout }, { bot: 'claude', layout: null }], [{ bot: 'claude', layout: { ...layout, x: 900 } }, { bot: 'missingbot', layout }]]) {
      assert.equal((await s.call('/layout', { method: 'POST', body: { changes } })).status, 400);
      assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'failed batch never saves a partial layout');
    }
    r = await s.call('/layout', { method: 'POST', body: { changes: [{ bot: 'claude', layout: null }] } });
    assert.equal(r.status, 200); s.store.reload(); st = (await s.call('/state')).json;
    assert.equal(st.bots.find(b => b.id === 'claude').layout, undefined);
    assert.equal(st.bots.find(b => b.id === 'reviewer').layout.x, 1300, 'reset only affects selected bot');
    assert.equal(st.bots.find(b => b.id === 'claude').connection, 'disconnected'); assert.deepEqual(st.tasks, original.tasks);
  } finally { await s.close(); }
});
test('layout editing is owner-only, rejects archived bots and isolates demo changes', async () => {
  const layout = { x: 800, y: 800, view: 'front_left' }, body = { changes: [{ bot: 'claude', layout }] };
  const denied = await startRouter({ admin: false });
  try { assert.equal((await denied.call('/layout', { method: 'POST', body })).status, 403); } finally { await denied.close(); }
  const file = tmpFile(), s = await startRouter({ file });
  try {
    await s.call('/tasks', { method: 'POST', body: good }); const bytes = fs.readFileSync(file, 'utf8');
    assert.equal((await s.call('/layout', { method: 'POST', body, dataset: 'demo' })).status, 200);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes);
    assert.equal((await s.call('/state')).json.bots.find(b => b.id === 'claude').layout, undefined);
    await s.call('/roster/claude/archive', { method: 'POST', body: {} });
    assert.equal((await s.call('/layout', { method: 'POST', body })).status, 400);
  } finally { await s.close(); }
});

test('desk rotation cycles all perspectives and seating derives from the transformed desk', () => {
  let view = 'front_left';
  const seen = [];
  for (let i = 0; i < 4; i++) { seen.push(view); view = M.rotateDeskView(view, 1); }
  assert.equal(view, 'front_left'); assert.equal(new Set(seen).size, 4);
  assert.equal(M.rotateDeskView('front_left', -1), 'rear_left');
  assert.throws(() => M.rotateDeskView('invalid', 1), M.ValidationError);
  const layout = M.layoutInput({ x: 1000, y: 800, view: 'front_left', auto_seat: true, parts: { desk: { x: 20, y: 10, scale: 1.2 }, robot: { x: 100, y: 100 } } });
  const d = { x: layout.x, y: layout.y, view: layout.view, bot: { layout } }, seat = M.deskSeat(d);
  assert.ok(Math.abs(seat.x - 909.6) < 0.001); assert.ok(Math.abs(seat.y - 750.4) < 0.001);
  const moved = M.deskSeat({ ...d, x: d.x + 80, y: d.y - 24 });
  assert.deepEqual([moved.x - seat.x, moved.y - seat.y], [80, -24]);
  const rotated = M.deskSeat({ ...d, view: 'front_right' }); assert.ok(rotated.x > d.x); assert.ok(seat.x < d.x);
  assert.equal(layout.auto_seat, true);
  assert.throws(() => M.layoutInput({ ...layout, auto_seat: 'yes' }), M.ValidationError);
});
test('automatic desk seating persists with its assigned bot and does not change other bots', async () => {
  const file = tmpFile(), s = await startRouter({ file });
  const layout = { x: 820, y: 740, view: 'rear_right', auto_seat: true, parts: { desk: { scale: 1.1 } } };
  try {
    const before = (await s.call('/state')).json;
    const r = await s.call('/layout', { method: 'POST', body: { changes: [{ bot: 'claude', layout }] } }); assert.equal(r.status, 200);
    s.store.reload(); const st = (await s.call('/state')).json;
    const b = st.bots.find(b => b.id === 'claude'); assert.equal(b.layout.auto_seat, true); assert.equal(b.desk, 1);
    assert.equal(b.layout.view, 'rear_right'); assert.equal(b.layout.parts.desk.scale, 1.1);
    assert.deepEqual(st.bots.find(b => b.id === 'reviewer'), before.bots.find(b => b.id === 'reviewer'));
    const d = M.arrangeDesks(st.bots).desks.find(d => d.bot.id === b.id), seat = M.deskSeat(d);
    assert.ok(seat.x > d.x && seat.y > d.y);
    const bad = await s.call('/layout', { method: 'POST', body: { changes: [{ bot: 'claude', layout: { ...layout, auto_seat: 'true' } }] } }); assert.equal(bad.status, 400);
  } finally { await s.close(); }
});

test('valid JSON with malformed nested records is refused and the file is kept byte for byte', async () => {
  const goodTask = mkTask({ id: 'task_goodshape01' });
  const base = { schema: 2, created_at: iso(T0), seq: 1, bots: ROSTER, tasks: [goodTask], lessons: [], reports: [] };
  const lesson = { id: 'lesson_goodshape1', title: 'L', bot: 'claude', source_task: '', lesson: 'Lesson', instruction: 'Do it', status: 'testing', version: 1, created_at: iso(T0), updated_at: iso(T0), validated_at: null, tests: [], instruction_history: [], history: [] };
  const cases = {
    'null task (schema 1)': { schema: 1, seq: 0, tasks: [null], lessons: [], reports: [] },
    'task with unknown execution': { ...base, tasks: [{ ...goodTask, execution: 'teleported' }] },
    'task with a bad id': { ...base, tasks: [{ ...goodTask, id: '../../etc' }] },
    'task events not a list': { ...base, tasks: [{ ...goodTask, events: 'x' }] },
    'review with a bad outcome': { ...base, tasks: [{ ...goodTask, reviews: [{ id: 'rev_x', at: iso(T0), outcome: 'maybe', note: '' }] }] },
    'duplicate task ids': { ...base, seq: 2, tasks: [goodTask, { ...goodTask, number: 2 }] },
    'lesson trial with a bad result': { ...base, lessons: [{ ...lesson, tests: [{ id: 'test_x', at: iso(T0), result: 'great', evidence: 'e', task: '' }] }] },
    'lesson with an unknown status': { ...base, lessons: [{ ...lesson, status: 'shipped' }] },
    'report without contents': { ...base, reports: [{ id: 'rep_aaaaaaaa', from: '2026-10-12', to: '2026-10-18', generated_at: iso(T0) }] },
    'bot without an avatar': { ...base, bots: [{ ...ROSTER[0], avatar: null }, ...ROSTER.slice(1)] },
    'bot with a non-numeric desk': { ...base, bots: [{ ...ROSTER[0], desk: 'one' }, ...ROSTER.slice(1)] },
    'skill review with an unknown result': { ...base, bots: [{ ...ROSTER[0], skills: [{ ...SKILL_REC, source: { ...SOURCE_REC, compatibility: 'approved' } }] }, ...ROSTER.slice(1)] },
    'skill review with an unsafe link': { ...base, bots: [{ ...ROSTER[0], skills: [{ ...SKILL_REC, source: { ...SOURCE_REC, url: 'javascript:alert(1)' } }] }, ...ROSTER.slice(1)] },
    'skill review without its lists': { ...base, bots: [{ ...ROSTER[0], skills: [{ ...SKILL_REC, source: { ...SOURCE_REC, files: 'SKILL.md' } }] }, ...ROSTER.slice(1)] }
  };
  for (const [name, data] of Object.entries(cases)) {
    const file = tmpFile();
    const bytes = JSON.stringify(data);
    fs.writeFileSync(file, bytes);
    const s = await startRouter({ file });
    try {
      const r = await s.call('/state');
      assert.equal(r.status, 503, name); assert.equal(r.json.ok, false, name);
      assert.equal((await s.call('/tasks', { method: 'POST', body: good })).status, 503, `${name}: writes refused`);
      assert.equal(fs.readFileSync(file, 'utf8'), bytes, `${name}: file untouched`);
    } finally { await s.close(); }
  }
  // the well-formed version of the same data loads
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify({ ...base, lessons: [lesson], bots: [{ ...ROSTER[0], skills: [{ ...SKILL_REC, source: SOURCE_REC }] }, ...ROSTER.slice(1)] }));
  const s = await startRouter({ file });
  try { assert.equal((await s.call('/state')).status, 200); } finally { await s.close(); }
});

test('the rug follows its desk and lies along it in every view', () => {
  const desk = (view, layout) => ({ x: 1000, y: 700, view, bot: { id: 'claude', layout } });
  // plain station: centred on the desk's station point
  assert.deepEqual(M.rugPlacement(desk('front_right')), { x: 1000, y: 700, scale: 1, flip: false });
  // the desk art for front_left / rear_left runs the other diagonal, so the rug is mirrored to match
  for (const v of M.LAYOUT_VIEWS) assert.equal(M.rugPlacement(desk(v)).flip, v === 'front_left' || v === 'rear_left', v);
  // with automatic seating, moving or resizing the desk moves and resizes the rug with it
  const moved = desk('rear_right', { auto_seat: true, parts: { desk: { x: 40, y: -24, scale: 1.25 }, rug: { x: 6, y: 4, scale: 1 } } });
  assert.deepEqual(M.rugPlacement(moved), { x: 1046, y: 680, scale: 1.25, flip: false });
  // legacy manual layouts keep their rug where it was saved (desk offsets did not move it before)
  const legacy = desk('rear_right', { parts: { desk: { x: 40, y: -24, scale: 1.25 }, rug: { x: 6, y: 4, scale: 0.9 } } });
  assert.deepEqual(M.rugPlacement(legacy), { x: 1006, y: 704, scale: 0.9, flip: false });
  // moving the station point (dragging the desk in the editor) carries the rug along
  const a = M.rugPlacement({ ...moved, x: 1200, y: 760 });
  assert.equal(a.x - M.rugPlacement(moved).x, 200); assert.equal(a.y - M.rugPlacement(moved).y, 60);
});

// ---------- walk-to-seat navigation (visual only) ----------
const samplePath = (pts, step = 10) => { const out = [], len = NAVM.pathLength(pts); for (let d = 0; d <= len; d += step) out.push(NAVM.pointAlong(pts, d)); return out; };
const insideEllipse = (o, p, k = 0.9) => ((p.x - o.x) / (o.rx * k)) ** 2 + ((p.y - o.y) / (o.ry * k)) ** 2 < 1;

test('bots walk from the door to their own seat around desks, the table and occupied seats', () => {
  assert.ok(NAVM.inPolygon(NAVM.ROOM_ENTRY, NAVM.ROOM_FLOOR), 'the entrance is on the open floor');
  const extra = Array.from({ length: 4 }, (_, i) => mkBot(`walker${String.fromCharCode(97 + i)}`, 'sky', 10 + i));
  const roster = [...ROSTER, ...extra].map(b => ({ ...b })); M.settleDesks(roster); // eight desks: the whole room
  const layout = M.arrangeDesks(roster);
  let reached = 0;
  for (const d of layout.desks) {
    const from = NAVM.entryFor(d, layout), goal = NAVM.robotSpot(d);
    assert.deepEqual(from, NAVM.ROOM_ENTRY, 'room desks are entered from the door');
    const path = NAVM.findPath(layout, d.bot.id, from, goal);
    if (!path) continue; // a seat boxed in by neighbours is seated directly by the browser
    reached++;
    assert.deepEqual(path[0], from); assert.deepEqual(path[path.length - 1], goal);
    const obs = NAVM.obstacles(layout, d.bot.id);
    for (const p of samplePath(path)) {
      if (Math.hypot(p.x - goal.x, p.y - goal.y) < NAVM.NAV.seatReach + 20) continue; // sitting down into the chair
      const cell = NAVM.NAV.cell, c = { x: (Math.floor(p.x / cell) + 0.5) * cell, y: (Math.floor(p.y / cell) + 0.5) * cell };
      assert.ok(NAVM.inPolygon(c, NAVM.ROOM_FLOOR) || NAVM.inPolygon(p, NAVM.ROOM_FLOOR), `${d.bot.id}: stays on the floor at ${Math.round(p.x)},${Math.round(p.y)}`);
      for (const o of obs) {
        if (o.r !== undefined) assert.ok(Math.hypot(p.x - o.x, p.y - o.y) >= o.r * 0.9, `${d.bot.id}: avoids ${o.kind} ${o.bot || ''}`);
        else assert.ok(!insideEllipse(o, p), `${d.bot.id}: avoids ${o.kind} ${o.bot || ''}`);
      }
    }
  }
  assert.ok(reached >= 4, `at least half the desks of a full room are reachable (${reached} of 8)`);
  // the four starting desks are always reachable
  const four = M.arrangeDesks(ROSTER);
  for (const d of four.desks) assert.ok(NAVM.findPath(four, d.bot.id, NAVM.entryFor(d, four), NAVM.robotSpot(d)), `${d.bot.id} reaches its seat`);
});

test('navigation reroutes from mid-walk, uses the annex entrance, and refuses unreachable seats', () => {
  const layout = M.arrangeDesks(ROSTER), d = layout.desks.find(x => x.bot.id === 'chatgpt');
  const path = NAVM.findPath(layout, 'chatgpt', NAVM.ROOM_ENTRY, NAVM.robotSpot(d));
  const mid = NAVM.pointAlong(path, NAVM.pathLength(path) / 2);
  // the desk moved while the bot was walking: a new path starts where the bot is
  const moved = ROSTER.map(b => (b.id === 'chatgpt' ? { ...b, desk: 6 } : b));
  const l2 = M.arrangeDesks(moved), d2 = l2.desks.find(x => x.bot.id === 'chatgpt');
  const re = NAVM.findPath(l2, 'chatgpt', { x: mid.x, y: mid.y }, NAVM.robotSpot(d2));
  assert.ok(re); assert.equal(re[0].x, mid.x); assert.equal(re[0].y, mid.y);
  assert.deepEqual(re[re.length - 1], NAVM.robotSpot(d2));
  // a seat beyond the walls cannot be reached, so the bot is seated directly
  assert.equal(NAVM.findPath(layout, 'chatgpt', NAVM.ROOM_ENTRY, { x: 60, y: 60 }), null);
  // annex desks are entered from the annex's back edge and never cross the room
  const many = Array.from({ length: 6 }, (_, i) => mkBot(`annexbot${String.fromCharCode(97 + i)}`, 'gold', 20 + i));
  const big = [...ROSTER, ...many].map(b => ({ ...b })); M.settleDesks(big);
  const L = M.arrangeDesks(big), annexDesk = L.desks.find(x => x.zone === 'annex');
  assert.ok(annexDesk, 'there is an annex desk');
  const entry = NAVM.entryFor(annexDesk, L);
  assert.ok(!NAVM.inPolygon(entry, NAVM.ROOM_FLOOR) && NAVM.inPolygon(entry, NAVM.zones(L)[1]), 'annex entrance is on the annex floor');
  const ap = NAVM.findPath(L, annexDesk.bot.id, entry, NAVM.robotSpot(annexDesk));
  assert.ok(ap, 'annex seat reachable');
  assert.ok(samplePath(ap).every(p => !NAVM.inPolygon(p, NAVM.ROOM_FLOOR)), 'annex walk stays outside the room');
});

test('walk headings map to the documented atlas columns and mirrors', () => {
  assert.deepEqual(NAVM.headingView(1, 1), { col: 0, flip: false });
  assert.deepEqual(NAVM.headingView(-1, 1), { col: 0, flip: true });
  assert.deepEqual(NAVM.headingView(-1, -1), { col: 2, flip: false });
  assert.deepEqual(NAVM.headingView(1, -1), { col: 2, flip: true });
  const pts = [{ x: 0, y: 0 }, { x: 30, y: 40 }, { x: 30, y: 100 }];
  assert.equal(NAVM.pathLength(pts), 110);
  assert.deepEqual([NAVM.pointAlong(pts, 25).x, NAVM.pointAlong(pts, 25).y], [15, 20]);
  assert.equal(NAVM.pointAlong(pts, 500).done, true);
});

test('3D office: the seated-robot column follows the camera angle', () => {
  const Q = Math.PI / 4;
  // default camera (azimuth 45°): desks facing +z show the front-left view, facing −z the rear-right view
  assert.equal(NAVM.seatedColumn(0, Q), 1);
  assert.equal(NAVM.seatedColumn(Math.PI, Q), 2);
  assert.equal(NAVM.seatedColumn(Math.PI / 2, Q), 0);
  assert.equal(NAVM.seatedColumn(-Math.PI / 2, Q), 3);
  // turning the camera half way round swaps toward/away and left/right
  for (const phi of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) assert.equal(NAVM.seatedColumn(phi, Q + Math.PI), 3 - NAVM.seatedColumn(phi, Q));
  // whole turns change nothing
  assert.equal(NAVM.seatedColumn(0, Q + 4 * Math.PI), NAVM.seatedColumn(0, Q));
});

// ---------- the real server ----------
test('server mounts /bots and /api/bots without changing the human HQ', async () => {
  const PORT = 3000 + 900 + Math.floor(Math.random() * 90);
  const store = path.join(TMP, 'human.json'), botStore = path.join(TMP, 'server-bots.json');
  const env = { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', HQ_STORE: store, HQ_BOT_STORE: botStore, OWNER_EMAIL: 'owner@test.local',
    SLACK_BOT_TOKEN: '', SLACK_USER_TOKEN: '', CLICKUP_API_TOKEN: '', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', HQ_PASSWORD: '', PUBLIC_URL: '', DEMO_SIM: 'off' };
  const app = spawn(process.execPath, ['server/index.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; app.stdout.on('data', d => { out += d; }); app.stderr.on('data', d => { out += d; });
  const base = `http://127.0.0.1:${PORT}`;
  try {
    for (let i = 0; i < 60 && !out.includes('Team HQ on'); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(out.includes('127.0.0.1'), 'binds 127.0.0.1 by default: ' + out);
    const root = await fetch(base + '/');
    assert.equal(root.status, 200); assert.ok((await root.text()).includes('Team HQ'), 'human app still at /');
    assert.equal((await (await fetch(base + '/api/state')).json()).mode !== undefined, true, 'human API still works');
    const page = await fetch(base + '/bots/');
    assert.equal(page.status, 200); assert.ok((await page.text()).includes('Team Bot'));
    assert.equal((await fetch(base + '/bots/assets/office-scene.png')).status, 200);
    assert.equal((await fetch(base + '/shared/bots-model.js')).status, 200);
    const st = await (await fetch(base + '/api/bots/state')).json();
    assert.equal(st.ok, true); assert.equal(st.tasks.length, 0);
    assert.equal((await fetch(base + '/api/bots/tasks', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' })).status, 415);
    assert.equal((await fetch(base + '/api/bots/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify(good) })).status, 403);
    const bad = await fetch(base + '/api/bots/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
    assert.equal(bad.status, 400); const badJson = await bad.json(); assert.equal(badJson.ok, false);
    assert.ok(!JSON.stringify(badJson).includes('node_modules'), 'no stack trace');
    assert.equal((await fetch(base + '/api/bots/tasks', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(good) })).status, 405);
    const created = await fetch(base + '/api/bots/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(good) });
    assert.equal(created.status, 200);
    assert.ok(fs.existsSync(botStore), 'writes go to HQ_BOT_STORE');
    assert.equal(JSON.parse(fs.readFileSync(botStore, 'utf8')).tasks.length, 1);
  } finally {
    if (app.exitCode === null && !app.killed) await new Promise(r => { app.once('exit', r); app.kill(); });
  }
});
