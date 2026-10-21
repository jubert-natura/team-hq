// Bot workspace store. Separate from the human team's data/store.json.
// Real data: one JSON file (default data/bot-hq.json, override with HQ_BOT_STORE), written atomically.
// Demo data: built from the fixture into server memory only. It is never written to disk.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildDemo } from './bots-demo.js';
import { seedBots, settleDesks, layoutInput, safeHttpUrl, EXEC, REVIEW, LESSON, TEST_RESULT, ID_RE, BOT_ID_RE, SKILL_COMPAT, SKILL_ADAPTATION } from '../shared/bots-model.js';

export class StoreError extends Error {
  constructor(message) { super(message); this.name = 'StoreError'; this.status = 503; }
}
export const SCHEMA = 2;
export function emptyData() {
  const at = new Date().toISOString();
  return { schema: SCHEMA, created_at: at, seq: 0, bots: seedBots(at), tasks: [], lessons: [], reports: [] };
}

const UNREADABLE = 'The bot data file could not be read, so nothing was changed. Fix or move the file on the server, then restart. Your file has not been overwritten.';

// ---- record shapes: every stored record is checked before the file is accepted ----
// A malformed record anywhere makes the whole file unreadable, so it is never silently overwritten.
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = v => typeof v === 'string';
const isTime = v => isStr(v) && Number.isFinite(Date.parse(v));
const isTimeOrNull = v => v === null || v === undefined || isTime(v);
const isOptStr = v => v === undefined || v === null || isStr(v);
function need(ok, what) { if (!ok) throw new Error(`malformed ${what}`); }
function listOf(arr, what, check) {
  need(Array.isArray(arr), `${what} list`);
  arr.forEach((x, i) => { need(isObj(x), `${what} ${i}`); check(x, `${what} ${i}`); });
}
function unique(arr, what) { need(new Set(arr.map(x => x.id)).size === arr.length, `${what}: duplicate ids`); }
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HASH = /^[a-f0-9]{40}$/;
function checkOrigin(s, w) {
  need(isObj(s) && s.repository === 'natura-hq/team-knowledge' && isStr(s.path) && HASH.test(s.commit) && HASH.test(s.sha), `${w} provenance`);
}
function checkSource(s, w) {
  need(isObj(s) && isStr(s.url) && !!safeHttpUrl(s.url) && isStr(s.revision) && isStr(s.license) && isStr(s.test), `${w} source review`);
  need(Array.isArray(s.files) && s.files.every(isStr) && Array.isArray(s.required_tools) && s.required_tools.every(isStr), `${w} source lists`);
  need(Object.hasOwn(SKILL_ADAPTATION, s.adaptation) && Object.hasOwn(SKILL_COMPAT, s.compatibility) && isTime(s.reviewed_at), `${w} source result`);
}
function checkRun(r, w) {
  need(isObj(r) && isStr(r.id) && /^run_[a-z0-9]+$/.test(r.id) && ['running', 'completed', 'failed', 'interrupted'].includes(r.status), `${w} runtime`);
  need(isStr(r.provider) && isTime(r.started_at) && isTimeOrNull(r.finished_at) && isOptStr(r.error) && isOptStr(r.output), `${w} runtime fields`);
  listOf(r.sources, `${w} sources`, checkOrigin);
  listOf(r.skills, `${w} skills`, (s, sw) => need(isStr(s.id) && isStr(s.name) && Number.isInteger(s.version) && s.version > 0, sw));
}

