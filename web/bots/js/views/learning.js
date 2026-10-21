// Learning history: lessons, their proposed instruction, trial results and status.
// Validated needs recorded evidence. Instruction changes are tracked text, not model retraining.
import { h, icon, pill, portrait, extLink, formDialog } from '../lib.js';
import { pageHead, statCard, empty, select } from './common.js';

export function render(ctx, param) {
  const { M } = ctx, st = ctx.state, ui = ctx.ui.learning;
  const lessons = [...st.lessons].sort((a, b) => (Date.parse(b.created_at) - Date.parse(a.created_at)) * (ui.sort === 'oldest' ? -1 : 1));
  const sel = lessons.find(l => l.id === param) || (param ? null : lessons[0]) || null;
  const n = s => st.lessons.filter(l => l.status === s).length;
  const taskById = id => st.tasks.find(t => t.id === id) || null;

  const record = () => formDialog({
    title: 'Record a lesson',
    description: 'Capture what was learned and the instruction change you propose. It starts as Proposed.',
    fields: [
      { name: 'title', label: 'Title', required: true, maxlength: M.LIMITS.title, placeholder: 'Check tablet navigation' },
      { name: 'bot', label: 'Bot', type: 'select', required: true, options: ctx.availableBots().map(b => [b.id, b.name]) },
      { name: 'source_task', label: 'Source task', type: 'select', options: [['', 'None'], ...[...st.tasks].reverse().map(t => [t.id, `${M.taskKey(t)} · ${t.title}`])] },
      { name: 'lesson', label: 'Lesson', type: 'textarea', required: true, maxlength: M.LIMITS.lesson, placeholder: 'Desktop success does not confirm tablet layout.' },
      { name: 'instruction', label: 'Proposed instruction', type: 'textarea', required: true, maxlength: M.LIMITS.instruction, placeholder: 'Check desktop, tablet and mobile previews before requesting review.' }
    ],
    submitLabel: 'Record lesson',
    note: 'This records an instruction for you to apply. It does not retrain any model and nothing is sent to a bot.',
    onSubmit: async v => { const r = await ctx.api('/lessons', { method: 'POST', body: v }); await ctx.refresh(); ctx.go(`#/learning/${r.lesson.id}`); ctx.toast('Lesson recorded.'); }
  });

  const list = h('section', { class: 'panel log', 'aria-labelledby': 'log-h' },
    h('div', { class: 'panel-head' }, h('h2', { id: 'log-h' }, 'Improvement log'),
      select({ label: 'Sort lessons', value: ui.sort, options: [['newest', 'Newest first'], ['oldest', 'Oldest first']], fkey: 'lsort', onchange: v => { ui.sort = v; ctx.go(location.hash); } })),
    lessons.length ? h('ul', { class: 'log-list' }, lessons.map(l => {
      const src = taskById(l.source_task), on = sel && sel.id === l.id;
      return h('li', null, h('a', { class: 'log-item' + (on ? ' on' : ''), href: `#/learning/${l.id}`, 'aria-current': on ? 'true' : null, dataset: { fkey: 'lesson-' + l.id } },
        h('span', { class: 'row between' }, h('b', null, l.title), h('span', { class: 'muted small nowrap' }, M.fmtDate(l.created_at))),
        h('span', { class: 'row gap-sm' }, icon('bot', 16), h('span', { class: 'muted' }, ctx.botName(l.bot)), pill(l.status, M.LESSON[l.status], 'pill-xs')),
        src ? h('span', { class: 'muted small' }, `From ${M.taskKey(src)}: ${src.title}`) : null));
    })) : empty('No lessons recorded yet. Record one after a review teaches you something.', h('button', { class: 'btn btn-primary', type: 'button', onclick: record }, icon('plus', 18), 'Record lesson')));

  return h('div', { class: 'page' },
    pageHead(ctx, { title: 'Learning history', sub: 'Track lessons, instruction updates, and their results.', sub2: 'Saved knowledge and workflow improvements.', actions: [h('button', { class: 'btn btn-primary', type: 'button', dataset: { fkey: 'record-lesson' }, onclick: record }, icon('bulb', 18), 'Record lesson')] }),
    h('div', { class: 'stats' },
      statCard({ label: 'Lessons captured', value: st.lessons.length, iconName: 'book', tone: 'blue' }),
      statCard({ label: 'Proposed updates', value: n('proposed'), iconName: 'file', tone: 'amber' }),
      statCard({ label: 'Testing', value: n('testing'), iconName: 'flask', tone: 'indigo' }),
      statCard({ label: 'Validated', value: n('validated'), iconName: 'check', tone: 'green' })),
    h('div', { class: 'learning-layout' }, list, sel ? detail(ctx, sel, taskById) : h('section', { class: 'panel' }, empty(param ? 'That lesson was not found.' : 'Select a lesson to see its details.'))));
}

