// Task history: filters, table, and the selected task's details, timeline and manual updates.
// Execution and review are updated separately; each update is stamped with the time the owner made it.
import { h, icon, pill, portrait, extLink, clear, formDialog, download } from '../lib.js';
import { pageHead, statCard, empty, select, filterByPreset, RANGE_OPTIONS, manualNote } from './common.js';
import { eventTone } from './hq.js';

const sorts = M => ({
  title: t => t.title.toLowerCase(), bot: t => t.bot, execution: t => t.execution, review: t => t.review,
  duration: t => { const d = M.durationMs(t); return d === null ? -1 : d; }, created: t => Date.parse(t.created_at) || 0
});

export function render(ctx, param) {
  const { M } = ctx, st = ctx.state, ui = ctx.ui.tasks, SORTS = sorts(M);
  const sel = param ? st.tasks.find(t => t.id === param) || null : null;

  const filtered = () => {
    let list = filterByPreset(M, st.tasks, ui.range);
    if (ui.bot) list = list.filter(t => t.bot === ui.bot);
    if (ui.status) { const [kind, val] = ui.status.split(':'); list = list.filter(t => (kind === 'exec' ? t.execution : t.review) === val); }
    const q = ui.q.trim().toLowerCase();
    if (q) list = list.filter(t => [t.title, t.project, M.taskKey(t), ctx.botName(t.bot), t.criteria].some(x => String(x).toLowerCase().includes(q)));
    const key = SORTS[ui.sort] || SORTS.created, dir = ui.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || (Date.parse(b.created_at) - Date.parse(a.created_at)); });
  };

  const results = h('div', { class: 'results' });
  function draw() {
    const list = filtered();
    clear(results);
    results.append(
      h('div', { class: 'stats' },
        statCard({ label: 'Tasks', value: list.length, iconName: 'file', tone: 'blue' }),
        statCard({ label: 'Passed review', value: list.filter(t => t.review === 'passed').length, iconName: 'checkCircle', tone: 'green' }),
        statCard({ label: 'Needs changes', value: list.filter(t => t.review === 'changes_requested').length, iconName: 'warning', tone: 'amber' }),
        statCard({ label: 'Blocked', value: list.filter(t => t.execution === 'blocked').length, iconName: 'blocked', tone: 'red' })),
      h('p', { class: 'sr-only', role: 'status' }, `${list.length} task${list.length === 1 ? '' : 's'} shown`),
      list.length ? table(ctx, list, sel, draw) : h('div', { class: 'panel' }, empty(st.tasks.length ? 'No tasks match these filters.' : 'No tasks yet. Assign the first one to start a history.',
        st.tasks.length ? h('button', { class: 'btn', type: 'button', onclick: () => { Object.assign(ui, { bot: '', status: '', range: 'all', q: '' }); ctx.go(location.hash || '#/tasks'); } }, 'Clear filters')
          : h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.assignTask() }, icon('plus', 18), 'Assign task'))));
  }

  const statusOptions = [['', 'All statuses'], ['Execution', Object.entries(M.EXEC).map(([k, l]) => ['exec:' + k, l])], ['Review', Object.entries(M.REVIEW).map(([k, l]) => ['review:' + k, l])]];
  const searchId = 'task-search';
  const filters = h('div', { class: 'filters', role: 'search', 'aria-label': 'Filter tasks' },
    select({ label: 'Bot', value: ui.bot, iconName: 'bot', options: botOptions(ctx), onchange: v => { ui.bot = v; draw(); } }),
    select({ label: 'Status', value: ui.status, iconName: 'clock', options: statusOptions, onchange: v => { ui.status = v; draw(); } }),
    select({ label: 'Date assigned', value: ui.range, iconName: 'calendar', options: RANGE_OPTIONS, onchange: v => { ui.range = v; draw(); } }),
    h('div', { class: 'search-field' }, h('label', { for: searchId, class: 'sr-only' }, 'Search tasks'), icon('search', 18),
      h('input', { id: searchId, type: 'search', placeholder: 'Search tasks…', value: ui.q, oninput: e => { ui.q = e.target.value; draw(); } })));

  draw();
  const exportBtn = h('button', { class: 'btn', type: 'button', onclick: () => {
    const list = filtered();
    download(`team-bot-tasks-${M.localDate(new Date())}.json`, JSON.stringify({ dataset: ctx.demo ? 'demo' : 'real', exported_at: new Date().toISOString(), filters: { bot: ui.bot, status: ui.status, range: ui.range, q: ui.q }, tasks: list }, null, 2), 'application/json');
    ctx.toast(`Exported ${list.length} task${list.length === 1 ? '' : 's'}.`);
  } }, icon('download', 18), 'Export');

  // stacked layout: bring a newly selected task's details into view
  if (sel && ui.lastSel !== sel.id && matchMedia('(max-width: 1280px)').matches) requestAnimationFrame(() => { const d = document.querySelector('.task-detail'); if (d) d.scrollIntoView({ block: 'start' }); });
  ui.lastSel = sel ? sel.id : null;

  return h('div', { class: 'page' },
    pageHead(ctx, { title: 'Task history', sub: 'Trace every task from assignment to review.', actions: [exportBtn, h('button', { class: 'btn btn-primary', type: 'button', onclick: () => ctx.assignTask() }, icon('plus', 18), 'Assign task')] }),
    filters,
    h('div', { class: 'tasks-layout' + (sel ? ' with-detail' : '') }, results, sel ? detail(ctx, sel) : null),
    h('p', { class: 'footnote' }, icon('info', 16), manualNote(ctx), ' Dates filter by when a task was assigned.'));
}