function checkTask(t, w) {
  need(isStr(t.id) && ID_RE.test(t.id) && t.id.startsWith('task_'), `${w} id`);
  need(Number.isInteger(t.number) && t.number >= 1, `${w} number`);
  need(isStr(t.title) && isStr(t.project) && isStr(t.criteria), `${w} text`);
  need(isStr(t.bot) && BOT_ID_RE.test(t.bot), `${w} bot`);
  need(Object.hasOwn(EXEC, t.execution) && Object.hasOwn(REVIEW, t.review), `${w} status`);
  need(isTime(t.created_at) && isTimeOrNull(t.updated_at) && isTimeOrNull(t.started_at) && isTimeOrNull(t.finished_at), `${w} times`);
  need(isOptStr(t.output_url) && isOptStr(t.source) && isOptStr(t.source_ref), `${w} fields`);
  listOf(t.events, `${w} events`, (e, ew) => need(isStr(e.id) && isTime(e.at) && isStr(e.kind) && isStr(e.text), ew));
  listOf(t.reviews, `${w} reviews`, (r, rw) => need(isStr(r.id) && isTime(r.at) && (r.outcome === 'passed' || r.outcome === 'changes_requested') && isOptStr(r.note) && isOptStr(r.issue), rw));
  if (t.run !== undefined) checkRun(t.run, w);
  if (t.runs !== undefined) listOf(t.runs, `${w} past runs`, checkRun);
}
function checkLesson(l, w) {
  need(isStr(l.id) && ID_RE.test(l.id) && l.id.startsWith('lesson_'), `${w} id`);
  need(isStr(l.title) && isStr(l.lesson) && isStr(l.instruction) && isOptStr(l.source_task), `${w} text`);
  need(isStr(l.bot) && BOT_ID_RE.test(l.bot), `${w} bot`);
  need(Object.hasOwn(LESSON, l.status), `${w} status`);
  need(l.version === undefined || (Number.isInteger(l.version) && l.version >= 1), `${w} version`);
  need(isTime(l.created_at) && isTimeOrNull(l.updated_at) && isTimeOrNull(l.validated_at), `${w} times`);
  listOf(l.tests, `${w} trials`, (x, xw) => need(isStr(x.id) && isTime(x.at) && Object.hasOwn(TEST_RESULT, x.result) && isStr(x.evidence) && isOptStr(x.task) && isOptStr(x.evidence_url)
    && (x.version === undefined || (Number.isInteger(x.version) && x.version >= 1)), xw));
  listOf(l.instruction_history || [], `${w} instruction changes`, (c, cw) => need(isTime(c.at) && isStr(c.from) && isStr(c.to), cw));
  listOf(l.history || [], `${w} history`, (hst, hw) => need(isTime(hst.at) && Object.hasOwn(LESSON, hst.to), hw));
}
function checkReport(r, w) {
  need(isStr(r.id) && ID_RE.test(r.id) && r.id.startsWith('rep_'), `${w} id`);
  need(isStr(r.from) && DATE_ONLY.test(r.from) && isStr(r.to) && DATE_ONLY.test(r.to), `${w} range`);
  need(isTime(r.generated_at), `${w} time`);
  need(isObj(r.report) && isObj(r.report.totals) && Array.isArray(r.report.bots), `${w} contents`);
}
function checkBot(b, w) {
  need(isStr(b.id) && BOT_ID_RE.test(b.id), `${w} id`);
  need(isStr(b.name) && b.name.trim() && isStr(b.role) && isOptStr(b.focus), `${w} text`);
  need(isObj(b.avatar) && isStr(b.avatar.style), `${w} avatar`);
  need(Array.isArray(b.capabilities) && b.capabilities.every(isStr), `${w} capabilities`);
  need(isObj(b.connection) && isStr(b.connection.status), `${w} connection`);
  need(Number.isFinite(b.order) && (b.desk === undefined || (Number.isInteger(b.desk) && b.desk >= 0)), `${w} placement`);
  need(isTime(b.created_at) && isTimeOrNull(b.archived_at), `${w} times`);
  listOf(b.history || [], `${w} history`, (x, xw) => need(isTime(x.at) && isStr(x.kind) && isStr(x.text), xw));
}

