// Demo workspace: used when no Slack/ClickUp tokens are set, so the app runs out of the box.
import { db, hq, applyChange, rebuildMap, logEvent } from './store.js';
import { hqState, cuStatusFor, displayStatus, isMeetingStatus, autoMapStatus, worker } from '../shared/model.js';

const MIN = 60000, HOUR = 3600000;
const day = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.toISOString().slice(0, 10); };
const pick = a => a[Math.floor(Math.random() * a.length)];
const LISTS = [
  { id: 'l_delivery', name: 'Client Delivery', names: ['To Do', 'In Progress', 'In Review', 'Changes Requested', 'Blocked', 'Complete'] },
  { id: 'l_sales', name: 'Sales Pipeline', names: ['Open', 'Working', 'For Approval', 'Revisions', 'On Hold', 'Closed'] },
  { id: 'l_mkt', name: 'Marketing', names: ['Backlog', 'Doing', 'Manager Review', 'Rework', 'Waiting on Client', 'Approved'] },
  { id: 'l_ops', name: 'Internal Ops', names: ['To Do', 'In Progress', 'In Review', 'Changes Requested', 'Blocked', 'Complete'] }
];
const PEOPLE = [
  ['you', 'You', 'Founder', 'Leadership', '#2F6B3A', true], ['nora', 'Nora', 'Operations lead', 'Operations', '#3F7CAC'], ['theo', 'Theo', 'Reports + EA', 'Operations', '#C0504D'],
  ['mika', 'Mika', 'Pipeline desk', 'Sales', '#5E8C3F'], ['rosa', 'Rosa', 'Outreach', 'Sales', '#E09A2E'], ['jun', 'Jun', 'Inbound + academy', 'Support', '#7B5EA7'],
  ['kai', 'Kai', 'Automation builder', 'Automation', '#2A9D8F'], ['lena', 'Lena', 'Designer', 'Creative', '#D1495B'], ['omar', 'Omar', 'QA + compliance', 'Operations', '#4D5B6B']
];
const TASKS = [
  ['Reply to Acme Co: confirm Tuesday kickoff + Zoom link', 'theo', 'l_ops', 'In Review', 'Acme Co', 2, 0, []],
  ['Brightside proposal follow-up with current price', 'mika', 'l_sales', 'For Approval', 'Brightside', 1, 1, []],
  ['Onboarding automation for the new client form', 'kai', 'l_delivery', 'In Review', 'Northwind', 2, 2, []],
  ['Homepage revision for Brightside', 'lena', 'l_mkt', 'Waiting on Client', 'Brightside', 1, 1, ['needs-owner']],
  ['Draft 5 LinkedIn outreach messages', 'rosa', 'l_sales', 'Working', 'Outreach', 3, 1, []],
  ['Weekly client report for Northwind', 'theo', 'l_delivery', 'In Progress', 'Northwind', 2, 0, []],
  ['Answer new inbound DMs', 'jun', 'l_ops', 'In Progress', 'Academy', 3, 0, []],
  ['Refresh the proposal template cover', 'lena', 'l_mkt', 'Doing', 'Internal', 3, 3, []],
  ['Audit SOPs for client data handling', 'omar', 'l_ops', 'To Do', 'Internal', 3, 5, []],
  ['Plan next week’s capacity', 'nora', 'l_ops', 'In Progress', 'Internal', 2, 2, []],
  ['Landing page QA for Northwind', 'omar', 'l_delivery', 'In Progress', 'Northwind', 2, 1, []],
  ['Set up GHL pipeline stages', 'kai', 'l_delivery', 'To Do', 'Northwind', 3, 6, []],
  ['Approve Q4 content calendar', 'you', 'l_mkt', 'Backlog', 'Internal', 2, 4, []],
  ['Review hiring shortlist', 'you', 'l_ops', 'To Do', 'Internal', 2, 2, []]
];

export function loadDemo() {
  const n = Date.now();
  db.mode = { slack: 'demo', clickup: 'demo', demo: true };
  db.lists = LISTS.map(l => ({ id: l.id, name: l.name, statuses: l.names.map((s, i) => ({ status: s, type: i === 0 ? 'open' : i === 5 ? 'closed' : 'custom', auto: ['todo', 'in_progress', 'in_review', 'changes_requested', 'blocked', 'approved'][i] })) }));
  rebuildMap();
  db.workers = PEOPLE.map(([id, name, role, department, color, own]) => ({
    id, name, role, department, color, avatar_url: '', is_owner: !!own, slack_user_id: 'U_DEMO_' + id.toUpperCase(), clickup_user_id: 'demo_' + id, match: 'demo',
    slack_presence: id === 'omar' ? 'away' : 'active', slack_status_text: id === 'jun' ? 'In a meeting' : '', slack_status_emoji: id === 'jun' ? ':calendar:' : '',
    manual_status: 'none', last_seen_at: id === 'omar' ? n - 5 * HOUR : n
  }));
  if (!hq.manual.lena && !db.activity.length) hq.manual.lena = 'break';
  db.tasks = TASKS.map((s, i) => ({ id: 't' + (i + 1), cu_id: 'demo' + (i + 1), name: s[0], assignee: s[1], list_id: s[2], list_name: LISTS.find(l => l.id === s[2]).name, clickup_status: s[3], clickup_status_type: '', client: s[4], priority: s[5], due_date: day(s[6]), tags: s[7], url: '', updated: n - (15 - i) * 9 * MIN }));
  if (!db.needs.length) db.needs.push(
    { id: 'n_q1', type: 'question', source: 'demo:q1', task: 't2', from: 'mika', title: 'Client question', body: 'Brightside asked if the 10% discount still applies. OK to offer it?', priority: 2, state: 'open', created: n - 14 * MIN },
    { id: 'n_c1', type: 'confirmation', source: 'demo:c1', task: null, from: 'nora', title: 'Launch date', body: 'Team needs confirmation: launch the Northwind site on Oct 6?', priority: 2, state: 'open', created: n - 35 * MIN });
  db.meta.initialSync = true; applyChange(() => {}); db.meta.initialSync = false;
}

