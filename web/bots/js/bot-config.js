import { h, formDialog, extLink, icon, portrait, slider, actionMenu } from './lib.js';
import { FIND_SKILLS_STARTER, SKILLS_CATALOG_URL, FIND_SKILLS_SOURCE_URL } from './skill-discovery.js';

export async function toggleBot(ctx, bot) {
  try {
    const on = !ctx.M.isEnabled(bot);
    await ctx.api(`/roster/${bot.id}/enabled`, { method: 'POST', body: { enabled: on } });
    await ctx.refresh();
    ctx.toast(`${bot.name} turned ${on ? 'on for assignments' : 'off; existing tasks are kept'}.`);
  } catch (e) { ctx.toast(e.message, 'error'); }
}
/** Availability slider: On = available for new assignments (not "connected"). */
export const botSwitch = (ctx, b) => slider({
  checked: ctx.M.isEnabled(b), label: `${b.name} available for assignments`, fkey: 'enabled-' + b.id, onToggle: () => toggleBot(ctx, b)
});

export function skillDialog(ctx, b, skill = null, preset = {}) {
  const v = skill || preset, L = ctx.M.LIMITS;
  formDialog({
    title: skill ? `Edit ${skill.name}` : `Add skill to ${b.name}`,
    description: 'A skill is a repeatable set of instructions. Paste your SKILL.md content or write the steps, expected output and checks.',
    fields: [
      { name: 'name', label: 'Skill name', required: true, maxlength: L.skillName, value: v.name || '', placeholder: 'Weekly project update' },
      { name: 'trigger', label: 'When to use', required: true, maxlength: L.skillTrigger, value: v.trigger || '', placeholder: 'When preparing our weekly project report' },
      { name: 'instructions', label: 'Instructions', required: true, type: 'textarea', rows: 9, maxlength: L.skillInstructions, value: v.instructions || '', placeholder: 'Inputs → steps → expected output → checks → approval rules' },
      { name: 'reference_url', label: 'Reference link', type: 'url', maxlength: L.url, value: v.reference_url || '', hint: 'Optional approved SOP or reference. This saves a link; it does not fetch the page or grant access.' }
    ],
    note: !skill && preset.source
      ? `Saved with its source review (${ctx.M.SKILL_COMPAT[preset.source.compatibility]}), so it starts off. Review the source to turn it on. Nothing is installed.`
      : 'Instructions are stored for this bot. They do not install tools, run code or connect an AI provider.',
    submitLabel: skill ? 'Save skill' : 'Add skill',
    onSubmit: async body => {
      if (!skill && preset.source) body.source = preset.source;
      const r = await ctx.api(`/roster/${b.id}/skills${skill ? '/' + skill.id : ''}`, { method: 'POST', body });
      await ctx.refresh();
      ctx.toast(skill ? 'Skill updated.' : r.skill && !r.skill.enabled ? `Skill added to ${b.name}, off until its source review is ready.` : `Skill added to ${b.name}.`);
    }
  });
}
/**
 * Source review for a skill adapted from an outside catalog. The owner records what they checked; the app does
 * not fetch the source or install anything. Ready needs an exact revision, license, text-only use and a test.
 */