function detail(ctx, l, taskById) {
  const { M } = ctx, b = ctx.bot(l.bot), ev = M.lessonEvidence(l), src = taskById(l.source_task);
  const tests = [...l.tests].sort((a, b2) => Date.parse(b2.at) - Date.parse(a.at));
  const setStatus = (to, note) => async () => {
    try { await ctx.api(`/lessons/${l.id}/status`, { method: 'POST', body: { status: to, note: note || '' } }); await ctx.refresh(); ctx.toast(`Lesson moved to ${M.LESSON[to]}.`); }
    catch (e) { ctx.toast(e.message, 'error'); }
  };
  const recordTest = () => formDialog({
    title: 'Record trial result',
    description: `${l.title}: did following the instruction work on a similar task?`,
    fields: [
      { name: 'result', label: 'Result', type: 'radio', options: [['pass', 'Pass'], ['fail', 'Fail']] },
      { name: 'task', label: 'Trial task', type: 'select', options: [['', 'Not linked (note only)'], ...[...ctx.state.tasks].reverse().map(t => [t.id, `${M.taskKey(t)} · ${t.title}`])], value: ctx.state.tasks.length ? ctx.state.tasks[ctx.state.tasks.length - 1].id : '',
        hint: `Validation needs ${M.VALIDATION_MIN_PASSES} different tasks. Each task counts once, by its latest result. Unlinked trials are kept as notes and do not count.` },
      { name: 'evidence', label: 'Evidence', type: 'textarea', required: true, maxlength: M.LIMITS.evidence, placeholder: 'Checked previews at 390, 768 and 1440 px; reviewer passed it first time.', hint: 'What you observed. At least 10 characters.' },
      { name: 'evidence_url', label: 'Evidence link', type: 'url', maxlength: M.LIMITS.url, placeholder: 'https://' }
    ],
    submitLabel: 'Record result',
    onSubmit: async v => { await ctx.api(`/lessons/${l.id}/tests`, { method: 'POST', body: v }); await ctx.refresh(); ctx.toast('Trial result recorded.'); }
  });
  const changeInstruction = () => formDialog({
    title: 'Change instruction',
    description: 'The change is kept in the lesson history. A new version needs its own trials; a validated lesson returns to Testing.',
    fields: [
      { name: 'instruction', label: 'Instruction', type: 'textarea', required: true, maxlength: M.LIMITS.instruction, value: l.instruction },
      { name: 'note', label: 'Why it changed', type: 'textarea', maxlength: M.LIMITS.note }
    ],
    submitLabel: 'Save change',
    note: 'Tracked text only: this is not model retraining.',
    onSubmit: async v => { await ctx.api(`/lessons/${l.id}/instruction`, { method: 'POST', body: v }); await ctx.refresh(); ctx.toast('Instruction change recorded.'); }
  });

  const validate = M.lessonTransition(l, 'validated');
  const reasonId = 'val-reason';
  const actions = [];
  if (l.status === 'proposed') actions.push(h('button', { class: 'btn btn-primary', type: 'button', dataset: { fkey: 'to-testing' }, onclick: setStatus('testing') }, icon('flask', 18), 'Start testing'));
  if (l.status === 'testing') {
    actions.push(h('button', { class: 'btn', type: 'button', onclick: setStatus('proposed') }, 'Back to proposed'));
    actions.push(h('button', { class: 'btn', type: 'button', disabled: !validate.ok, 'aria-describedby': validate.ok ? null : reasonId, dataset: { fkey: 'to-validated' }, onclick: setStatus('validated') }, icon('check', 18), 'Mark validated'));
    actions.push(h('button', { class: 'btn btn-primary', type: 'button', dataset: { fkey: 'record-test' }, onclick: recordTest }, 'Record test result'));
  }
  if (l.status === 'validated') actions.push(h('button', { class: 'btn', type: 'button', onclick: setStatus('testing', 'Re-opened for more testing') }, 'Return to testing'));

  const pct = Math.min(100, Math.round(ev.passes / M.VALIDATION_MIN_PASSES * 100));
  return h('section', { class: 'panel lesson-detail', 'aria-labelledby': 'ld-title' },
    h('div', { class: 'row between top' }, h('h2', { id: 'ld-title' }, l.title), h('span', { class: 'muted small nowrap' }, M.fmtDate(l.created_at))),
    h('div', { class: 'row gap wrap meta-line' },
      h('span', { class: 'bot-cell' }, portrait(b, 22), ctx.botName(l.bot)), pill(l.status, M.LESSON[l.status]),
      src ? h('a', { class: 'row gap-sm', href: `#/tasks/${src.id}` }, icon('file', 16), `From ${M.taskKey(src)} review`) : h('span', { class: 'muted' }, 'No source task')),
    h('div', { class: 'card-block' }, h('h3', null, icon('book', 18), 'Lesson'), h('p', null, l.lesson)),
    h('div', { class: 'card-block' }, h('h3', null, icon('file', 18), 'Proposed instruction', h('span', { class: 'badge' }, `v${l.version || 1}`)), h('p', null, l.instruction),
      h('button', { class: 'link-btn', type: 'button', onclick: changeInstruction }, icon('edit', 16), 'Change instruction')),
    h('div', { class: 'card-block' }, h('h3', null, icon('chart', 18), 'Validation'),
      h('p', null, `Trial tasks passing: ${ev.passes} of ${M.VALIDATION_MIN_PASSES} on v${l.version || 1}${ev.fails ? ` · ${ev.fails} currently failing` : ''}. `, ev.needed ? 'More evidence needed.' : ev.canValidate ? 'Enough evidence to validate.' : 'Latest linked trial failed.'),
      h('p', { class: 'muted small' }, `Each trial task counts once, by its latest result: a task that passed and later failed counts as failing.${ev.unlinked ? ` ${ev.unlinked} unlinked trial${ev.unlinked === 1 ? ' is' : 's are'} kept as notes and not counted.` : ''}`),
      h('div', { class: 'progress', role: 'progressbar', 'aria-label': 'Trial tasks whose latest result is a pass', 'aria-valuemin': '0', 'aria-valuemax': String(M.VALIDATION_MIN_PASSES), 'aria-valuenow': String(Math.min(ev.passes, M.VALIDATION_MIN_PASSES)) }, h('span', { style: { width: pct + '%' } })),
      l.status === 'testing' && !validate.ok ? h('p', { class: 'muted small', id: reasonId }, validate.reason) : null,
      l.status === 'proposed' ? h('p', { class: 'muted small' }, 'Start testing to record trial results.') : null,
      tests.length ? h('ul', { class: 'tests' }, tests.map(x => h('li', null,
        pill(x.result, M.TEST_RESULT[x.result], 'pill-xs'),
        h('div', { class: 'grow' }, h('p', null, x.evidence),
          h('p', { class: 'muted small' }, M.fmtDate(x.at, true), ` · v${x.version || 1}`, x.task && taskById(x.task) ? ` · ${M.taskKey(taskById(x.task))}` : '', ' '),
          extLink(x.evidence_url, 'Evidence link', 'link-btn small'))))) : null),
    l.instruction_history.length ? h('details', { class: 'card-block' }, h('summary', null, `Instruction changes (${l.instruction_history.length})`),
      h('ol', { class: 'changes' }, l.instruction_history.map(c => h('li', null,
        h('p', { class: 'muted small' }, `${M.fmtDate(c.at, true)} · v${c.version - 1} → v${c.version}`),
        h('p', null, h('del', null, c.from)), h('p', null, h('ins', null, c.to)), c.note ? h('p', { class: 'muted small' }, c.note) : null)))) : null,
    h('details', { class: 'card-block' }, h('summary', null, `Status history (${l.history.length})`),
      h('ol', { class: 'changes' }, l.history.map(x => h('li', null, h('p', null, `${x.from ? M.LESSON[x.from] + ' → ' : ''}${M.LESSON[x.to]}`, h('span', { class: 'muted small' }, ` · ${M.fmtDate(x.at, true)}`)), x.note ? h('p', { class: 'muted small' }, x.note) : null)))),
    h('div', { class: 'detail-actions' }, actions));
}