/** Bot filter: the active roster, then archived bots in their own group (their tasks are kept). */
export function botOptions(ctx, allLabel = 'All bots') {
  const opts = [['', allLabel], ...ctx.activeBots().map(b => [b.id, b.name])];
  const archived = ctx.archivedBots();
  if (archived.length) opts.push(['Archived', archived.map(b => [b.id, `${b.name} (archived)`])]);
  return opts;
}

function table(ctx, list, sel, redraw) {
  const { M } = ctx, ui = ctx.ui.tasks;
  const th = (key, label) => {
    const active = ui.sort === key;
    return h('th', { scope: 'col', 'aria-sort': active ? (ui.dir === 'asc' ? 'ascending' : 'descending') : 'none' },
      h('button', { class: 'sort-btn' + (active ? ' active' : ''), type: 'button', dataset: { fkey: 'sort-' + key }, onclick: () => { if (active) ui.dir = ui.dir === 'asc' ? 'desc' : 'asc'; else { ui.sort = key; ui.dir = key === 'title' || key === 'bot' ? 'asc' : 'desc'; } redraw(); const b = document.querySelector(`[data-fkey="sort-${key}"]`); if (b) b.focus(); } },
        label, icon('sort', 14)));
  };
  return h('div', { class: 'panel table-panel' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('caption', { class: 'sr-only' }, 'Tasks. Select a task to see its timeline and update it.'),
    h('thead', null, h('tr', null, th('title', 'Task'), th('bot', 'Bot'), th('execution', 'Execution'), th('review', 'Review'), th('duration', 'Duration'), th('created', 'Assigned'))),
    h('tbody', null, list.map(t => {
      const b = ctx.bot(t.bot), on = sel && sel.id === t.id;
      return h('tr', { class: on ? 'selected' : '', onclick: e => { if (e.target.closest('a,button')) return; ctx.go(`#/tasks/${t.id}`); } },
        h('td', null, h('a', { class: 'row-link', href: `#/tasks/${t.id}`, 'aria-current': on ? 'true' : null, dataset: { fkey: 'row-' + t.id } }, t.title), h('span', { class: 'muted small block' }, M.taskKey(t))),
        h('td', null, h('span', { class: 'bot-cell' }, portrait(b, 26), ctx.botName(t.bot))),
        h('td', null, pill(t.execution, M.EXEC[t.execution])),
        h('td', null, pill(t.review, M.REVIEW[t.review])),
        h('td', { class: 'num' }, M.fmtDuration(M.durationMs(t))),
        h('td', { class: 'nowrap muted' }, M.fmtDate(t.created_at)));
    })))));
}