/** Check a parsed file. Schema 1 (before the roster was stored) gains the four starting bots; it is saved as schema 2 on the next change. */
function checkShape(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('not an object');
  if (d.schema !== 1 && d.schema !== SCHEMA) throw new Error('unknown schema');
  if (!Array.isArray(d.tasks) || !Array.isArray(d.lessons) || !Array.isArray(d.reports)) throw new Error('missing lists');
  if (!Number.isInteger(d.seq) || d.seq < 0) throw new Error('bad sequence');
  listOf(d.tasks, 'task', checkTask); unique(d.tasks, 'tasks');
  listOf(d.lessons, 'lesson', checkLesson); unique(d.lessons, 'lessons');
  listOf(d.reports, 'report', checkReport); unique(d.reports, 'reports');
  need(d.tasks.every(t => t.number <= d.seq || d.schema === 1), 'task numbering');
  if (d.schema === 1) { d.bots = seedBots(typeof d.created_at === 'string' ? d.created_at : new Date().toISOString()); d.schema = SCHEMA; }
  if (!Array.isArray(d.bots) || d.bots.some(b => !b || typeof b.id !== 'string' || typeof b.name !== 'string')) throw new Error('bad roster');
  listOf(d.bots, 'bot', checkBot); unique(d.bots, 'bots');
  for (const b of d.bots) {
    if (b.layout !== undefined) b.layout = layoutInput(b.layout);
    if (b.enabled !== undefined && typeof b.enabled !== 'boolean') throw new Error('bad availability');
    if (b.prompt !== undefined && typeof b.prompt !== 'string') throw new Error('bad prompt');
    if (b.design_guidelines !== undefined && typeof b.design_guidelines !== 'string') throw new Error('bad guidelines');
    if (b.knowledge_paths !== undefined && (!Array.isArray(b.knowledge_paths) || b.knowledge_paths.length > 5 || b.knowledge_paths.some(p => typeof p !== 'string'))) throw new Error('bad knowledge selection');
    if (b.skills !== undefined && (!Array.isArray(b.skills) || b.skills.some(s => !s || typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.instructions !== 'string' || typeof s.trigger !== 'string' || typeof s.enabled !== 'boolean' || !Number.isInteger(s.version) || s.version < 1))) throw new Error('bad skills');
    for (const s of b.skills || []) {
      if (s.origin !== undefined) checkOrigin(s.origin, 'skill');
      if (s.source !== undefined) checkSource(s.source, 'skill');
      if (s.copied_from !== undefined) need(isObj(s.copied_from) && isStr(s.copied_from.bot) && isStr(s.copied_from.skill) && Number.isInteger(s.copied_from.version) && isTime(s.copied_from.at), 'skill copy record');
    }
  }
  settleDesks(d.bots); // bots saved before desk slots existed get stable desks (saved on the next change)
  return d;
}

export function createBotStore({ file = process.env.HQ_BOT_STORE || 'data/bot-hq.json', demoNow } = {}) {
  const abs = path.resolve(file);
  let real = null, error = null, demo = null;

  function readFile() {
    let raw;
    try { raw = fs.readFileSync(abs, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    return checkShape(JSON.parse(raw));
  }
  function load() {
    try { real = readFile() || emptyData(); error = null; }
    catch (e) { real = null; error = UNREADABLE; console.error(`bot store: could not read data file (${e.code || e.message})`); }
  }
  load();

  /** Write to a temporary file next to the target, then rename over it, so a crash never leaves half a file. */
  function writeAtomic(data) {
    // Refuse to replace a file that has become unreadable since we loaded it.
    try { readFile(); } catch { error = UNREADABLE; throw new StoreError(UNREADABLE); }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { flag: 'wx' });
      fs.renameSync(tmp, abs);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      console.error(`bot store: save failed (${e.code || e.message})`);
      throw new StoreError('Could not save the bot data file. Nothing was changed.');
    }
  }

  const getDemo = () => (demo ||= buildDemo(demoNow ? demoNow() : Date.now()));

  return {
    status: () => ({ ok: !error, error }),
    /** The current data for a dataset ('real' or 'demo'). Callers must not mutate it. */
    read(dataset) {
      if (dataset === 'demo') return getDemo();
      if (error) throw new StoreError(error);
      return real;
    },
    /**
     * Apply a change to a copy. If `fn` throws, nothing changes. Real changes are saved before they become visible.
     * Returns what `fn` returns.
     */
    mutate(dataset, fn) {
      const base = this.read(dataset);
      const draft = structuredClone(base);
      const out = fn(draft);
      if (dataset === 'demo') { demo = draft; return out; }
      writeAtomic(draft);
      real = draft;
      return out;
    },
    resetDemo() { demo = buildDemo(demoNow ? demoNow() : Date.now()); return demo; },
    reload: load
  };
}