const QUESTIONS = ['Client wants to move the call to Friday. OK?', 'Can I use the new pricing sheet for this one?', 'Is it fine to extend the deadline by two days?'];
const team = () => db.workers.filter(w => !w.is_owner);
const move = (t, state) => { t.clickup_status = cuStatusFor(db, t.list_id, state); t.updated = Date.now(); logEvent('clickup', 'taskStatusUpdated', `${t.name.slice(0, 34)} → ${t.clickup_status}`); };

export function simulate(kind) {
  const ts = st => db.tasks.filter(t => hqState(db, t) === st && !(worker(db, t.assignee) || {}).is_owner);
  applyChange(() => {
    let t, w;
    switch (kind) {
      case 'review': t = pick([...ts('in_progress'), ...ts('changes_requested')]); if (t) move(t, 'in_review'); break;
      case 'block': t = pick(ts('in_progress')); if (t) { if (!t.tags.includes('needs-owner')) t.tags.push('needs-owner'); move(t, 'blocked'); } break;
      case 'start': t = pick(ts('todo')); if (t) move(t, 'in_progress'); break;
      case 'resume': t = pick(ts('changes_requested')); if (t) move(t, 'in_progress'); break;
      case 'question': t = pick(db.tasks.filter(x => !['approved', 'cancelled'].includes(hqState(db, x)) && !(worker(db, x.assignee) || {}).is_owner)); if (t) {
        db.needs.push({ id: 'n' + Date.now().toString(36), type: 'question', source: 'demo:' + Date.now(), task: t.id, from: t.assignee, title: 'Question on ' + t.name.slice(0, 40), body: '@You ' + pick(QUESTIONS), priority: t.priority, state: 'open', created: Date.now() });
        logEvent('clickup', 'taskCommentPosted', `${worker(db, t.assignee).name} on ${t.name.slice(0, 28)}`); } break;
      case 'assign': { w = pick(team().filter(x => displayStatus(db, x) !== 'offline')); if (!w) break; const l = pick(db.lists);
        const nt = { id: 't' + Date.now().toString(36), cu_id: 'demo', name: pick(['Prep onboarding checklist', 'Update client FAQ page', 'Pull last month’s ad metrics', 'Draft welcome email sequence']), assignee: w.id, list_id: l.id, list_name: l.name, clickup_status: '', clickup_status_type: '', client: pick(['Acme Co', 'Northwind', 'Brightside', 'Internal']), priority: 3, due_date: day(2), tags: [], url: '', updated: Date.now() };
        nt.clickup_status = cuStatusFor(db, l.id, 'in_progress'); db.tasks.push(nt); logEvent('clickup', 'taskCreated', nt.name); break; }
      case 'away': w = pick(team().filter(x => x.slack_presence === 'active' && !hq.manual[x.id] && !isMeetingStatus(x))); if (w) { w.slack_presence = 'away'; logEvent('slack', 'users.getPresence', `${w.name} is away`); } break;
      case 'back': w = pick(team().filter(x => x.slack_presence === 'away')); if (w) { w.slack_presence = 'active'; w.last_seen_at = Date.now(); logEvent('slack', 'users.getPresence', `${w.name} is active`); } break;
      case 'meeting': w = pick(team().filter(x => !isMeetingStatus(x) && !hq.manual[x.id] && x.slack_presence === 'active')); if (w) { w.slack_status_text = 'In a meeting'; w.slack_status_emoji = ':calendar:'; logEvent('slack', 'user_change', `${w.name} status “In a meeting”`); } break;
      case 'endMeeting': w = pick(team().filter(isMeetingStatus)); if (w) { w.slack_status_text = ''; w.slack_status_emoji = ''; logEvent('slack', 'user_change', `${w.name} cleared status`); } break;
      case 'break': w = pick(team().filter(x => !hq.manual[x.id] && displayStatus(db, x) !== 'offline')); if (w) { hq.manual[w.id] = 'break'; logEvent('hq', 'manual_status', `${w.name} → break`); } break;
      case 'endBreak': w = pick(team().filter(x => hq.manual[x.id] === 'break')); if (w) { delete hq.manual[w.id]; logEvent('hq', 'manual_status', `${w.name} → auto`); } break;
      case 'confirm': w = pick(team()); if (w) { db.needs.push({ id: 'n' + Date.now().toString(36), type: 'confirmation', source: 'demo:' + Date.now(), task: null, from: w.id, title: pick(['Launch date', 'Budget sign-off', 'Go / no-go for Friday send']), body: `${w.name} needs you to confirm before the team moves ahead.`, priority: 2, state: 'open', created: Date.now() }); logEvent('hq', 'confirmation_requested', w.name); } break;
    }
  });
}
export function randomSim() {
  const r = Math.random();
  simulate(r < .18 ? 'start' : r < .34 ? 'review' : r < .40 ? 'block' : r < .46 ? 'resume' : r < .52 ? 'question' : r < .58 ? 'assign' : r < .65 ? 'away' : r < .73 ? 'back' : r < .79 ? 'meeting' : r < .86 ? 'endMeeting' : r < .92 ? 'break' : 'endBreak');
}
export { autoMapStatus };
