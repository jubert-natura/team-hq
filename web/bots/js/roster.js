// Roster management: add, edit, archive and restore bots through the interface. No code changes are needed
// to grow the team. New bots start Disconnected; nothing here can mark a bot Connected.
import * as M from '/shared/bots-model.js';
import { h, portrait, formDialog } from './lib.js';

/** Character style picker options: a preview of each reusable style with its name. */
const styleOptions = () => M.STYLE_IDS.map(id => [id, h('span', { class: 'style-opt' }, portrait(id, 40), h('span', null, M.CHARACTER_STYLES[id].label))]);
/** Suggest a style no active bot uses yet, so new bots are easy to tell apart. */
function freeStyle(bots) {
  const used = new Set(M.activeBots(bots).map(b => b.avatar && b.avatar.style));
  return M.STYLE_IDS.find(s => !used.has(s)) || M.STYLE_IDS[bots.length % M.STYLE_IDS.length];
}

export function botDialog(ctx, b = null, preset = {}) {
  const edit = !!b;
  const value = b || preset;
  let suggestedName = preset.name || '';
  if (!edit && suggestedName) {
    const base = suggestedName; let n = 2;
    while (ctx.state.bots.some(x => M.isActive(x) && x.name.toLowerCase() === suggestedName.toLowerCase())) suggestedName = `${base} ${n++}`;
  }
  formDialog({
    title: edit ? `Edit ${b.name}` : 'Add bot',
    description: edit
      ? 'Changes are recorded in the bot\'s history. Its tasks, lessons and reports stay attached.'
      : 'Adds a bot to the roster. It gets a desk in the office and appears in cards, filters, task assignment and reports.',
    fields: [
      { name: 'name', label: 'Name', required: true, maxlength: M.LIMITS.botName, value: edit ? b.name : suggestedName, placeholder: 'Designer' },
      { name: 'role', label: 'Role', required: true, maxlength: M.LIMITS.botRole, value: value.role || '', placeholder: 'Designer' },
      { name: 'focus', label: 'Description', maxlength: M.LIMITS.botFocus, value: value.focus || '', placeholder: 'Visual design & UI polish' },
      { name: 'style', label: 'Character style', type: 'radio', cls: 'style-grid', options: styleOptions(), value: edit ? b.avatar.style : preset.style || freeStyle(ctx.state.bots),
        hint: 'Reusable characters: pick a look instead of commissioning new artwork.' },
      { name: 'capabilities', label: 'Capabilities', type: 'textarea', rows: 3, value: (value.capabilities || []).join('\n'),
        placeholder: 'UI design\nDesign review', hint: `One per line or separated by commas. Up to ${M.LIMITS.capabilities}.` },
      { name: 'prompt', label: 'Role prompt', type: 'textarea', rows: 5, maxlength: M.LIMITS.prompt, value: value.prompt || '', hint: 'Describe responsibilities, expected outputs and approval rules. Saved instructions; execution requires a connected runtime.' },
      { name: 'design_guidelines', label: 'Design guidelines', type: 'textarea', rows: 4, maxlength: M.LIMITS.design, value: value.design_guidelines || '', placeholder: 'Brand colors, typography, reference links and asset requirements' }
    ],
    submitLabel: edit ? 'Save changes' : 'Add bot',
    note: edit ? null : 'New bots start Disconnected. No runtime adapter exists yet, so a connection cannot be verified and no work is sent to the bot.',
    onSubmit: async v => {
      const body = { ...v, capabilities: v.capabilities.split(/[,\n]/).map(s => s.trim()).filter(Boolean) };
      const r = await ctx.api(edit ? `/roster/${b.id}` : '/roster', { method: 'POST', body });
      await ctx.refresh();
      ctx.toast(edit ? `${r.bot.name} updated.` : `${r.bot.name} added to the team as Disconnected.`);
    }
  });
}

export function archiveDialog(ctx, b) {
  const tasks = ctx.state.tasks.filter(t => t.bot === b.id), open = tasks.filter(M.isOpen).length;
  const lessons = ctx.state.lessons.filter(l => l.bot === b.id).length;
  formDialog({
    title: `Archive ${b.name}?`,
    description: `${b.name} leaves the office, team cards and task assignment. Its ${tasks.length} task${tasks.length === 1 ? '' : 's'}, ${lessons} lesson${lessons === 1 ? '' : 's'} and history stay in Task history, Performance and Reports. You can restore it later.`
      + (open ? ` ${open} open task${open === 1 ? ' stays' : 's stay'} assigned to it and can still be updated.` : ''),
    fields: [{ name: 'note', label: 'Reason', type: 'textarea', rows: 2, maxlength: M.LIMITS.note, placeholder: 'Vendor research moved to Researcher' }],
    submitLabel: 'Archive bot',
    onSubmit: async v => {
      await ctx.api(`/roster/${b.id}/archive`, { method: 'POST', body: v });
      if (location.hash === `#/hq/${b.id}`) location.hash = '#/hq';
      await ctx.refresh();
      ctx.toast(`${b.name} archived. Its history is kept.`);
    }
  });
}

export async function restoreBot(ctx, b) {
  try {
    await ctx.api(`/roster/${b.id}/restore`, { method: 'POST', body: {} });
    await ctx.refresh();
    ctx.toast(`${b.name} restored. It is Disconnected until a connection is verified.`);
  } catch (e) { ctx.toast(e.message, 'error'); }
}
