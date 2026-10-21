// /api/bots: shared configuration is owner managed; approved HQ members own their personal tasks and API connection.
// Only GET and POST exist. Shared settings cannot be changed by a member, including via a direct API request.
// CLI adapters remain available to isolated test harnesses; the application uses personal API runtimes exclusively.
import express from 'express';
import crypto from 'node:crypto';
import {
  EXEC, REVIEW_SET, LESSON, TEST_RESULT, LIMITS, KNOWLEDGE_REPO, CONNECTION, CHARACTER_STYLES,
  BOT_TEMPLATES, SKILL_TEMPLATES, SKILL_ID_RE, skillInput, skillSourceInput, skillBlocker, SKILL_COMPAT, booleanInput, isEnabled, layoutInput,
  ValidationError, text, oneOf, httpUrl, idOf, botIdOf, botInput, finiteNumber, rangeBounds, lessonTransition, lessonEvidence,
  buildReport, suggestions, tasksInRange, SUGGESTION_KEY_RE, initials, isActive, isOpen, newConnection, settleDesks, lowestFree
} from '../shared/bots-model.js';
import { StoreError } from './bots-store.js';
import { BridgeError } from './bots-bridge.js';

export class NotFound extends Error { constructor(what) { super(`${what} not found.`); this.status = 404; } }
class Refused extends Error { constructor(msg, status = 403) { super(msg); this.status = status; } }

