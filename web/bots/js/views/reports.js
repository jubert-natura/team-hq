// Reports: a weekly report derived from recorded tasks, saved snapshots as history, exports,
// and improvement tasks created from suggestions (an open task for the same suggestion is never duplicated).
import { h, icon, pill, download } from '../lib.js';
import { pageHead, empty, select } from './common.js';

export function render(ctx) {
  const { M } = ctx, st = ctx.state, ui = ctx.ui.reports;
  const weeks = M.weekOptions(new Date(), 12);
  const w = weeks[ui.week] || weeks[0];
  const tz = new Date().getTimezoneOffset();
  const snap = ui.snapshot ? st.reports.find(r => r.id === ui.snapshot) || null : null;
  const live = !snap;
  const report = snap ? snap.report : M.buildReport(st.tasks, st.lessons, { from: w.from, to: w.to, ...M.rangeBounds(w.from, w.to, tz) }, st.bots);
  const t = report.totals;
  const history = [...st.reports].sort((a, b) => Date.parse(b.generated_at) - Date.parse(a.generated_at));
  for (const k of [...ui.checked]) if (!report.next_steps.some(s => s.key === k)) ui.checked.delete(k);

  const fileBase = `team-bot-report-${report.from}-to-${report.to}${ctx.demo ? '-demo' : ''}`;
  const exportJson = () => download(fileBase + '.json', JSON.stringify({ dataset: ctx.demo ? 'demo' : 'real', kind: snap ? 'snapshot' : 'live', generated_at: snap ? snap.generated_at : new Date().toISOString(), report }, null, 2), 'application/json');
  const exportMd = () => download(fileBase + '.md', M.reportMarkdown(report, { generatedAt: snap ? snap.generated_at : new Date().toISOString(), demo: ctx.demo }), 'text/markdown');

  const save = async () => {
    try { const r = await ctx.api('/reports', { method: 'POST', body: { from: w.from, to: w.to, tz } }); await ctx.refresh(); ctx.toast(`Snapshot saved for ${M.rangeLabel(r.snapshot.from, r.snapshot.to)}.`); }
    catch (e) { ctx.toast(e.message, 'error'); }
  };
  const createTasks = async () => {
    const keys = [...ui.checked];
    if (!keys.length) return;
    try {
      const r = await ctx.api('/improvements', { method: 'POST', body: { from: w.from, to: w.to, tz, keys } });
      ui.checked.clear();
      await ctx.refresh();
      const parts = [];
      if (r.created.length) parts.push(`Created ${r.created.length} task${r.created.length === 1 ? '' : 's'}`);
      const open = r.skipped.filter(x => x.reason === 'open').length, gone = r.skipped.filter(x => x.reason === 'archived').length;
      if (open) parts.push(`skipped ${open} that already ${open === 1 ? 'has an open task' : 'have open tasks'}`);
      if (gone) parts.push(`skipped ${gone} for archived bot${gone === 1 ? '' : 's'}`);
      if (!parts.length) parts.push('Nothing created');
      ctx.toast(parts.join('; ') + '.');
    } catch (e) { ctx.toast(e.message, 'error'); }
  };
  const openTaskFor = key => st.tasks.find(x => x.source_ref === key && M.isOpen(x));

  const steps = report.next_steps.length
    ? h('ul', { class: 'steps' }, report.next_steps.map(s => {
      const id = 'step-' + s.key.replace(/[^a-z0-9-]/g, '-'), existing = openTaskFor(s.key), owner = ctx.bot(s.bot);
      const retired = !!owner && !M.isEnabled(owner);
      if (retired) ui.checked.delete(s.key);
      return h('li', null,
        live ? h('input', { type: 'checkbox', id, checked: ui.checked.has(s.key), disabled: !!existing || retired, onchange: e => { if (e.target.checked) ui.checked.add(s.key); else ui.checked.delete(s.key); createBtn.disabled = !ui.checked.size; createBtn.textContent = label(); } }) : h('span', { class: 'step-bullet', 'aria-hidden': 'true' }),
        h('label', { for: live ? id : null, class: 'grow' }, h('span', { class: 'step-title' }, s.title), h('span', { class: 'muted small block' }, s.reason),
          existing ? h('a', { class: 'small', href: `#/tasks/${existing.id}` }, `Open task exists: ${M.taskKey(existing)}`) : null,
          retired ? h('span', { class: 'muted small block' }, `${owner.name} is off or archived; enable it to create this task.`) : null));
    }))
    : empty('No suggestions: no review corrections or open lessons recorded for this week.');
  const label = () => ui.checked.size ? `Create ${ui.checked.size} improvement task${ui.checked.size === 1 ? '' : 's'}` : 'Create improvement tasks';
  const createBtn = h('button', { class: 'btn btn-primary btn-block', type: 'button', disabled: !ui.checked.size, dataset: { fkey: 'create-impr' }, onclick: createTasks }, label());

  const listBlock = (titleText, iconName, tone, items, none) => h('div', { class: `tone-block tone-${tone}` },
    h('h3', null, h('span', { class: 'tone-icon' }, icon(iconName, 18)), titleText),
    items.length ? h('ul', { class: 'bullets' }, items.map(x => h('li', null, x))) : h('p', { class: 'muted' }, none));

  return h('div', { class: 'page' },
    pageHead(ctx, { title: 'Reports', sub: 'Understand progress and choose the next improvement.', actions: [
      h('button', { class: 'btn', type: 'button', onclick: exportMd }, icon('download', 18), 'Export Markdown'),
      h('button', { class: 'btn', type: 'button', onclick: exportJson }, icon('download', 18), 'Export JSON')] }),
    h('div', { class: 'filters' },
      h('span', { class: 'static-select' }, 'Weekly report'),
      select({ label: 'Week', value: String(ui.week), iconName: 'calendar', fkey: 'week', options: weeks.map((x, i) => [String(i), x.label + (x.current ? ' (this week)' : '')]), onchange: v => { ui.week = +v; ui.snapshot = null; ctx.go('#/reports'); } })),
    h('div', { class: 'reports-layout' },
      h('section', { class: 'panel report', 'aria-labelledby': 'rp-title' },
        h('div', { class: 'title-row' }, h('h2', { id: 'rp-title', class: 'report-title' }, 'Team performance review'),
          h('span', { class: 'badge' }, snap ? `Saved snapshot · ${M.fmtDate(snap.generated_at, true)}` : 'Live from recorded tasks'), ctx.demo ? h('span', { class: 'badge badge-amber' }, 'Demo report') : null),
        h('p', { class: 'lede' }, `${report.label}. A summary of what the team achieved, key learnings and suggested next steps. Tasks are counted by the date they were assigned.`),
        snap ? h('div', { class: 'callout callout-indigo' }, icon('info', 16), h('p', null, 'You are viewing a saved snapshot. Its numbers are as they were when it was saved. ', h('button', { class: 'link-btn', type: 'button', onclick: () => { ui.snapshot = null; ctx.go('#/reports'); } }, 'Back to the live report'))) : null,
        h('div', { class: 'stats stats-3' },
          miniStat('Tasks reviewed', t.reviewed, 'file', 'blue'),
          miniStat('Passed first review', t.reviewed ? t.firstPass : M.DASH, 'check', 'green'),
          miniStat('Required rework', t.reviewed ? t.rework : M.DASH, 'alert', 'red')),
        h('p', { class: 'muted small' }, `First-pass acceptance ${M.fmtPercent(t.firstPassRate)} · median completed time ${M.fmtDuration(t.medianMs)} · ${t.total} task${t.total === 1 ? '' : 's'} assigned this week.`),
        h('div', { class: 'split-1-1' },
          listBlock('What went well', 'checkCircle', 'green', report.went_well, 'Nothing recorded for this week yet.'),
          listBlock('What needs attention', 'warning', 'amber', report.attention, 'Nothing needs attention for this week.')),
        h('div', { class: 'tone-block tone-indigo' }, h('h3', null, h('span', { class: 'tone-icon' }, icon('chart', 18)), 'Recommended next steps'), steps,
          snap && report.next_steps.length ? h('p', { class: 'muted small' }, 'Create improvement tasks from the live report.') : null)),
      h('aside', { class: 'panel history', 'aria-labelledby': 'rh-title' },
        h('h2', { id: 'rh-title' }, 'Report history'),
        history.length ? h('ul', { class: 'history-list' }, history.map(r => h('li', null,
          h('button', { class: 'history-item' + (snap && snap.id === r.id ? ' on' : ''), type: 'button', 'aria-pressed': String(!!(snap && snap.id === r.id)), onclick: () => { ui.snapshot = r.id; ctx.go('#/reports'); } },
            h('span', { class: 'hist-dot', 'aria-hidden': 'true' }),
            h('span', { class: 'grow' }, M.rangeLabel(r.from, r.to), h('span', { class: 'muted small block' }, `Saved ${M.fmtDate(r.generated_at, true)}`)),
            pill('passed', 'Saved', 'pill-xs')))))
          : h('p', { class: 'muted' }, 'No saved reports yet.'),
        h('button', { class: 'btn btn-block', type: 'button', disabled: !!snap, dataset: { fkey: 'save-snap' }, onclick: save }, icon('download', 18), `Save snapshot of ${w.label}`),
        h('p', { class: 'muted small' }, 'Reports use recorded tasks and review outcomes. Nothing is scheduled: a snapshot exists only when you save one.'),
        live ? createBtn : null)));
}

function miniStat(label, value, iconName, tone) {
  return h('div', { class: `mini-stat stat-${tone}` }, h('div', null, h('p', { class: 'stat-label' }, label), h('p', { class: 'stat-value' }, String(value))), h('span', { class: 'stat-icon round' }, icon(iconName, 20)));
}