function detail(ctx, t) {
  const { M } = ctx, b = ctx.bot(t.bot);
  const post = async (path, body, msg) => {
    try { await ctx.api(`/tasks/${t.id}/${path}`, { method: 'POST', body }); await ctx.refresh(); ctx.toast(msg); }
    catch (e) { ctx.toast(e.message, 'error'); }
  };
  const execSelect = h('select', { id: 'exec-select', class: 'select-input plain' }, Object.entries(M.EXEC).map(([k, l]) => h('option', { value: k }, l)));
  execSelect.disabled = t.run?.status === 'running';
  execSelect.value = t.execution;
  const saveExec = h('button', { class: 'btn btn-sm', type: 'button', disabled: t.run?.status === 'running', dataset: { fkey: 'save-exec' }, onclick: () => {
    if (execSelect.value === t.execution) { ctx.toast(`Execution is already ${M.EXEC[t.execution]}.`, 'error'); return; }
    post('execution', { status: execSelect.value }, `Execution recorded: ${M.EXEC[execSelect.value]}.`);
  } }, 'Save');

  const reviewDialog = status => formDialog({
    title: status === 'passed' ? 'Record review: passed' : 'Record review: changes requested',
    description: `${t.title} · ${M.taskKey(t)}. This records a review outcome only; the execution status is not changed.`,
    fields: status === 'passed'
      ? [{ name: 'note', label: 'Review note', type: 'textarea', maxlength: M.LIMITS.note }]
      : [{ name: 'note', label: 'What needs to change', type: 'textarea', required: true, maxlength: M.LIMITS.note, placeholder: 'Tablet menu overlaps the logo.' },
        { name: 'issue', label: 'Issue label', maxlength: M.LIMITS.issue, placeholder: 'Mobile layout', hint: 'A short, reusable name. Issues with the same label are grouped in Performance and Reports.' }],
    submitLabel: 'Record review',
    onSubmit: async v => { await ctx.api(`/tasks/${t.id}/review`, { method: 'POST', body: { status, ...v } }); await ctx.refresh(); ctx.toast('Review recorded.'); }
  });
  const outputDialog = () => formDialog({
    title: t.output_url ? 'Change output link' : 'Add output link',
    description: 'Save a real link to the work, such as a pull request or a deployed preview. Only http:// and https:// links are accepted.',
    fields: [{ name: 'url', label: 'Output link', type: 'url', required: true, maxlength: M.LIMITS.url, value: t.output_url || '', placeholder: 'https://' }],
    submitLabel: 'Save link',
    onSubmit: async v => { await ctx.api(`/tasks/${t.id}/output`, { method: 'POST', body: v }); await ctx.refresh(); ctx.toast('Output link saved.'); }
  });
  const noteDialog = () => formDialog({
    title: 'Add a note to the timeline', fields: [{ name: 'text', label: 'Note', type: 'textarea', required: true, maxlength: M.LIMITS.note }], submitLabel: 'Add note',
    onSubmit: async v => { await ctx.api(`/tasks/${t.id}/note`, { method: 'POST', body: v }); await ctx.refresh(); ctx.toast('Note added.'); }
  });

  const out = extLink(t.output_url, 'Open output', 'link-btn');
  const reviews = M.reviewsOf(t);
  const events = [...t.events].sort((a, b2) => Date.parse(a.at) - Date.parse(b2.at));
  const dur = M.durationMs(t);
  const srcLabel = t.source === 'demo' ? 'Demo fixture' : t.source === 'improvement' ? 'Improvement task (from a report)' : 'Manual record';

  return h('aside', { class: 'panel task-detail', 'aria-labelledby': 'td-title' },
    h('div', { class: 'td-head' },
      h('div', { class: 'grow' }, h('h2', { id: 'td-title' }, t.title), h('p', { class: 'muted small' }, `ID: ${M.taskKey(t)}`)),
      pill(t.review, M.REVIEW[t.review]),
      h('a', { class: 'icon-btn', href: '#/tasks', 'aria-label': 'Close task details' }, icon('close', 18))),
    h('dl', { class: 'meta' },
      h('div', null, h('dt', null, 'Bot'), h('dd', null, h('span', { class: 'bot-cell' }, portrait(b, 22), ctx.botName(t.bot)))),
      h('div', null, h('dt', null, 'Project'), h('dd', null, t.project)),
      h('div', null, h('dt', null, 'Assigned'), h('dd', null, M.fmtDate(t.created_at, true))),
      h('div', null, h('dt', null, 'Duration'), h('dd', null, M.fmtDuration(dur), dur === null && t.execution === 'completed' ? h('span', { class: 'muted small block' }, 'No recorded start') : null)),
      h('div', null, h('dt', null, 'Source'), h('dd', null, srcLabel))),
    h('h3', { class: 'sub-h' }, 'Acceptance criteria'),
    h('p', { class: 'criteria' }, t.criteria),

    h('section', { class: 'updates', 'aria-labelledby': 'td-upd' },
      h('h3', { class: 'sub-h', id: 'td-upd' }, 'Record an update'),
      h('div', { class: 'upd-row' },
        h('label', { for: 'exec-select', class: 'upd-label' }, 'Execution'),
        h('div', { class: 'upd-ctrl' }, pill(t.execution, M.EXEC[t.execution]), h('span', { class: 'select plain-wrap' }, execSelect, icon('chevronDown', 14, 'select-chevron')), saveExec)),
      h('div', { class: 'upd-row' },
        h('span', { class: 'upd-label' }, 'Review'),
        h('div', { class: 'upd-ctrl wrap' }, pill(t.review, M.REVIEW[t.review]),
          t.review !== 'pending' ? h('button', { class: 'btn btn-sm', type: 'button', dataset: { fkey: 'rev-pending' }, onclick: () => post('review', { status: 'pending' }, 'Review requested.') }, 'Request review') : null,
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => reviewDialog('passed') }, icon('check', 16), 'Passed'),
          h('button', { class: 'btn btn-sm', type: 'button', onclick: () => reviewDialog('changes_requested') }, icon('undo', 16), 'Changes'))),
      h('p', { class: 'muted small' }, 'Execution and review are recorded separately. Run with AI sends this task, selected shared notes and enabled skills to the configured runtime.')),

    ctx.state.runtime.adapter && !ctx.demo ? h('section', { class: 'runtime-section' },
      h('h3', { class: 'sub-h' }, `AI runtime · ${ctx.state.runtime.provider || 'My connection'}`),
      ctx.state.runtime.personal && !ctx.state.runtime.connected ? h('p', null, h('a', { href: '/bots/team.html' }, 'Connect and verify my AI account')) : null,
      h('button', { class: 'btn btn-primary', disabled: !M.isEnabled(b) || (ctx.state.runtime.personal && !ctx.state.runtime.connected) || ctx.state.runtime.busy || ['completed', 'cancelled', 'in_progress'].includes(t.execution), onclick: () => post('run', {}, `${ctx.state.runtime.provider} started. The draft will appear here.`) }, t.run?.status === 'running' ? `${t.run.provider} is working…` : `Run with ${ctx.state.runtime.provider || 'my AI account'}`),
      h('p', { class: 'muted small' }, 'Text draft only. Notes refresh at task start; imported skill versions stay pinned until reviewed again.'),
      t.run?.error ? h('p', { class: 'form-error', role: 'alert' }, t.run.error) : null,
      t.run?.output ? h('pre', { class: 'runtime-output' }, t.run.output) : null,
      t.run ? h('div', { class: 'muted small' },
        h('p', null, `Run ${t.run.id} · ${t.run.status} · ${t.run.provider}`),
        h('p', null, `Skills used: ${t.run.skills.map(s => `${s.name} v${s.version}${s.source?.revision ? ` (source ${s.source.revision.slice(0, 12)})` : ''}`).join(', ') || 'None'}`),
        h('ul', { class: 'bullets' }, t.run.sources.map(s => h('li', null, extLink(s.url, `${s.path} @ ${s.commit.slice(0, 8)}`))))) : null) : null,

    h('div', { class: 'output-row' }, h('span', { class: 'sub-h inline' }, 'Output'),
      out || h('span', { class: 'muted' }, 'No output link saved'),
      h('button', { class: 'link-btn', type: 'button', onclick: outputDialog }, t.output_url ? 'Change' : 'Add link'),
      t.output_url ? h('button', { class: 'link-btn danger', type: 'button', onclick: () => post('output', { url: '' }, 'Output link removed.') }, 'Remove') : null),

    reviews.length ? h('div', null, h('h3', { class: 'sub-h' }, 'Review notes'),
      h('ul', { class: 'review-notes' }, reviews.map((r, i) => h('li', { class: `rn rn-${r.outcome}` },
        h('p', null, h('b', null, `${i === 0 ? 'First review' : `Review ${i + 1}`}: ${M.REVIEW[r.outcome]}`), r.issue ? h('span', { class: 'badge' }, r.issue) : null, h('span', { class: 'muted small' }, ' · ' + M.fmtDate(r.at, true))),
        r.note ? h('p', null, r.note) : null)))) : null,

    h('div', { class: 'row between' }, h('h3', { class: 'sub-h' }, 'Timeline'), h('button', { class: 'link-btn', type: 'button', onclick: noteDialog }, icon('plus', 16), 'Add note')),
    events.length ? h('ol', { class: 'timeline' }, events.map((e, i) => h('li', { class: `tl tl-${eventTone(e)}` },
      h('span', { class: 'tl-n', 'aria-hidden': 'true' }, String(i + 1)),
      h('div', null, h('p', { class: 'tl-text' }, e.text), h('p', { class: 'muted small' }, M.fmtDate(e.at, true), ' · ', e.source === 'manual' ? 'Manual' : e.source === 'demo' ? 'Demo' : e.source)))))
      : empty('No events.'));
}