const newId = p => `${p}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
const DATASETS = ['real', 'demo'];

/** Errors as JSON. Never sends stack traces or file paths. */
export function sendError(res, e) {
  if (e instanceof ValidationError) return res.status(400).json({ ok: false, error: e.message, field: e.field });
  if (e instanceof NotFound || e instanceof Refused || e instanceof StoreError || e instanceof BridgeError) return res.status(e.status).json({ ok: false, error: e.message });
  if (e && e.type === 'entity.parse.failed') return res.status(400).json({ ok: false, error: 'The request body is not valid JSON.' });
  if (e && e.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'The request is too large.' });
  console.error('bots api:', e && e.message);
  return res.status(500).json({ ok: false, error: 'Something went wrong. Nothing was changed.' });
}
/** Error handler for /api/bots (catches body-parser errors raised before the router runs). */
export function botsErrorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(err);
  sendError(res, err);
}

export function createBotsRouter({ store, ownerEmail = () => '', knowledge = null, runtime = null, personalAI = null, authReady = () => false, candidates = () => [] } = {}) {
  const r = express.Router();
  const running = new Set();
  if (runtime || personalAI) {
    // A process restart cannot leave a task claiming it is still executing.
    const interrupted = store.status().ok && store.read('real').tasks.filter(t => t.run?.status === 'running');
    if (interrupted?.length) store.mutate('real', d => {
      for (const t of d.tasks.filter(t => t.run?.status === 'running')) {
        t.run.status = 'interrupted'; t.run.error = 'The server restarted during this run. Start a new run to retry.';
        t.execution = 'blocked'; t.updated_at = new Date().toISOString();
      }
    });
  }

  // GET/POST only, so no PUT/PATCH/DELETE path can bypass the POST safeguards.
  r.use((req, res, next) => {
    if (['GET', 'HEAD', 'POST'].includes(req.method)) return next();
    res.set('Allow', 'GET, POST').status(405).json({ ok: false, error: 'Method not allowed.' });
  });
  // Owner only, for reads as well as writes.
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    let localHost = false;
    try { localHost = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(`http://${req.get('host')}`).hostname); } catch { /* refused below */ }
    if (personalAI && !req.email && !(localHost && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress))) return res.status(401).json({ ok: false, error: 'Sign in to Human HQ first.' });
    if (req.admin === true || (req.email && personalAI?.allowed(req.email))) return next();
    res.status(403).json({ ok: false, error: 'Ask the HQ owner to approve your AI workspace access.' });
  });
  if (!personalAI && (knowledge || runtime)) r.use((req, res, next) => {
    let host;
    try { host = new URL(`http://${req.get('host')}`).hostname; } catch { /* refused below */ }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return res.status(403).json({ ok: false, error: 'The local bot bridge only accepts a loopback host.' });
    next();
  });
  // Same safeguards as the rest of HQ's API (repeated here so the router is safe on its own): same-origin JSON writes.
  r.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const origin = req.get('origin'); let host = null;
    try { host = origin && new URL(origin).host; } catch { host = '?'; }
    if (origin && host !== req.get('host')) return res.status(403).json({ ok: false, error: 'Cross-site request refused.' });
    if (req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ ok: false, error: 'Cross-site request refused.' });
    if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'Send JSON.' });
    next();
  });

  // Members share approved bot configuration, but can only read and change their own tasks.
  r.use((req, res, next) => {
    if (req.admin) return next();
    const allowed = (req.get('x-bot-dataset') || 'real') === 'real' && ((req.method === 'GET' && ['/state', '/account'].includes(req.path)) ||
      (req.method === 'POST' && ['/account', '/account/disconnect', '/runtime/verify', '/tasks'].includes(req.path)) ||
      (req.method === 'POST' && /^\/tasks\/[^/]+\/(run|execution|review|note)$/.test(req.path)));
    if (!allowed) return res.status(403).json({ ok: false, error: 'Only the owner can manage shared bots, skills and workspace settings.' });
    if (req.path.startsWith('/tasks/')) {
      let id; try { id = decodeURIComponent(req.path.split('/')[2]); } catch { return res.status(400).json({ ok: false, error: 'Invalid task ID.' }); }
      const t = store.read('real').tasks.find(t => t.id === id && t.created_by === req.email);
      if (!t) return res.status(404).json({ ok: false, error: 'Task not found.' });
    }
    next();
  });
  r.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const h = req.get('x-bot-dataset');
    if (h !== undefined && !DATASETS.includes(h)) return res.status(400).json({ ok: false, error: 'Unknown dataset.', field: 'dataset' });
    req.dataset = h || 'real';
    next();
  });

  const handle = fn => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json({ ok: true, dataset: req.dataset, ...(out || {}) });
    } catch (e) { sendError(res, e); }
  };
  const body = req => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});
  const now = () => new Date().toISOString();
  const source = req => (req.dataset === 'demo' ? 'demo' : 'manual');
  const findTask = (d, id) => { idOf(id, 'task', 'task'); const t = d.tasks.find(x => x.id === id); if (!t) throw new NotFound('Task'); return t; };
  const findLesson = (d, id) => { idOf(id, 'lesson', 'lesson'); const l = d.lessons.find(x => x.id === id); if (!l) throw new NotFound('Lesson'); return l; };
  const addEvent = (req, t, at, kind, txt, extra = {}) => {
    t.events.push({ id: newId('evt'), at, kind, text: txt, source: source(req), actor: req.email || ownerEmail(), ...extra });
    if (t.events.length > LIMITS.events) t.events.splice(0, t.events.length - LIMITS.events);
    t.updated_at = at;
  };
  const range = (q) => {
    const from = q.from, to = q.to;
    const tz = q.tz === undefined ? 0 : finiteNumber(q.tz, 'tz', { min: -900, max: 900, integer: true });
    return { from, to, tz, ...rangeBounds(from, to, tz) };
  };
  /** A bot from the roster. `active` refuses archived bots (they keep their history but take no new work). */
  const findBot = (d, id, { active = false, field = 'bot', inBody = true } = {}) => {
    botIdOf(id, field);
    const b = d.bots.find(x => x.id === id);
    if (!b) { if (inBody) throw new ValidationError('Choose a bot from the roster.', field); throw new NotFound('Bot'); }
    if (active && !isActive(b)) throw new ValidationError(`${b.name} is archived. Restore it before giving it new work.`, field);
    if (active && !isEnabled(b)) throw new ValidationError(`${b.name} is off. Turn it on before giving it new work.`, field);
    return b;
  };
  const nameFree = (d, name, exceptId) => {
    const clash = d.bots.find(x => isActive(x) && x.id !== exceptId && x.name.toLowerCase() === name.toLowerCase());
    if (clash) throw new ValidationError(`An active bot is already called ${clash.name}.`, 'name');
  };
  const botHistory = (b, at, kind, txt) => {
    b.history.push({ at, kind, text: txt });
    if (b.history.length > LIMITS.botHistory) b.history.splice(0, b.history.length - LIMITS.botHistory);
    b.updated_at = at;
  };
  /** What the browser sees: the stored configuration plus the effective connection for this dataset. */
  const publicBot = (req, b) => {
    const rt = personalAI ? personalAI.status(req.email || ownerEmail()) : runtime?.status();
    const status = req.dataset === 'demo' ? 'demo' : rt?.connected ? 'connected' : 'disconnected';
    return { ...b, enabled: b.enabled !== false, prompt: b.prompt || '', design_guidelines: b.design_guidelines || '', skills: b.skills || [], connection: status, connection_label: CONNECTION[status], connection_verified_at: rt?.verified_at || null, runtime_provider: rt?.provider || null };
  };
  const liveOnly = req => { if (req.dataset === 'demo') throw new Refused('Live connections are unavailable in demo mode.', 400); };
  const requireKnowledge = req => { liveOnly(req); if (!knowledge) throw new Refused('The shared knowledge bridge is not enabled on this server.', 503); };
  const unlocked = t => { if (running.has(t.id)) throw new Refused('Wait for the runtime to finish before changing this task.', 409); };

  const identity = req => req.email || ownerEmail();
  const needPersonal = req => {
    liveOnly(req); if (!personalAI) throw new Refused('Personal connections are not configured.', 503);
    // Remote users need a real HQ session and encrypted transport. Open/password mode is local-owner only.
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (!req.email && !local) throw new Refused('Sign in to Human HQ before configuring AI.');
    if (!req.secure && !local) throw new Refused('Use HTTPS before entering an API key.');
  };
  r.get('/account', handle(req => {
    needPersonal(req);
    return { identity: identity(req), signed_in: !!req.email, auth_ready: authReady(), runtime: personalAI.status(identity(req)) };
  }));
  r.post('/account', handle(req => { needPersonal(req); return { runtime: personalAI.save(identity(req), body(req)) }; }));
  r.post('/account/disconnect', handle(req => { needPersonal(req); return { runtime: personalAI.disconnect(identity(req)) }; }));
  r.get('/access', handle(req => {
    if (!req.admin || !personalAI) throw new Refused('Only the owner can manage access.');
    return { auth_ready: authReady(), candidates: candidates(), members: personalAI.members() };
  }));
  r.post('/access', handle(req => {
    if (!req.admin || !personalAI) throw new Refused('Only the owner can manage access.');
    const { email, enabled } = body(req);
    if (!authReady()) throw new Refused('Configure Human HQ Google sign-in before approving teammates.', 409);
    if (enabled && !candidates().some(c => c.email === String(email).trim().toLowerCase())) throw new Refused('Choose a teammate from the real Human HQ team.');
    personalAI.grant(email, enabled, identity(req)); return { members: personalAI.members() };
  }));

  // ---- read ----
  r.get('/state', handle(req => {
    const d = store.read(req.dataset), st = store.status();
    return {
      store: { ok: st.ok },
      viewer: { initials: initials(req.email || ownerEmail()), email: identity(req), admin: req.admin === true },
      bots: d.bots.map(b => publicBot(req, b)),
      styles: CHARACTER_STYLES,
      bot_templates: BOT_TEMPLATES, skill_templates: SKILL_TEMPLATES,
      tasks: req.admin ? d.tasks : d.tasks.filter(t => t.created_by === req.email), lessons: req.admin ? d.lessons : [], reports: req.admin ? d.reports : [],
      knowledge: req.admin && req.dataset === 'real' && knowledge ? knowledge.status() : { url: KNOWLEDGE_REPO, linked: true, ingested: false, notes: [] },
      runtime: req.dataset === 'real' && personalAI ? personalAI.status(identity(req)) : req.dataset === 'real' && runtime ? runtime.status() : { adapter: false, dispatch: false }
    };
  }));
  r.post('/knowledge/sync', handle(async req => { requireKnowledge(req); return { knowledge: await knowledge.sync() }; }));
  r.get('/knowledge/note', handle(async req => { requireKnowledge(req); return { note: await knowledge.note(req.query.path) }; }));
  r.post('/runtime/verify', handle(async req => {
    if (personalAI) { needPersonal(req); return { runtime: await personalAI.verify(identity(req)) }; }
    liveOnly(req); if (!runtime) throw new Refused('The runtime bridge is not enabled.', 503);
    if (running.size) throw new Refused('Wait for the active task to finish.', 409);
    return { runtime: await runtime.verify() };
  }));
  r.post('/roster/:id/knowledge', handle(req => {
    requireKnowledge(req);
    const paths = body(req).paths;
    if (!Array.isArray(paths) || paths.length > 5 || new Set(paths).size !== paths.length || paths.some(p => !knowledge.status().notes.some(n => n.path === p))) throw new ValidationError('Choose up to five notes from the synced repository.', 'paths');
    return store.mutate('real', d => {
      const b = findBot(d, req.params.id, { inBody: false }); b.knowledge_paths = paths;
      botHistory(b, now(), 'knowledge', `Selected ${paths.length} shared context notes.`);
      return { bot: publicBot(req, b) };
    });
  }));
  r.post('/roster/:id/knowledge/import', handle(async req => {
    requireKnowledge(req);
    const note = await knowledge.note(body(req).path);
    if (body(req).sha !== note.sha) throw new Refused('This note changed since preview. Preview the current version before importing.', 409);
    const v = skillInput({ name: note.path.split('/').pop().replace(/\.md$/, '').slice(0, 80), trigger: body(req).trigger || 'When relevant to the assigned task', instructions: note.content, reference_url: note.url });
    return store.mutate('real', d => {
      const b = findBot(d, req.params.id, { inBody: false }); b.skills ||= [];
      const existing = b.skills.find(s => s.origin?.path === note.path && s.origin?.repository === note.repository);
      if (!existing && b.skills.length >= LIMITS.skills) throw new ValidationError('This bot has reached its skill limit.', 'path');
      if (b.skills.some(s => s !== existing && s.name.toLowerCase() === v.name.toLowerCase())) throw new ValidationError('A skill already has this name. Rename it before importing.', 'path');
      if (existing?.origin?.sha === note.sha && existing.instructions === v.instructions) throw new ValidationError('This skill version is already imported.', 'path');
      const at = now(), skill = existing || { id: newId('skill'), enabled: true, version: 0, created_at: at };
      Object.assign(skill, v, { version: skill.version + 1, updated_at: at, origin: { repository: note.repository, path: note.path, commit: note.commit, sha: note.sha, imported_at: at } });
      if (!existing) b.skills.push(skill);
      botHistory(b, at, 'skill_imported', `Reviewed and imported ${skill.name}, version ${skill.version}.`);
      return { skill, bot: publicBot(req, b) };
    });
  }));
  r.post('/tasks/:id/run', handle(req => {
    requireKnowledge(req);
    if (personalAI) needPersonal(req);
    const selectedRuntime = personalAI ? personalAI.runtime(identity(req)) : runtime;
    if (!selectedRuntime) throw new Refused('The runtime bridge is not enabled.', 503);
    if (running.size || selectedRuntime.status().busy) throw new Refused('A runtime request is already active. Wait for it to finish.', 409);
    const data = store.read('real'), task = findTask(data, req.params.id), bot = findBot(data, task.bot, { active: true });
    if (['completed', 'cancelled', 'in_progress'].includes(task.execution)) throw new ValidationError('Run a queued or blocked task. Reopen completed work before retrying.', 'execution');
    const enabledSkills = (bot.skills || []).filter(s => s.enabled && !skillBlocker(s)).map(s => ({
      id: s.id, name: s.name, version: s.version, trigger: s.trigger, instructions: s.instructions, origin: s.origin || null,
      source: s.source ? { url: s.source.url, revision: s.source.revision, license: s.source.license } : null
    }));
    const config = structuredClone({ name: bot.name, role: bot.role, prompt: bot.prompt || '', design_guidelines: bot.design_guidelines || '', skills: enabledSkills, paths: bot.knowledge_paths || [] });
    if (JSON.stringify(config).length > 60000) throw new ValidationError('Enabled instructions exceed the runtime context limit. Turn off unrelated skills.', 'skills');
    const runId = newId('run'), at = now();
    store.mutate('real', d => {
      const t = findTask(d, task.id); t.execution = 'in_progress'; t.started_at = at; t.finished_at = null; t.updated_at = at;
      if (t.run) { t.runs ||= []; t.runs.push(t.run); if (t.runs.length > 50) t.runs.shift(); }
      t.run = { id: runId, status: 'running', provider: selectedRuntime.status().provider, model: selectedRuntime.status().model || null, executed_by: identity(req), started_at: at, skills: enabledSkills.map(({ instructions, ...s }) => s), configuration: config, sources: [], error: null };
      addEvent(req, t, at, 'runtime', `${t.run.provider} runtime started: shared notes and enabled skills will be loaded.`, { source: 'runtime' });
    });
    running.add(task.id);
    void (async () => {
      try {
        await knowledge.sync();
        const notes = await Promise.all(config.paths.map(p => knowledge.note(p)));
        if (notes.reduce((n, s) => n + s.content.length, 0) > 48000) throw new BridgeError('Selected notes exceed the context limit. Choose fewer or shorter notes.', 400);
        const sources = notes.map(({ content, ...s }) => s);
        store.mutate('real', d => { findTask(d, task.id).run.sources = sources; });
        if (!req.admin && !personalAI?.allowed(req.email)) throw new BridgeError('Workspace access was revoked before dispatch.', 403);
        const response = await selectedRuntime.draft(JSON.stringify({ task: { title: task.title, project: task.project, acceptance_criteria: task.criteria }, bot: config, shared_reference_notes: notes }));
        store.mutate('real', d => {
          const t = findTask(d, task.id); t.execution = 'completed'; t.finished_at = now();
          Object.assign(t.run, { status: 'completed', finished_at: t.finished_at, output: response.text, session_id: response.session_id });
          if (t.review === 'not_requested') t.review = 'pending';
          addEvent(req, t, t.finished_at, 'runtime', `${t.run.provider} returned a draft. Human review is pending.`, { source: 'runtime' });
        });
      } catch (e) {
        try { store.mutate('real', d => {
          const t = findTask(d, task.id); t.execution = 'blocked';
          Object.assign(t.run, { status: 'failed', error: e instanceof BridgeError ? e.message : 'The runtime could not complete this task.', finished_at: now() });
          addEvent(req, t, now(), 'runtime', t.run.error, { source: 'runtime' });
        }); } catch { console.error('Could not persist runtime outcome. Restart will mark it interrupted.'); }
      } finally { running.delete(task.id); }
    })();
    return { task: store.read('real').tasks.find(t => t.id === task.id) };
  }));
  r.get('/reports/preview', handle(req => {
    const d = store.read(req.dataset), q = range(req.query);
    return { report: buildReport(d.tasks, d.lessons, q, d.bots) };
  }));

  // ---- roster: add, edit, archive, restore. There is no delete: history must stay attached to its bot. ----
  r.post('/roster', handle(req => {
    const v = botInput(body(req));
    return store.mutate(req.dataset, d => {
      if (d.bots.length >= LIMITS.bots) throw new ValidationError('The bot limit for this workspace has been reached.', 'name');
      nameFree(d, v.name);
      const at = now();
      // the new bot takes the lowest free desk; nobody else moves
      const b = {
        id: newId('bot'), name: v.name, role: v.role, focus: v.focus, avatar: { style: v.style }, capabilities: v.capabilities,
        connection: newConnection(), order: d.bots.reduce((m, x) => Math.max(m, x.order || 0), -1) + 1, desk: lowestFree(settleDesks(d.bots)),
        created_at: at, updated_at: at, archived_at: null, history: [],
        enabled: true, prompt: v.prompt || '', design_guidelines: v.design_guidelines || '', skills: []
      };
      botHistory(b, at, 'created', `Added as ${v.role} at desk ${b.desk + 1}. Starts Disconnected until a connection is verified.`);
      d.bots.push(b);
      return { bot: publicBot(req, b) };
    });
  }));
  r.post('/roster/:id', handle(req => {
    const v = botInput(body(req));
    return store.mutate(req.dataset, d => {
      const b = findBot(d, req.params.id, { field: 'id', inBody: false });
      if (isActive(b)) nameFree(d, v.name, b.id);
      const changed = [];
      if (b.name !== v.name) changed.push(`name ${b.name} → ${v.name}`);
      if (b.role !== v.role) changed.push(`role ${b.role} → ${v.role}`);
      if ((b.focus || '') !== v.focus) changed.push('description');
      if (b.avatar.style !== v.style) changed.push(`character style → ${CHARACTER_STYLES[v.style].label}`);
      if (JSON.stringify(b.capabilities) !== JSON.stringify(v.capabilities)) changed.push('capabilities');
      const config = {};
      for (const field of ['prompt', 'design_guidelines']) if (v[field] !== undefined) {
        if ((b[field] || '') !== v[field]) changed.push(field === 'prompt' ? 'prompt' : 'design guidelines');
        config[field] = v[field];
      }
      if (!changed.length) throw new ValidationError('Nothing changed.', 'name');
      Object.assign(b, { name: v.name, role: v.role, focus: v.focus, avatar: { ...b.avatar, style: v.style }, capabilities: v.capabilities });
      Object.assign(b, config);
      botHistory(b, now(), 'edited', `Edited: ${changed.join(', ')}`);
      return { bot: publicBot(req, b) };
    });
  }));
  r.post('/roster/:id/archive', handle(req => {
    const note = text(body(req).note, 'note', { max: LIMITS.note, required: false, label: 'Note' });
    return store.mutate(req.dataset, d => {
      const b = findBot(d, req.params.id, { field: 'id', inBody: false });
      if (!isActive(b)) throw new ValidationError(`${b.name} is already archived.`, 'id');
      const at = now(), open = d.tasks.filter(t => t.bot === b.id && isOpen(t)).length;
      b.archived_at = at;
      botHistory(b, at, 'archived', `Archived${note ? `: ${note}` : ''}${open ? ` (${open} open task${open === 1 ? '' : 's'} kept in history)` : ''}`);
      return { bot: publicBot(req, b), open };
    });
  }));
  r.post('/roster/:id/restore', handle(req => store.mutate(req.dataset, d => {
    const b = findBot(d, req.params.id, { field: 'id', inBody: false });
    if (isActive(b)) throw new ValidationError(`${b.name} is not archived.`, 'id');
    nameFree(d, b.name, b.id);
    const at = now();
    // back to its old desk if that is still free, otherwise the lowest free desk
    const slots = settleDesks(d.bots);
    if (!Number.isInteger(b.desk) || slots.has(b.desk)) b.desk = lowestFree(slots);
    b.archived_at = null;
    b.order = d.bots.reduce((m, x) => Math.max(m, x.order || 0), -1) + 1;
    botHistory(b, at, 'restored', `Restored to the team at desk ${b.desk + 1}. Still Disconnected until a connection is verified.`);
    return { bot: publicBot(req, b) };
  })));

  // Availability is independent from connection and archive status. No external job is stopped here.
  r.post('/roster/:id/enabled', handle(req => {
    const enabled = booleanInput(body(req).enabled);
    return store.mutate(req.dataset, d => {
      const b = findBot(d, req.params.id, { field: 'id', inBody: false });
      if (!isActive(b)) throw new ValidationError('Restore this bot before changing its availability.', 'id');
      if ((b.enabled !== false) === enabled) throw new ValidationError(`Bot is already ${enabled ? 'on' : 'off'}.`, 'enabled');
      b.enabled = enabled;
      botHistory(b, now(), enabled ? 'enabled' : 'disabled', enabled ? 'Turned on for new assignments.' : 'Turned off. Existing tasks and skills are kept; no external jobs are cancelled.');
      return { bot: publicBot(req, b) };
    });
  }));
  const findSkill = (b, id) => {
    if (!SKILL_ID_RE.test(id)) throw new ValidationError('Invalid skill id.', 'skill');
    const s = (b.skills || []).find(x => x.id === id);
    if (!s) throw new NotFound('Skill');
    return s;
  };
  const roomForSkill = (b, name) => {
    b.skills ||= [];
    if (b.skills.length >= LIMITS.skills) throw new ValidationError(`Keep ${LIMITS.skills} skills or fewer per bot.`, 'name');
    if (b.skills.some(s => s.name.toLowerCase() === name.toLowerCase())) throw new ValidationError(`${b.name} already has a skill with that name.`, 'name');
  };
  // An optional `source` records an outside catalog skill's review. Until it is ready, the skill starts off.
  r.post('/roster/:id/skills', handle(req => {
    const v = skillInput(body(req)), src = body(req).source == null ? null : skillSourceInput(body(req).source);
    return store.mutate(req.dataset, d => {
      const b = findBot(d, req.params.id, { field: 'id', inBody: false });
      roomForSkill(b, v.name);
      const at = now(), skill = { id: newId('skill'), ...v, enabled: true, version: 1, created_at: at, updated_at: at };
      if (src) { skill.source = { ...src, reviewed_at: at }; skill.enabled = !skillBlocker(skill); }
      b.skills.push(skill); botHistory(b, at, 'skill_added', `Added skill: ${skill.name}${skill.enabled ? '' : ` (off until its source review is ready: ${SKILL_COMPAT[src.compatibility]})`}`);
      return { skill, bot: publicBot(req, b) };
    });
  }));
  // Copy on the server, so Team Knowledge provenance and the source review travel with the instructions.
  r.post('/roster/:id/skills/:skill/copy', handle(req => {
    const to = body(req).bot;
    return store.mutate(req.dataset, d => {
      const from = findBot(d, req.params.id, { field: 'id', inBody: false }), s = findSkill(from, req.params.skill);
      const b = findBot(d, to, { inBody: true });
      if (b.id === from.id) throw new ValidationError('Choose a different bot.', 'bot');
      if (!isActive(b)) throw new ValidationError(`${b.name} is archived. Restore it first.`, 'bot');
      roomForSkill(b, s.name);
      const at = now(), skill = {
        id: newId('skill'), name: s.name, trigger: s.trigger, instructions: s.instructions, reference_url: s.reference_url || '',
        enabled: s.enabled && !skillBlocker(s), version: 1, created_at: at, updated_at: at,
        copied_from: { bot: from.id, skill: s.id, version: s.version, at }
      };
      if (s.origin) skill.origin = structuredClone(s.origin);
      if (s.source) skill.source = structuredClone(s.source);
      b.skills.push(skill);
      botHistory(b, at, 'skill_added', `Copied skill ${skill.name} from ${from.name} (version ${s.version}).`);
      return { skill, bot: publicBot(req, b) };
    });
  }));
  // Record or update the source review. A result other than ready turns the skill off. `remove: true` drops it.
  r.post('/roster/:id/skills/:skill/source', handle(req => {
    const remove = body(req).remove === true, src = remove ? null : skillSourceInput(body(req));
    return store.mutate(req.dataset, d => {
      const b = findBot(d, req.params.id, { field: 'id', inBody: false }), skill = findSkill(b, req.params.skill);
      if (skill.origin) throw new ValidationError('Team Knowledge skills are pinned to their published revision. Reimport the note to review a new version.', 'url');
      if (remove && !skill.source) throw new ValidationError('This skill has no source review.', 'url');
      if (src && skill.source && Object.keys(src).every(k => JSON.stringify(skill.source[k]) === JSON.stringify(src[k]))) throw new ValidationError('Nothing changed.', 'url');
      const at = now(), wasOn = skill.enabled;
      if (remove) delete skill.source; else skill.source = { ...src, reviewed_at: at };
      if (skillBlocker(skill)) skill.enabled = false;
      skill.updated_at = at;
      botHistory(b, at, 'skill_source', remove ? `Removed the source review from ${skill.name}.`
        : `Source review for ${skill.name}: ${SKILL_COMPAT[src.compatibility]}${src.revision ? ` at ${src.revision}` : ''}${wasOn && !skill.enabled ? '. Turned off until it is ready.' : '.'}`);
      return { skill, bot: publicBot(req, b) };
    });
  }));
  r.post('/roster/:id/skills/:skill', handle(req => {
    const v = skillInput(body(req));
    return store.mutate(req.dataset, d => {
      const b = findBot(d, req.params.id, { field: 'id', inBody: false }), skill = findSkill(b, req.params.skill);
      if ((b.skills || []).some(s => s.id !== skill.id && s.name.toLowerCase() === v.name.toLowerCase())) throw new ValidationError('This bot already has a skill with that name.', 'name');
      if (Object.keys(v).every(k => skill[k] === v[k])) throw new ValidationError('Nothing changed.', 'name');
      Object.assign(skill, v, { version: skill.version + 1, updated_at: now() });
      botHistory(b, skill.updated_at, 'skill_edited', `Updated skill: ${skill.name} (version ${skill.version})`);
      return { skill, bot: publicBot(req, b) };
    });
  }));
  r.post('/roster/:id/skills/:skill/enabled', handle(req => {
    const enabled = booleanInput(body(req).enabled);
    return store.mutate(req.dataset, d => {
      const b = findBot(d, req.params.id, { field: 'id', inBody: false }), skill = findSkill(b, req.params.skill);
      if (skill.enabled === enabled) throw new ValidationError(`Skill is already ${enabled ? 'on' : 'off'}.`, 'enabled');
      if (enabled && skillBlocker(skill)) throw new ValidationError(skillBlocker(skill), 'enabled');
      skill.enabled = enabled; skill.updated_at = now();
      botHistory(b, skill.updated_at, 'skill_toggled', `${enabled ? 'Enabled' : 'Disabled'} skill: ${skill.name}`);
      return { skill, bot: publicBot(req, b) };
    });
  }));

  // Atomic scene save: invalid input never partially saves a layout.
  r.post('/layout', handle(req => {
    const changes = body(req).changes;
    if (!Array.isArray(changes) || !changes.length || changes.length > LIMITS.bots) throw new ValidationError('Choose at least one workstation to save.', 'changes');
    const seen = new Set();
    const values = changes.map(c => {
      if (!c || typeof c !== 'object') throw new ValidationError('Invalid workstation.', 'changes');
      const bot = botIdOf(c.bot);
      if (seen.has(bot)) throw new ValidationError('A workstation appears more than once.', 'changes');
      seen.add(bot); return { bot, layout: c.layout === null ? null : layoutInput(c.layout) };
    });
    return store.mutate(req.dataset, d => {
      const at = now(); let saved = 0;
      for (const v of values) {
        const b = findBot(d, v.bot);
        if (!isActive(b)) throw new ValidationError(`${b.name} is archived. Restore it before editing its position.`, 'bot');
        if (JSON.stringify(b.layout || null) === JSON.stringify(v.layout)) continue;
        if (v.layout === null) delete b.layout; else b.layout = v.layout;
        botHistory(b, at, 'layout_edited', v.layout ? 'Saved workstation position, perspective and component alignment.' : 'Reset workstation to its assigned desk position and default alignment.');
        saved++;
      }
      return { saved };
    });
  }));

  // ---- tasks ----
  r.post('/tasks', handle(req => {
    const b = body(req);
    const title = text(b.title, 'title', { max: LIMITS.title, label: 'Title' });
    const botId = botIdOf(b.bot);
    const project = text(b.project, 'project', { max: LIMITS.project, label: 'Project' });
    const criteria = text(b.criteria, 'criteria', { max: LIMITS.criteria, min: 10, label: 'Acceptance criteria' });
    const output = httpUrl(b.output_url, 'output_url', { label: 'Output link' });
    return store.mutate(req.dataset, d => {
      const who = findBot(d, botId, { active: true });
      if (d.tasks.length >= LIMITS.tasks) throw new ValidationError('The task limit for this workspace has been reached.', 'title');
      const at = now();
      d.seq += 1;
      const t = {
        id: newId('task'), number: d.seq, title, bot: botId, project, criteria, output_url: output, source: source(req), source_ref: '',
        execution: 'queued', review: 'not_requested', created_by: identity(req), created_at: at, updated_at: at, started_at: null, finished_at: null, events: [], reviews: []
      };
      addEvent(req, t, at, 'created', `Assigned to ${who.name} by ${identity(req)}`);
      d.tasks.push(t);
      return { task: t };
    });
  }));

  // Execution and review are separate records: changing one never changes the other.
  r.post('/tasks/:id/execution', handle(req => {
    const b = body(req);
    const status = oneOf(b.status, EXEC, 'status', 'Execution status');
    const note = text(b.note, 'note', { max: LIMITS.note, required: false, label: 'Note' });
    return store.mutate(req.dataset, d => {
      const t = findTask(d, req.params.id);
      unlocked(t);
      if (t.execution === status) throw new ValidationError(`Execution is already ${EXEC[status]}.`, 'status');
      const at = now(), from = t.execution;
      t.execution = status;
      if (status === 'in_progress' && !t.started_at) t.started_at = at;
      if (status === 'completed') t.finished_at = at;
      else if (from === 'completed') t.finished_at = null; // reopened: the earlier finish no longer stands
      addEvent(req, t, at, 'execution', `Execution: ${EXEC[from]} → ${EXEC[status]}${note ? ` — ${note}` : ''}`, { from, to: status });
      return { task: t };
    });
  }));
  r.post('/tasks/:id/review', handle(req => {
    const b = body(req);
    const status = oneOf(b.status, REVIEW_SET, 'status', 'Review status');
    const note = text(b.note, 'note', { max: LIMITS.note, required: status === 'changes_requested', min: 3, label: 'Review note' });
    const issue = text(b.issue, 'issue', { max: LIMITS.issue, required: false, label: 'Issue' });
    return store.mutate(req.dataset, d => {
      const t = findTask(d, req.params.id);
      unlocked(t);
      if (status === 'pending' && t.review === 'pending') throw new ValidationError('Review is already pending.', 'status');
      const at = now(), from = t.review;
      t.review = status;
      if (status !== 'pending') t.reviews.push({ id: newId('rev'), at, outcome: status, reviewed_by: identity(req), note, issue: status === 'changes_requested' ? issue : '' });
      const label = status === 'pending' ? 'Review requested' : status === 'passed' ? 'Passed review' : 'Changes requested';
      addEvent(req, t, at, 'review', note ? `${label}: ${note}` : label, { from, to: status });
      return { task: t };
    });
  }));
  r.post('/tasks/:id/output', handle(req => {
    const url = httpUrl(body(req).url, 'url', { label: 'Output link' });
    return store.mutate(req.dataset, d => {
      const t = findTask(d, req.params.id);
      if (t.output_url === url) throw new ValidationError(url ? 'That link is already saved.' : 'There is no link to remove.', 'url');
      t.output_url = url;
      addEvent(req, t, now(), 'output', url ? 'Output link saved' : 'Output link removed');
      return { task: t };
    });
  }));
  r.post('/tasks/:id/note', handle(req => {
    const note = text(body(req).text, 'text', { max: LIMITS.note, label: 'Note' });
    return store.mutate(req.dataset, d => {
      const t = findTask(d, req.params.id);
      addEvent(req, t, now(), 'note', note);
      return { task: t };
    });
  }));

  // ---- lessons ----
  r.post('/lessons', handle(req => {
    const b = body(req);
    const title = text(b.title, 'title', { max: LIMITS.title, label: 'Title' });
    const botId = botIdOf(b.bot);
    const lesson = text(b.lesson, 'lesson', { max: LIMITS.lesson, min: 5, label: 'Lesson' });
    const instruction = text(b.instruction, 'instruction', { max: LIMITS.instruction, min: 5, label: 'Proposed instruction' });
    const sourceTask = b.source_task ? idOf(b.source_task, 'source_task', 'task') : '';
    return store.mutate(req.dataset, d => {
      findBot(d, botId, { active: true });
      if (sourceTask) findTask(d, sourceTask);
      if (d.lessons.length >= LIMITS.lessons) throw new ValidationError('The lesson limit for this workspace has been reached.', 'title');
      const at = now();
      const l = {
        id: newId('lesson'), title, bot: botId, source_task: sourceTask, lesson, instruction, status: 'proposed', version: 1,
        created_at: at, updated_at: at, validated_at: null, tests: [], instruction_history: [], history: [{ at, from: null, to: 'proposed', note: 'Lesson recorded' }]
      };
      d.lessons.push(l);
      return { lesson: l };
    });
  }));
  r.post('/lessons/:id/status', handle(req => {
    const b = body(req);
    const status = oneOf(b.status, LESSON, 'status', 'Lesson status');
    const note = text(b.note, 'note', { max: LIMITS.note, required: false, label: 'Note' });
    return store.mutate(req.dataset, d => {
      const l = findLesson(d, req.params.id);
      const check = lessonTransition(l, status);
      if (!check.ok) throw new ValidationError(check.reason, 'status');
      const at = now();
      l.history.push({ at, from: l.status, to: status, note: note || (status === 'validated' ? `${lessonEvidence(l).passes} trial tasks passed with evidence` : '') });
      l.status = status; l.updated_at = at;
      l.validated_at = status === 'validated' ? at : null;
      return { lesson: l };
    });
  }));
  r.post('/lessons/:id/tests', handle(req => {
    const b = body(req);
    const result = oneOf(b.result, TEST_RESULT, 'result', 'Result');
    const evidence = text(b.evidence, 'evidence', { max: LIMITS.evidence, min: 10, label: 'Evidence' });
    const evidenceUrl = httpUrl(b.evidence_url, 'evidence_url', { label: 'Evidence link' });
    const taskId = b.task ? idOf(b.task, 'task', 'task') : '';
    return store.mutate(req.dataset, d => {
      const l = findLesson(d, req.params.id);
      if (l.status !== 'testing') throw new ValidationError('Move the lesson to Testing before recording trial results.', 'result');
      if (taskId) findTask(d, taskId);
      if (l.tests.length >= LIMITS.tests) throw new ValidationError('The trial limit for this lesson has been reached.', 'result');
      const at = now();
      l.tests.push({ id: newId('test'), at, result, evidence, evidence_url: evidenceUrl, task: taskId, version: l.version || 1 });
      l.updated_at = at;
      return { lesson: l, evidence: lessonEvidence(l) };
    });
  }));
  // Instruction changes are tracked text changes, not model retraining. A new version needs new trials.
  r.post('/lessons/:id/instruction', handle(req => {
    const b = body(req);
    const instruction = text(b.instruction, 'instruction', { max: LIMITS.instruction, min: 5, label: 'Instruction' });
    const note = text(b.note, 'note', { max: LIMITS.note, required: false, label: 'Note' });
    return store.mutate(req.dataset, d => {
      const l = findLesson(d, req.params.id);
      if (l.instruction === instruction) throw new ValidationError('The instruction is unchanged.', 'instruction');
      const at = now();
      l.instruction_history.push({ at, from: l.instruction, to: instruction, note, version: (l.version || 1) + 1 });
      l.instruction = instruction; l.version = (l.version || 1) + 1; l.updated_at = at;
      if (l.status === 'validated') {
        l.history.push({ at, from: 'validated', to: 'testing', note: 'Instruction changed; earlier trials applied to the previous version' });
        l.status = 'testing'; l.validated_at = null;
      }
      return { lesson: l };
    });
  }));

  // ---- reports ----
  r.post('/reports', handle(req => {
    const q = range(body(req));
    return store.mutate(req.dataset, d => {
      if (d.reports.length >= LIMITS.reports) throw new ValidationError('The report history limit has been reached.', 'from');
      const snap = { id: newId('rep'), from: q.from, to: q.to, tz: q.tz, generated_at: now(), report: buildReport(d.tasks, d.lessons, q, d.bots) };
      d.reports.push(snap);
      return { snapshot: snap };
    });
  }));
  // Creates real tasks from current suggestions. A suggestion that already has an open task is skipped.
  r.post('/improvements', handle(req => {
    const b = body(req), q = range(b);
    if (!Array.isArray(b.keys) || !b.keys.length) throw new ValidationError('Choose at least one suggestion.', 'keys');
    if (b.keys.length > LIMITS.keys) throw new ValidationError(`Choose ${LIMITS.keys} suggestions or fewer.`, 'keys');
    const keys = [...new Set(b.keys.map(k => {
      if (typeof k !== 'string' || !SUGGESTION_KEY_RE.test(k)) throw new ValidationError('Unknown suggestion.', 'keys');
      return k;
    }))];
    return store.mutate(req.dataset, d => {
      const current = new Map(suggestions(tasksInRange(d.tasks, q.start, q.end), d.lessons, d.bots).map(s => [s.key, s]));
      const created = [], skipped = [];
      for (const key of keys) {
        const s = current.get(key);
        if (!s) throw new ValidationError('A selected suggestion no longer applies. Refresh the report.', 'keys');
        const dup = d.tasks.find(t => t.source_ref === key && t.execution !== 'cancelled' && t.execution !== 'completed');
        if (dup) { skipped.push({ key, task: dup.id, reason: 'open' }); continue; }
        const owner = d.bots.find(x => x.id === s.bot);
        if (!isActive(owner)) { skipped.push({ key, task: null, reason: 'archived' }); continue; }
        if (!isEnabled(owner)) { skipped.push({ key, task: null, reason: 'off' }); continue; }
        if (d.tasks.length >= LIMITS.tasks) throw new ValidationError('The task limit for this workspace has been reached.', 'keys');
        const at = now();
        d.seq += 1;
        const t = {
          id: newId('task'), number: d.seq, title: s.title.slice(0, LIMITS.title), bot: s.bot, project: 'Improvement', criteria: s.criteria.slice(0, LIMITS.criteria),
          output_url: '', source: 'improvement', source_ref: key, execution: 'queued', review: 'not_requested',
          created_at: at, updated_at: at, started_at: null, finished_at: null, events: [], reviews: []
        };
        addEvent(req, t, at, 'created', `Improvement task created from report ${q.from} to ${q.to}: ${s.reason}`);
        d.tasks.push(t);
        created.push(t.id);
      }
      return { created, skipped };
    });
  }));

  r.post('/demo/reset', handle(req => {
    if (req.dataset !== 'demo') throw new Refused('Only demo data can be reset.', 400);
    store.resetDemo();
    return {};
  }));

  r.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return r;
}
