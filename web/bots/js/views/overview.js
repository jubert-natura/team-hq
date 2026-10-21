// Team overview: counts, one card per active bot (from the stored roster), roster controls,
// archived bots with their kept history, recent activity and what needs attention.
import { h, icon, pill, portrait, actionMenu } from '../lib.js';
import { pageHead, statCard, empty, panel, manualNote } from './common.js';
import { eventTone } from './hq.js';
import { botSwitch } from '../bot-config.js';

export function render(ctx) {
  const { M } = ctx, st = ctx.state;
  const active = ctx.activeBots(), archived = ctx.archivedBots();
  const counts = M.teamCounts(st.tasks, active);
  const events = M.recentEvents(st.tasks, { limit: 6 });
  const attention = M.needsAttention(st.tasks).slice(0, 4);
  const viewActivity = id => () => { Object.assign(ctx.ui.tasks, { bot: id, status: '', range: 'all', q: '' }); ctx.go('#/tasks'); };

  // Compact card: who, status and current task up front; the rest in a Details dropdown; one Actions menu.
  const cards = active.map(b => {
    const s = M.botStatus(st.tasks, b.id, b), last = M.recentEvents(st.tasks, { bot: b.id, limit: 1 })[0];
    const skills = b.skills || [], enabled = M.isEnabled(b);
    const connection = b.connection === 'demo' ? 'Demo fixture' : b.connection === 'connected' ? 'Connected' : 'Disconnected · manual records only';
    return h('article', { class: 'bot-card compact', 'aria-labelledby': `bc-${b.id}` },
      h('div', { class: 'bot-card-head' },
        portrait(b, 40),
        h('div', { class: 'grow' }, h('h3', { id: `bc-${b.id}` }, b.name), h('p', { class: 'muted small one-line', title: b.focus || '' }, b.focus ? `${b.role} · ${b.focus}` : b.role)),
        pill(s.status, M.BOT_STATUS[s.status], 'pill-xs')),
      h('p', { class: 'bot-card-task' }, h('span', { class: 'muted small' }, 'Current task'),
        s.task ? h('a', { href: `#/tasks/${s.task.id}` }, s.task.title) : h('span', { class: 'muted' }, 'No assignment')),
      h('details', { class: 'bot-card-more' },
        h('summary', null, 'Details', last ? h('span', { class: 'muted small' }, ` · last event ${M.fmtAgo(last.at)}`) : null),
        h('dl', { class: 'bot-card-body' },
          h('div', null, h('dt', null, 'Most recent event'), h('dd', null, last ? last.text : h('span', { class: 'muted' }, 'No events recorded'))),
          h('div', null, h('dt', null, 'Skills'), h('dd', null, skills.length ? `${skills.filter(x => x.enabled).length} of ${skills.length} on` : h('span', { class: 'muted' }, 'None yet'))),
          b.capabilities && b.capabilities.length ? h('div', null, h('dt', null, 'Capabilities'), h('dd', null, h('ul', { class: 'caps' }, b.capabilities.map(c => h('li', null, c))))) : null,
          h('div', null, h('dt', null, 'Connection'), h('dd', { class: 'muted' }, connection)))),
      h('div', { class: 'bot-card-foot' },
        botSwitch(ctx, b),
        h('span', { class: 'row gap-sm' },
          h('button', { class: 'link-btn', type: 'button', onclick: viewActivity(b.id) }, 'Activity', icon('arrowRight', 16)),
          actionMenu({ label: 'Actions', ariaLabel: `Actions for ${b.name}`, items: [
            enabled && { label: 'Assign task', icon: 'plus', onSelect: () => ctx.assignTask({ bot: b.id }) },
            { label: 'Prompt & skills', icon: 'book', onSelect: () => ctx.configureBot(b) },
            { label: 'Edit bot', icon: 'edit', onSelect: () => ctx.editBot(b) },
            { label: 'Archive', icon: 'archive', danger: true, onSelect: () => ctx.archiveBot(b) }
          ] }))));
  });
  const addCard = h('button', { class: 'bot-card add-card', type: 'button', dataset: { fkey: 'add-card' }, onclick: () => ctx.addBot() },
    h('span', { class: 'add-icon' }, icon('plus', 22)), h('b', null, 'Add bot'), h('span', { class: 'muted small' }, 'Gets a desk in the office and starts Disconnected.'));

  const archivedBlock = archived.length ? h('details', { class: 'panel archived' },
    h('summary', null, `Archived bots (${archived.length})`),
    h('p', { class: 'muted small' }, 'Archived bots leave the office and task assignment. Their tasks, lessons and history stay in Task history, Performance and Reports.'),
    h('ul', { class: 'archived-list' }, archived.map(b => {
      const n = st.tasks.filter(t => t.bot === b.id).length;
      return h('li', null, portrait(b, 32, 'faded'),
        h('div', { class: 'grow' }, h('b', null, b.name), h('span', { class: 'muted small block' }, `${b.role} · archived ${M.fmtDate(b.archived_at)} · ${n} task${n === 1 ? '' : 's'} kept`)),
        h('button', { class: 'link-btn', type: 'button', onclick: viewActivity(b.id) }, 'History'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ctx.restoreBot(b) }, icon('undo', 16), 'Restore'));
    }))) : null;

  const activity = panel('Recent activity',
    events.length ? h('ul', { class: 'activity' }, events.map(e => h('li', null,
      h('span', { class: `dot dot-${eventTone(e)}`, 'aria-hidden': 'true' }),
      h('span', { class: 'grow' }, h('b', null, ctx.botName(e.bot)), ' · ', h('a', { href: `#/tasks/${e.task}` }, e.taskTitle), ': ', e.text),
      h('span', { class: 'time' }, M.fmtAgo(e.at)))))
      : empty('No activity recorded yet. Assign a task, then record its progress in Task history.'),
    { actions: events.length ? h('a', { class: 'link-btn', href: '#/tasks', onclick: () => Object.assign(ctx.ui.tasks, { bot: '', status: '', range: 'all', q: '' }) }, 'View all activity', icon('arrowRight', 16)) : null, id: 'ov-activity' });

  const needs = panel(h('span', null, 'Needs attention', attention.length ? h('span', { class: 'count-badge', 'aria-label': `${attention.length} items` }, String(attention.length)) : null),
    attention.length ? h('ul', { class: 'attention' }, attention.map(a => {
      const b = ctx.bot(a.task.bot);
      return h('li', { class: `att att-${a.kind}` },
        portrait(b, 32),
        h('div', { class: 'grow' },
          h('p', null, h('b', null, ctx.botName(a.task.bot)), ' · ', a.text),
          h('p', null, a.task.title),
          lastNote(a.task) ? h('p', { class: 'muted small' }, lastNote(a.task)) : null),
        h('a', { class: 'btn btn-sm', href: `#/tasks/${a.task.id}` }, 'Review'));
    })) : empty('Nothing needs attention.'),
    { cls: attention.length ? 'panel-alert' : '', id: 'ov-needs' });

  return h('div', { class: 'page' },
    pageHead(ctx, { title: 'Team overview', sub: 'See what your team is working on.', actions: [
      h('button', { class: 'btn', type: 'button', dataset: { fkey: 'add-bot' }, onclick: () => ctx.addBot() }, icon('plus', 18), 'Add bot'),
      h('button', { class: 'btn btn-primary', type: 'button', dataset: { fkey: 'assign' }, onclick: () => ctx.assignTask() }, icon('plus', 18), 'Assign task')] }),
    h('div', { class: 'stats' },
      statCard({ label: 'Connected bots', value: `${counts.connected} of ${counts.active}`, iconName: 'users', tone: 'blue', sub: counts.connected ? (ctx.demo ? 'Demo fixture' : '') : 'No runtime adapter yet' }),
      statCard({ label: 'Working', value: counts.working, iconName: 'settings', tone: 'green' }),
      statCard({ label: 'Waiting', value: counts.waiting, iconName: 'clock', tone: 'amber' }),
      statCard({ label: 'Blocked', value: counts.blocked, iconName: 'alert', tone: 'red' })),
    h('h2', { class: 'section-title' }, `Your team (${active.length})`),
    h('div', { class: 'bot-grid' }, cards, addCard),
    archivedBlock,
    h('div', { class: 'split-2-1' }, activity, needs),
    h('p', { class: 'footnote' }, icon('info', 16), manualNote(ctx)));
}

function lastNote(t) {
  if (t.execution === 'blocked') { const e = [...t.events].reverse().find(x => x.kind === 'execution' && x.to === 'blocked'); return e ? e.text : ''; }
  const r = (t.reviews || []).at(-1); return r && r.note ? `Review note: ${r.note}` : '';
}
