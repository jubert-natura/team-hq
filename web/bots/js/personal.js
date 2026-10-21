import { apply, toggle } from './theme.js';
apply();
const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
let state, fingerprint = '', requesting = false;
function message(text, error = false) { $('message').textContent = text; $('message').dataset.error = String(error); }
async function api(path, body) {
  const r = await fetch(`/api/bots${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-bot-dataset': 'real' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await r.json(); if (!r.ok || !result.ok) throw new Error(result.error || 'The request failed.'); return result;
}
async function action(fn) {
  if (requesting) return; requesting = true;
  const buttons = [...document.querySelectorAll('button:not(#theme)')]; buttons.forEach(b => { b.dataset.wasDisabled = String(b.disabled); b.disabled = true; });
  try { await fn(); await refresh(); } catch (e) { message(e.message, true); }
  finally { requesting = false; buttons.filter(b => b.isConnected).forEach(b => { b.disabled = b.dataset.wasDisabled === 'true'; }); updateConnection(); }
}
function updateConnection() {
  const rt = state?.runtime; if (!rt) return;
  $('connection').textContent = rt.configured ? `${rt.provider} · ${rt.model} · ${rt.connected ? 'Verified' : 'Needs verification'}${rt.busy ? ' · Request active' : ''}${rt.error ? ` · ${rt.error}` : ''}` : 'No personal AI account connected yet.';
  $('verify').disabled = requesting || !rt.configured || rt.busy;
  $('disconnect').disabled = requesting || !rt.configured || rt.busy;
}
function button(label, fn, disabled = false) { const b = el('button', label, 'btn'); b.type = 'button'; b.disabled = disabled; b.onclick = () => action(fn); return b; }
function renderTasks() {
  const current = JSON.stringify([state.tasks, state.runtime]); if (fingerprint === current) return; fingerprint = current;
  $('tasks').replaceChildren();
  if (!state.tasks.length) $('tasks').append(el('p', 'No tasks yet. Start with one small brief.', 'muted'));
  for (const task of [...state.tasks].reverse()) {
    const section = el('article', undefined, 'personal-task');
    section.append(el('h3', task.title), el('p', `${task.execution} · Review: ${task.review} · ${task.project}`, 'muted small'));
    section.append(el('p', task.criteria));
    if (task.run) {
      section.append(el('p', `${task.run.provider}${task.run.model ? ` / ${task.run.model}` : ''} · ${task.run.executed_by || 'Earlier owner run'} · ${(task.run.skills || []).length} skill versions · ${(task.run.sources || []).length} source notes`, 'small muted'));
      if (task.run.output) section.append(el('pre', task.run.output));
      if (task.run.error) section.append(el('p', task.run.error, 'form-error'));
    }
    const controls = el('div', undefined, 'row gap wrap');
    if (['queued', 'blocked'].includes(task.execution)) controls.append(button('Run with my AI account', async () => { await api(`/tasks/${task.id}/run`, {}); message('Task started with your personal account. Keep HQ running while it works.'); }, !state.runtime.connected || state.runtime.busy));
    if (task.execution === 'completed') {
      for (const [label, outcome] of [['Passed', 'passed'], ['Changes', 'changes_requested']]) controls.append(button(label, async () => {
        const note = window.prompt(outcome === 'passed' ? 'What did you check?' : 'What needs correcting?');
        if (!note?.trim()) return;
        await api(`/tasks/${task.id}/review`, { status: outcome, note, issue: '' }); message('Your review was saved.');
      }));
    }
    section.append(controls); $('tasks').append(section);
  }
}
async function access() {
  if (!state.viewer.admin) return;
  $('accessPanel').hidden = false;
  const result = await api('/access');
  $('authStatus').textContent = result.auth_ready ? 'Uses the same Google sign-in and HQ session as Human HQ.' : 'Human HQ Google sign-in is not configured in this preview. Teammate approval stays disabled until real sign-in is enabled.';
  $('access').replaceChildren();
  const people = new Map(result.candidates.map(c => [c.email, c]));
  for (const m of result.members) if (!people.has(m.email)) people.set(m.email, { email: m.email, name: m.email });
  for (const p of people.values()) {
    const enabled = result.members.some(m => m.email === p.email && m.enabled), row = el('div', undefined, 'row between wrap access-row');
    row.append(el('span', `${p.name} · ${p.email} · ${enabled ? 'Approved' : 'No access'}`), button(enabled ? 'Revoke access' : 'Approve access', async () => {
      await api('/access', { email: p.email, enabled: !enabled }); await access(); message('Workspace access updated.');
    }, !result.auth_ready));
    $('access').append(row);
  }
  if (!people.size) $('access').append(el('p', 'No eligible real teammates are available yet.', 'muted'));
}
async function refresh() {
  state = await api('/state'); updateConnection(); renderTasks();
}
$('theme').onclick = toggle;
$('accountForm').onsubmit = e => {
  e.preventDefault();
  const values = { provider: $('provider').value, model: $('model').value.trim(), api_key: $('apiKey').value.trim() };
  $('apiKey').value = '';
  action(async () => { await api('/account', values); message('Saved securely. Verify your connection before running a task.'); });
};
$('verify').onclick = () => action(async () => { await api('/runtime/verify', {}); message('Your personal API connection is verified. You can run tasks now.'); });
$('disconnect').onclick = () => action(async () => { await api('/account/disconnect', {}); message('Your connection was removed from HQ. Revoke the key in your provider console if you no longer need it.'); });
$('taskForm').onsubmit = e => {
  e.preventDefault(); action(async () => {
    await api('/tasks', { title: $('title').value, project: $('project').value, bot: $('bot').value, criteria: $('criteria').value, output_url: '' });
    $('title').value = ''; $('criteria').value = ''; message('Task saved. Choose Run with my AI account to start it.');
  });
};
try {
  const account = await api('/account');
  $('identity').textContent = account.signed_in ? `Signed in through Human HQ as ${account.identity}.` : `Local owner preview: ${account.identity}. A shared password does not identify individual teammates.`;
  if (account.runtime.provider) $('provider').value = account.runtime.provider;
  $('model').value = account.runtime.model || '';
  await refresh();
  $('taskScope').textContent = state.viewer.admin ? 'Owner view includes earlier workspace tasks. New runs use your personal API connection.' : 'Only your own tasks are shown. Bot instructions and selected knowledge are shared.';
  for (const b of state.bots.filter(b => b.enabled && !b.archived_at)) { const option = el('option', `${b.name} · ${b.role}`); option.value = b.id; $('bot').append(option); }
  await access();
  setInterval(() => { if (!requesting && document.visibilityState === 'visible') refresh().catch(e => message(e.message, true)); }, 4000);
} catch (e) { message(e.message, true); document.querySelectorAll('form button, #verify, #disconnect').forEach(b => { b.disabled = true; }); }