export function sourceDialog(ctx, b, skill) {
  const v = skill.source || { url: skill.reference_url || '' }, L = ctx.M.SOURCE_LIMITS;
  formDialog({
    title: `Source review: ${skill.name}`,
    description: 'Record what you checked in the upstream skill before using it. Ready means the instructions work as plain text in Team Bot.',
    fields: [
      { name: 'url', label: 'Source link', type: 'url', required: true, maxlength: ctx.M.LIMITS.url, value: v.url || '', placeholder: 'https://github.com/owner/repo/blob/<commit>/skills/name/SKILL.md' },
      { name: 'revision', label: 'Exact revision', maxlength: L.revision, value: v.revision || '', placeholder: 'Commit hash or release tag', hint: 'A branch name such as main can change, so it does not count as exact.' },
      { name: 'license', label: 'License', maxlength: L.license, value: v.license || '', placeholder: 'MIT' },
      { name: 'files', label: 'Files in the package', type: 'textarea', rows: 3, value: (v.files || []).join('\n'), placeholder: 'SKILL.md\nscripts/check.sh', hint: 'One per line. Scripts, examples and references are part of the review.' },
      { name: 'required_tools', label: 'Required tools', type: 'textarea', rows: 2, value: (v.required_tools || []).join('\n'), placeholder: 'Web browsing', hint: 'One per line. Team Bot runs instruction text only and has no tools.' },
      { name: 'adaptation', label: 'What was adapted', type: 'radio', value: v.adaptation || 'instructions', options: Object.entries(ctx.M.SKILL_ADAPTATION) },
      { name: 'test', label: 'Proposed test', type: 'textarea', rows: 2, maxlength: L.test, value: v.test || '', placeholder: 'A real task and what a good result must show' },
      { name: 'compatibility', label: 'Review result', type: 'radio', value: v.compatibility || 'unreviewed', options: Object.entries(ctx.M.SKILL_COMPAT) }
    ],
    note: 'Any result other than Ready keeps the skill off. Approving text does not grant tool or external-action permissions.',
    submitLabel: 'Save review',
    onSubmit: async body => {
      const r = await ctx.api(`/roster/${b.id}/skills/${skill.id}/source`, { method: 'POST', body });
      await ctx.refresh();
      ctx.toast(r.skill.source.compatibility === 'ready' ? 'Source review saved. You can turn the skill on.' : 'Source review saved. The skill stays off.');
    }
  });
}
async function removeSource(ctx, b, s) {
  try {
    await ctx.api(`/roster/${b.id}/skills/${s.id}/source`, { method: 'POST', body: { remove: true } });
    await ctx.refresh(); ctx.toast('Source review removed. The skill is now treated as your own instructions.');
  } catch (e) { ctx.toast(e.message, 'error'); }
}
/** Where a skill came from: Team Knowledge, a reviewed outside source, or a copy. */
function skillProvenance(ctx, s) {
  const M = ctx.M, rows = [];
  if (s.origin) rows.push(['Team Knowledge', `${s.origin.path} · revision ${s.origin.commit.slice(0, 8)}`]);
  if (s.source) {
    const x = s.source;
    rows.push(['Source', extLink(x.url, x.url.replace(/^https?:\/\//, ''), 'link-btn small')]);
    rows.push(['Revision', x.revision || 'Not recorded'], ['License', x.license || 'Not recorded'], ['Adapted', M.SKILL_ADAPTATION[x.adaptation]]);
    rows.push(['Files', x.files.length ? x.files.join(', ') : 'Not listed'], ['Required tools', x.required_tools.length ? x.required_tools.join(', ') : 'None listed']);
    if (x.test) rows.push(['Proposed test', x.test]);
    rows.push(['Reviewed', M.fmtDate(x.reviewed_at, true)]);
  }
  if (s.copied_from) rows.push(['Copied', `from version ${s.copied_from.version}, ${M.fmtDate(s.copied_from.at, true)}`]);
  return rows.length ? h('details', null, h('summary', null, 'Source'),
    h('dl', { class: 'skill-src' }, rows.flatMap(([k, val]) => [h('dt', null, k), h('dd', null, val)]))) : null;
}
async function toggleSkill(ctx, b, s) {
  try {
    await ctx.api(`/roster/${b.id}/skills/${s.id}/enabled`, { method: 'POST', body: { enabled: !s.enabled } });
    await ctx.refresh(); ctx.toast(`Skill turned ${s.enabled ? 'off' : 'on'}.`);
  } catch (e) { ctx.toast(e.message, 'error'); }
}
/** A prompt or guideline preview: three lines, with Show all / Show less for longer text. */
function textCard(title, text, emptyText) {
  const p = h('p', { class: text ? '' : 'muted' }, text || emptyText);
  const card = h('div', { class: 'bc-text' }, h('h4', null, title), p);
  if (text && (text.length > 180 || text.split('\n').length > 3)) {
    const more = h('button', { class: 'link-btn', type: 'button', 'aria-expanded': 'false', onclick: () => {
      const open = card.classList.toggle('open');
      more.setAttribute('aria-expanded', String(open)); more.textContent = open ? 'Show less' : 'Show all';
    } }, 'Show all');
    card.append(more);
  }
  return card;
}

/**
 * Settings › Bots: one two-pane panel. Left, every active bot with its On/Off switch (select one to configure it).
 * Right, the selected bot's prompt, design guidelines and skills. Below, the role library for adding bots.
 */
export function botSettings(ctx, selectedId) {
  const bots = ctx.activeBots(), b = bots.find(x => x.id === selectedId) || bots[0];
  const configured = role => bots.filter(x => x.role.toLowerCase() === role.toLowerCase()).length;

  const library = h('section', { class: 'panel', 'aria-labelledby': 'role-library' },
    h('div', { class: 'panel-head' },
      h('div', null, h('h2', { id: 'role-library' }, 'Add a bot'), h('p', { class: 'muted small' }, 'Start from a role template, or create a custom bot. You can change its prompt and skills afterwards.')),
      h('button', { class: 'btn', type: 'button', onclick: () => ctx.addBot() }, icon('plus', 16), 'Custom bot')),
    h('ul', { class: 'template-grid' }, (ctx.state.bot_templates || []).map(t => {
      const n = configured(t.role);
      return h('li', null, h('button', { class: 'template', type: 'button', 'aria-label': `Add ${t.role} bot${n ? ` (${n} already on the team)` : ''}`, onclick: () => ctx.addBot(t) },
        portrait(t.style, 34),
        h('span', { class: 'grow' }, h('b', null, t.role), h('span', { class: 'small muted block' }, t.focus)),
        n ? h('span', { class: 'badge badge-grey', title: `${n} on the team` }, String(n)) : null,
        icon('plus', 18, 'template-plus')));
    })));

  const list = h('nav', { class: 'bc-list', 'aria-label': 'Choose a bot to configure' },
    h('ul', null, bots.map(bot => {
      const on = !!b && bot.id === b.id, sk = bot.skills || [];
      return h('li', { class: 'bc-item' + (on ? ' on' : '') },
        h('a', { class: 'bc-link', href: `#/settings/${bot.id}`, 'aria-current': on ? 'true' : null, dataset: { fkey: 'cfg-' + bot.id } },
          portrait(bot, 30),
          h('span', { class: 'grow' }, h('b', null, bot.name), h('span', { class: 'small muted block' }, `${bot.role} · ${sk.filter(s => s.enabled).length}/${sk.length} skills`))),
        botSwitch(ctx, bot));
    })),
    h('button', { class: 'btn btn-sm bc-add', type: 'button', onclick: () => ctx.addBot() }, icon('plus', 16), 'Add bot'));

  const panel = h('section', { class: 'panel bot-config', 'aria-labelledby': 'bots-h' },
    h('div', { class: 'panel-head' },
      h('div', null, h('h2', { id: 'bots-h' }, 'Bots'),
        h('p', { class: 'muted small' }, 'Off stops new assignments; the bot, its skills and history are kept. It does not cancel jobs in other tools.'))),
    h('div', { class: 'bc-layout' }, list, b ? botDetail(ctx, b, bots) : h('div', { class: 'bc-detail' }, h('p', { class: 'muted' }, 'No active bots. Add one to configure its prompt and skills.'))));
  return [panel, library];
}

function botDetail(ctx, b, bots) {
  const skills = b.skills || [], rt = ctx.state.runtime || {};
  const copySkill = s => formDialog({
    title: `Copy ${s.name}`, description: 'Creates an independent copy on another bot.',
    fields: [{ name: 'bot', label: 'Destination bot', type: 'select', required: true, options: bots.filter(x => x.id !== b.id).map(x => [x.id, x.name]) }],
    note: 'Its source review and Team Knowledge revision are copied too.',
    submitLabel: 'Copy skill', onSubmit: async v => { await ctx.api(`/roster/${b.id}/skills/${s.id}/copy`, { method: 'POST', body: { bot: v.bot } }); await ctx.refresh(); ctx.toast('Skill copied.'); }
  });
  const srcBadge = s => {
    if (s.origin) return h('span', { class: 'badge badge-grey' }, 'Team Knowledge');
    if (!s.source) return null;
    const c = s.source.compatibility;
    return h('span', { class: `badge badge-src src-${c}` }, ctx.M.SKILL_COMPAT[c]);
  };
  const skillRow = s => {
    const blocked = ctx.M.skillBlocker(s);
    return h('li', { class: 'skill-row' },
      h('div', { class: 'skill-main' },
        h('div', { class: 'row gap-sm wrap' }, h('b', null, s.name), h('span', { class: 'badge badge-grey' }, `v${s.version}`), srcBadge(s)),
        h('p', { class: 'small muted' }, s.trigger),
        blocked ? h('p', { class: 'small skill-block' }, icon('info', 14), h('span', null, blocked)) : null,
        h('details', null, h('summary', null, 'Instructions'), h('p', { class: 'config-text' }, s.instructions), extLink(s.reference_url, 'Reference', 'link-btn small')),
        skillProvenance(ctx, s)),
      h('div', { class: 'skill-actions' },
        slider({ checked: s.enabled, disabled: !!blocked && !s.enabled, label: `${b.name}: ${s.name} skill${blocked ? ' (needs source review)' : ''}`, fkey: `skill-${s.id}`, onToggle: () => toggleSkill(ctx, b, s) }),
        actionMenu({ label: 'Actions', ariaLabel: `Actions for ${s.name} skill`, items: [
          { label: 'Edit skill', icon: 'edit', onSelect: () => skillDialog(ctx, b, s) },
          !s.origin && { label: s.source ? 'Review source' : 'Add source review', icon: 'info', onSelect: () => sourceDialog(ctx, b, s) },
          s.source && { label: 'Remove source review', icon: 'close', onSelect: () => removeSource(ctx, b, s) },
          bots.length > 1 && { label: 'Copy to another bot', icon: 'plus', onSelect: () => copySkill(s) }
        ] })));
  };
  const templates = [...(ctx.state.skill_templates || []), { ...FIND_SKILLS_STARTER, chip: 'Find Skills (discovery)' }];

  return h('div', { class: 'bc-detail', 'aria-labelledby': 'bc-title', role: 'region' },
    h('div', { class: 'bc-head' }, portrait(b, 44),
      h('div', { class: 'grow' }, h('h3', { id: 'bc-title' }, b.name), h('p', { class: 'muted small' }, `${b.role}${b.focus ? ' · ' + b.focus : ''}`)),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => ctx.editBot(b) }, icon('edit', 16), 'Edit prompt & design')),
    h('div', { class: 'bc-texts' },
      textCard('Role prompt', b.prompt, 'No role prompt yet.'),
      textCard('Design guidelines', b.design_guidelines, 'No design guidelines yet.')),
    h('div', { class: 'bc-skills-head' },
      h('h4', null, 'Skills ', h('span', { class: 'muted small' }, `${skills.filter(s => s.enabled).length} of ${skills.length} on`)),
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => skillDialog(ctx, b) }, icon('plus', 16), 'Add skill')),
    skills.length ? h('ul', { class: 'skill-list' }, skills.map(skillRow)) : h('p', { class: 'muted small' }, 'No skills yet. Add one, or start from a template below.'),
    h('div', { class: 'bc-starters', role: 'group', 'aria-label': 'Start a skill from a template' },
      h('span', { class: 'small muted' }, 'Templates'),
      templates.map(s => h('button', { class: 'btn btn-sm chip-btn', type: 'button', onclick: () => skillDialog(ctx, b, null, s) }, s.chip || s.name))),
    h('p', { class: 'bc-note small muted' }, icon('info', 14),
      h('span', null, rt.adapter
        ? `Enabled skills are included in ${rt.provider} tasks. Import published Team Knowledge skills from Connections. `
        : 'Skills are saved instructions; they apply to AI work once a runtime is connected. ',
        'Need more? ', extLink(SKILLS_CATALOG_URL, 'Browse the skills catalog', 'link-btn'),
        ', review one, then add its instructions here (', extLink(FIND_SKILLS_SOURCE_URL, 'about Find Skills', 'link-btn'), '). Packages with scripts are not installed.')));
}
