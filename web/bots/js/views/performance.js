// Performance: quality numbers derived from recorded tasks in the chosen period. Never invented:
// rates show an em dash when nothing has been reviewed, and medians only use real start/finish times.
import { h, icon, portrait } from '../lib.js';
import { pageHead, statCard, empty, panel, select, filterByPreset, presetRange, RANGE_OPTIONS } from './common.js';

export function render(ctx) {
  const { M } = ctx, st = ctx.state, ui = ctx.ui.perf;
  const tasks = filterByPreset(M, st.tasks, ui.range);
  const p = M.performance(tasks);
  const rows = M.botComparison(tasks, st.bots); // active roster, plus archived bots with tasks in this period
  const issues = M.reviewIssues(tasks);
  const sugg = M.suggestions(tasks, st.lessons, st.bots).slice(0, 3);
  const range = presetRange(M, ui.range);
  const d = M.DASH;

  const createTask = s => async () => {
    try {
      const r = await ctx.api('/improvements', { method: 'POST', body: { from: range.from, to: range.to, tz: range.tz, keys: [s.key] } });
      await ctx.refresh();
      ctx.toast(r.created.length ? 'Improvement task created.' : r.skipped[0] && r.skipped[0].reason === 'archived' ? 'That bot is archived. Restore it to give it new work.' : 'An open task for this already exists, so none was added.');
    } catch (e) { ctx.toast(e.message, 'error'); }
  };

  return h('div', { class: 'page' },
    pageHead(ctx, { title: 'Performance', sub: 'Measure quality alongside completed work.', actions: [select({ label: 'Period', value: ui.range, iconName: 'calendar', options: RANGE_OPTIONS, fkey: 'perf-range', onchange: v => { ui.range = v; ctx.go('#/performance'); } })] }),
    h('section', { class: 'panel', 'aria-labelledby': 'perf-sample' },
      h('p', { class: 'sample', id: 'perf-sample' }, p.reviewed ? `Sample: ${p.reviewed} reviewed task${p.reviewed === 1 ? '' : 's'} of ${p.total} assigned in this period.` : `Sample: no reviewed tasks${p.total ? ` (${p.total} assigned in this period, none with a recorded review)` : ' in this period'}.`),
      h('div', { class: 'stats' },
        statCard({ label: 'Reviewed tasks', value: p.reviewed, iconName: 'file', tone: 'blue', sub: p.total - p.reviewed ? `${p.total - p.reviewed} not yet reviewed (excluded)` : '' }),
        statCard({ label: 'First-pass acceptance', value: M.fmtPercent(p.firstPassRate), iconName: 'checkCircle', tone: 'green', sub: p.reviewed ? `${p.firstPass} of ${p.reviewed} passed their first review` : 'No reviews recorded' }),
        statCard({ label: 'Rework required', value: p.reviewed ? p.rework : d, iconName: 'undo', tone: 'amber', sub: p.reworkRounds ? `${p.reworkRounds} change request${p.reworkRounds === 1 ? '' : 's'} in total` : '' }),
        statCard({ label: 'Median task time', value: M.fmtDuration(p.medianMs), iconName: 'clock', tone: 'indigo', sub: p.timed ? `From ${p.timed} completed task${p.timed === 1 ? '' : 's'} with a start and finish` : 'No completed tasks with a recorded start' }))),

    panel('Bot comparison', h('div', null,
      h('div', { class: 'table-wrap' }, h('table', { class: 'table compare' },
        h('thead', null, h('tr', null, ['Bot', 'Reviewed', 'Passed first time', 'First-pass rate', 'Rework', 'Median time'].map(x => h('th', { scope: 'col' }, x)))),
        h('tbody', null, rows.map(r => h('tr', null,
          h('th', { scope: 'row' }, h('span', { class: 'bot-cell' }, portrait(ctx.bot(r.bot), 28), r.name, r.archived ? h('span', { class: 'badge badge-grey' }, 'Archived') : null)),
          h('td', { class: 'num' }, String(r.reviewed)),
          h('td', { class: 'num' }, r.reviewed ? String(r.firstPass) : d),
          h('td', { class: 'num' }, M.fmtPercent(r.firstPassRate)),
          h('td', { class: 'num' }, r.reviewed ? String(r.rework) : d),
          h('td', { class: 'num' }, M.fmtDuration(r.medianMs))))))),
      h('p', { class: 'footnote' }, icon('info', 16), 'Compare similar tasks; task difficulty affects results. First-pass acceptance uses each task\'s first recorded review, not its final status.')), { id: 'perf-compare' }),

    h('div', { class: 'split-1-1' },
      panel('Recurring issues', issues.length ? h('ul', { class: 'issue-list' }, issues.map(i => h('li', null,
        h('button', { class: 'issue', type: 'button', onclick: () => { Object.assign(ctx.ui.tasks, { bot: '', status: '', range: ui.range, q: '' }); ctx.go(`#/tasks/${i.tasks[0]}`); } },
          h('span', { class: 'issue-icon' }, icon('alert', 20)),
          h('span', { class: 'grow' }, h('b', null, i.label), h('span', { class: 'muted small block' }, `${i.count} task${i.count === 1 ? '' : 's'} · ${ctx.botName(i.bot)}${i.recurring ? ' · recurring' : ''}`)),
          icon('chevronRight', 18)))))
        : empty('No change requests recorded in this period. Issues appear here from review notes.'), { id: 'perf-issues' }),
      panel('What to improve', sugg.length ? h('ul', { class: 'improve-list' }, sugg.map(s => h('li', { class: 'improve' },
        h('span', { class: 'improve-icon' }, icon(s.kind === 'issue' ? 'edit' : 'flask', 20)),
        h('div', { class: 'grow' }, h('b', null, s.title), h('p', { class: 'muted small' }, s.reason),
          range ? h('button', { class: 'btn btn-sm btn-primary', type: 'button', onclick: createTask(s) }, 'Create improvement task')
            : h('a', { class: 'btn btn-sm', href: '#/reports' }, 'Open in Reports')))))
        : empty('Nothing to suggest yet. Suggestions come from review notes and open lessons.'), { id: 'perf-improve' })));
}
