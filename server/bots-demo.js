// Demo fixture for the AI workspace. Built in memory relative to "now"; never written to the real bot store.
// It mirrors the design references so the screens can be reviewed with realistic examples.
import { buildReport, rangeBounds, localDate, weekOptions, botName as nameIn, seedBots, newConnection, EXEC } from '../shared/bots-model.js';

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export function buildDemo(nowMs = Date.now()) {
  let n = 0, seq = 0;
  const id = p => `${p}_demo${String(++n).padStart(6, '0')}`;
  const iso = ms => new Date(ms).toISOString();
  const ev = (at, kind, text, extra = {}) => ({ id: id('evt'), at: iso(at), kind, text, source: 'demo', ...extra });

  // Roster: the four starting bots, a fifth added later (it sits in a generated annex desk),
  // and an archived bot whose finished work stays in the history.
  const bots = seedBots(iso(nowMs - 30 * DAY));
  const extraBot = (botId, name, role, focus, style, capabilities, order, added, archived) => ({
    id: botId, name, role, focus, avatar: { style }, capabilities, connection: newConnection(), order, desk: order,
    created_at: iso(nowMs - added), updated_at: iso(nowMs - (archived || added)), archived_at: archived ? iso(nowMs - archived) : null,
    history: [{ at: iso(nowMs - added), kind: 'created', text: `Added as ${role}` }, ...(archived ? [{ at: iso(nowMs - archived), kind: 'archived', text: 'Archived: vendor research moved to Researcher' }] : [])]
  });
  bots.push(extraBot('bot_demodesign01', 'Designer', 'Designer', 'Visual design & UI polish', 'rose', ['UI design', 'Design review', 'Icons'], 4, 3 * DAY));
  bots.push(extraBot('bot_demoscout001', 'Scout', 'Scout', 'Vendor and tool scanning', 'teal', ['Vendor research', 'Pricing scans'], 5, 25 * DAY, 6 * DAY));
  const botName = botId => nameIn(bots, botId);

  /**
   * One task with a consistent timeline. `ago` is when it was assigned; `run` minutes of work;
   * `reviews` is a list of [outcome, note, issue] recorded after the work.
   */
  function task({ title, bot, project, criteria, ago, exec = 'completed', run = 10, wait = 4, reviews = [], pending = false, steps = [], blockedText }) {
    const created = nowMs - ago, started = created + wait * MIN;
    const t = {
      id: id('task'), number: ++seq, title, bot, project, criteria, output_url: '', source: 'demo', source_ref: '',
      execution: exec, review: 'not_requested', created_at: iso(created), updated_at: iso(created),
      started_at: null, finished_at: null, events: [ev(created, 'created', `Assigned to ${botName(bot)}`)], reviews: []
    };
    if (exec === 'queued') return t;
    t.started_at = iso(started);
    t.events.push(ev(started, 'execution', `Execution: Queued → In progress`, { from: 'queued', to: 'in_progress' }));
    let at = started;
    for (const s of steps) { at += 2 * MIN; t.events.push(ev(at, 'note', s)); }
    if (exec === 'blocked' || exec === 'waiting') {
      at += 3 * MIN;
      t.events.push(ev(at, 'execution', blockedText || `Execution: In progress → ${EXEC[exec]}`, { from: 'in_progress', to: exec }));
      t.updated_at = iso(at); if (pending) markPending(t, at + MIN); return t;
    }
    if (exec === 'in_progress') { t.updated_at = iso(at); if (pending) markPending(t, at + MIN); return t; }
    // completed: first finish after `run` minutes, then each review; a change request reopens the work
    let finish = started + run * MIN;
    t.events.push(ev(finish, 'execution', 'Execution: In progress → Completed', { from: 'in_progress', to: 'completed' }));
    reviews.forEach(([outcome, note, issue], i) => {
      const rAt = finish + (6 + i) * MIN;
      markPending(t, rAt - 2 * MIN);
      t.reviews.push({ id: id('rev'), at: iso(rAt), outcome, note: note || '', issue: issue || '' });
      t.events.push(ev(rAt, 'review', note ? `${outcome === 'passed' ? 'Passed review' : 'Changes requested'}: ${note}` : 'Passed review', { from: 'pending', to: outcome }));
      t.review = outcome;
      if (outcome === 'changes_requested' && i < reviews.length - 1) {
        const reopen = rAt + 2 * MIN;
        t.events.push(ev(reopen, 'execution', 'Execution: Completed → In progress', { from: 'completed', to: 'in_progress' }));
        finish = reopen + Math.max(3, Math.round(run / 3)) * MIN;
        t.events.push(ev(finish, 'execution', 'Execution: In progress → Completed', { from: 'in_progress', to: 'completed' }));
      }
      t.updated_at = iso(rAt);
    });
    t.finished_at = iso(finish);
    if (pending && !reviews.length) markPending(t, finish + MIN);
    if (!reviews.length && !pending) t.updated_at = iso(finish);
    return t;
  }
  function markPending(t, at) {
    t.review = 'pending'; t.updated_at = iso(at);
    t.events.push(ev(at, 'review', 'Review requested', { from: 'not_requested', to: 'pending' }));
  }

  const W = 'Website redesign', R = 'Market research', O = 'Operations';
  const tasks = [
    // archived bot's work: kept in history
    task({ title: 'Vendor scan', bot: 'bot_demoscout001', project: R, criteria: 'Compare three analytics vendors on price and data residency.', ago: 10 * DAY, run: 21, reviews: [['passed']] }),
    // previous week
    task({ title: 'Sprint plan', bot: 'chatgpt', project: O, criteria: 'Plan lists owners, dates and acceptance criteria for every item.', ago: 9 * DAY, run: 10, reviews: [['passed']] }),
    task({ title: 'Pricing page layout', bot: 'claude', project: W, criteria: 'Pricing cards render correctly at 390, 768 and 1440 px.', ago: 9 * DAY + 3 * HOUR, run: 25, reviews: [['changes_requested', 'Pricing cards stack incorrectly on tablet.', 'Mobile layout'], ['passed']] }),
    task({ title: 'Competitor summary', bot: 'researcher', project: R, criteria: 'Every claim links to a primary source.', ago: 8 * DAY, run: 15, reviews: [['changes_requested', 'Two claims had no source link.', 'Missing source'], ['passed']] }),
    task({ title: 'Accessibility audit', bot: 'reviewer', project: W, criteria: 'Audit covers contrast, focus order and labels on all forms.', ago: 8 * DAY + 5 * HOUR, run: 11, reviews: [['passed']] }),
    // this week
    task({ title: 'Market sizing notes', bot: 'researcher', project: R, criteria: 'Sizing shows method, sources and the range used.', ago: 5 * DAY, run: 15, reviews: [['passed']] }),
    task({ title: 'Launch checklist', bot: 'chatgpt', project: W, criteria: 'Checklist covers content, QA, analytics and rollback.', ago: 4 * DAY, run: 8, reviews: [['passed']] }),
    task({ title: 'Form validation review', bot: 'reviewer', project: W, criteria: 'Every contact form field has a tested error state.', ago: 4 * DAY + 2 * HOUR, run: 13, reviews: [['passed']] }),
    task({ title: 'Navigation badge', bot: 'claude', project: W, criteria: 'Badge shows the unread count and hides at zero.', ago: 3 * DAY, run: 4, reviews: [['passed']] }),
    task({ title: 'Homepage brief', bot: 'chatgpt', project: W, criteria: 'Brief states audience, goals, sections and success measures.', ago: 2 * DAY + 4 * HOUR, run: 6, reviews: [['passed']] }),
    task({ title: 'Contact form', bot: 'reviewer', project: W, criteria: 'Form submits, validates and confirms on all breakpoints.', ago: 2 * DAY, run: 9, reviews: [['passed']] }),
    task({ title: 'Responsive navigation', bot: 'claude', project: W, criteria: 'Navigation works at desktop, tablet and mobile widths without overlap.', ago: 26 * HOUR, run: 18, steps: ['Implementation saved: changes committed to branch', 'Preview tested: automated preview checks completed'], reviews: [['changes_requested', 'Tablet menu overlaps the logo.', 'Mobile layout']] }),
    task({ title: 'Source research', bot: 'researcher', project: R, criteria: 'Collect three primary sources on regional demand.', ago: 70 * MIN, exec: 'blocked', blockedText: 'Blocked: failed to access requested source (HTTP 403)' }),
    task({ title: 'Project brief approval', bot: 'chatgpt', project: W, criteria: 'Owner approves the brief or returns written changes.', ago: 40 * MIN, exec: 'waiting', blockedText: 'Waiting: requested approval for project brief' }),
    task({ title: 'Check contact form', bot: 'reviewer', project: W, criteria: 'Report every failing validation case with steps to reproduce.', ago: 30 * MIN, exec: 'in_progress', steps: ['Added 3 comments on form validation'] }),
    task({ title: 'Build responsive homepage', bot: 'claude', project: W, criteria: 'Homepage matches the brief at 390, 768 and 1440 px.', ago: 25 * MIN, exec: 'in_progress', steps: ['Updated navigation layout', 'Testing tablet breakpoint'], pending: true }),
    task({ title: 'Icon set for navigation', bot: 'bot_demodesign01', project: W, criteria: 'Six icons on a 24 px grid, matching stroke weight.', ago: 3 * HOUR, exec: 'queued' })
  ];
  const byTitle = t => tasks.find(x => x.title === t).id;
  // Trials link to distinct finished tasks: validation counts each task once, by its latest result.
  const trialPool = tasks.filter(t => t.execution === 'completed').map(t => t.id);

  function lesson({ title, bot, source, lesson: what, instruction, status, ago, passes = 0, fails = 0 }) {
    const at = nowMs - ago;
    const l = {
      id: id('lesson'), title, bot, source_task: source ? byTitle(source) : '', lesson: what, instruction, status, version: 1,
      created_at: iso(at), updated_at: iso(at), validated_at: null, tests: [], instruction_history: [],
      history: [{ at: iso(at), from: null, to: 'proposed', note: 'Lesson recorded' }]
    };
    if (status === 'proposed') return l;
    l.history.push({ at: iso(at + HOUR), from: 'proposed', to: 'testing', note: '' });
    for (let i = 0; i < passes + fails; i++) {
      // failures first, then passes on tasks 0..passes-1, so a failed task is later retried and passes
      const pass = i >= fails, task = trialPool[(pass ? i - fails : i) % trialPool.length];
      l.tests.push({ id: id('test'), at: iso(at + (2 + i) * HOUR), result: pass ? 'pass' : 'fail', version: 1, task, evidence_url: '',
        evidence: pass ? `Trial ${i + 1}: instruction followed on a similar task; reviewer passed it first time.` : `Trial ${i + 1}: instruction skipped under time pressure; reviewer returned it.` });
    }
    l.updated_at = iso(at + (2 + passes + fails) * HOUR);
    if (status === 'validated') {
      l.validated_at = l.updated_at;
      l.history.push({ at: l.updated_at, from: 'testing', to: 'validated', note: `${passes} trial tasks passed with evidence` });
    }
    return l;
  }
  const lessons = [
    lesson({ title: 'Use explicit acceptance criteria', bot: 'chatgpt', source: 'Sprint plan', lesson: 'Tasks without written criteria were reviewed against different expectations.', instruction: 'Write measurable acceptance criteria before assigning any task.', status: 'validated', ago: 12 * DAY, passes: 5 }),
    lesson({ title: 'Run form edge cases', bot: 'reviewer', source: 'Accessibility audit', lesson: 'Happy-path testing missed empty and long inputs.', instruction: 'Test empty, maximum-length and invalid inputs on every form field.', status: 'validated', ago: 11 * DAY, passes: 5, fails: 1 }),
    lesson({ title: 'Summarise decisions in brief', bot: 'chatgpt', source: 'Launch checklist', lesson: 'Decisions made in discussion were lost before build.', instruction: 'End every brief with a list of decisions and who made them.', status: 'validated', ago: 10 * DAY, passes: 6 }),
    lesson({ title: 'Verify source links', bot: 'researcher', source: 'Competitor summary', lesson: 'Claims without links could not be checked by the reviewer.', instruction: 'Link a primary source next to every factual claim.', status: 'proposed', ago: 7 * DAY }),
    lesson({ title: 'Confirm access before research', bot: 'researcher', source: 'Source research', lesson: 'Research stalled on a source that needed permissions.', instruction: 'Check access to each requested source first and report blockers within 10 minutes.', status: 'proposed', ago: 50 * MIN }),
    lesson({ title: 'Check tablet navigation', bot: 'claude', source: 'Responsive navigation', lesson: 'Desktop success does not confirm tablet layout.', instruction: 'Check desktop, tablet, and mobile previews before requesting review.', status: 'testing', ago: 20 * HOUR, passes: 2 })
  ];

  // One saved snapshot for last week, computed from the fixture itself (not invented numbers).
  const [, prev] = weekOptions(new Date(nowMs), 2);
  const tz = new Date(nowMs).getTimezoneOffset();
  const b = rangeBounds(prev.from, prev.to, tz);
  const reports = [{ id: id('rep'), from: prev.from, to: prev.to, tz, generated_at: iso(nowMs - DAY), report: buildReport(tasks, lessons, { from: prev.from, to: prev.to, ...b }, bots) }];

  return { schema: 2, created_at: iso(nowMs), seq, bots, tasks, lessons, reports, demo_built_on: localDate(new Date(nowMs)) };
}
