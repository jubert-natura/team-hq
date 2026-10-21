import { h, icon, pill, portrait, extLink } from '../lib.js';
import { pageHead } from './common.js';

export function render(ctx) {
  const st = ctx.state, kn = st.knowledge, rt = st.runtime;
  const act = async (button, path, body = {}) => {
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    try { await ctx.api(path, { method: 'POST', body }); await ctx.refresh(); ctx.toast('Connection updated.'); }
    catch (e) { ctx.toast(e.message, 'error'); button.disabled = false; button.removeAttribute('aria-busy'); }
  };
  const sync = h('button', { class: 'btn btn-primary', disabled: ctx.demo || !rt.adapter, onclick: e => act(e.currentTarget, '/knowledge/sync') }, 'Sync published notes');
  const verify = h('button', { class: 'btn', disabled: ctx.demo || !rt.adapter || rt.busy || (rt.personal && !rt.configured), onclick: e => act(e.currentTarget, '/runtime/verify') }, rt.busy ? `${rt.provider} is running…` : rt.personal ? 'Verify my AI connection' : `Verify ${rt.provider || 'runtime'} connection`);
  const local = kn.local;
  const localText = !local?.configured ? 'Shared vault Git checkout is not configured on this server.' : !local.verified ? local.error
    : `${local.clean ? 'Clean working tree' : 'Unpublished local edits'} · ${local.matches_remote ? 'local commit matches GitHub' : 'local and GitHub commits differ'}.`;
  return h('div', { class: 'page' },
    pageHead(ctx, { title: 'Connections', sub: 'Shared knowledge → selected bot skills → real AI drafts.', actions: [h('a', { class: 'btn btn-primary', href: '/bots/team.html' }, 'My AI connection & teammate access')] }),
    h('div', { class: 'split-1-1' },
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', null, 'Team Knowledge'), pill(kn.ingested ? 'connected' : 'disconnected', kn.ingested ? 'Synced' : 'Not synced')),
        h('p', null, extLink(kn.url, 'Private natura-hq/team-knowledge', 'repo-link')),
        h('p', null, 'Edit the shared vault in Obsidian. Review the file list and diff, then commit and push approved notes to GitHub. Publishing remains manual.'),
        h('p', { class: 'muted small' }, localText),
        h('p', { class: 'muted small' }, kn.synced_at ? `${kn.notes.length} eligible notes · ${ctx.M.fmtDate(kn.synced_at, true)} · revision ${kn.commit.slice(0, 8)}` : 'The dashboard reads only published shared Markdown. Personal Noah is not connected.'),
        kn.error ? h('p', { class: 'form-error', role: 'alert' }, kn.error) : null, sync),
      h('section', { class: 'panel' },
        h('div', { class: 'panel-head' }, h('h2', null, `${rt.provider || 'AI'} runtime`), pill(rt.connected ? 'connected' : 'disconnected', rt.connected ? 'Verified' : 'Not verified')),
        h('p', null, rt.personal ? 'Uses your own verified API connection. Set your provider, model and API key in My AI connection. Bot names and avatars describe roles; they do not select the provider.' : rt.adapter ? `Uses the installed ${rt.provider} CLI on this computer.` : 'No runtime is enabled.'),
        h('p', { class: 'muted small' }, 'Drafts only. Run a queued task from Task history. Its selected notes are refreshed at task start, and enabled skill versions are recorded with the output. Human review stays separate.'),
        rt.verified_at ? h('p', { class: 'muted small' }, `Last successful response: ${ctx.M.fmtDate(rt.verified_at, true)}`) : null,
        rt.error ? h('p', { class: 'form-error', role: 'alert' }, rt.error) : null, verify)),
    h('h2', { class: 'section-title' }, 'Knowledge for each bot'),
    h('p', { class: 'muted' }, 'Select up to five notes as current task context. Preview a skill note before importing a reviewed, pinned version; later source changes require another reviewed import. Inbox, submissions, chat sessions and RASPHIL paths are excluded.'),
    h('div', { class: 'bot-grid' }, ctx.activeBots().map(b => botKnowledge(ctx, b, act))),
    h('p', { class: 'footnote' }, icon('info', 16), 'Approved teammates use the same Human HQ session and their own API credentials. Human HQ sign-in must be configured before teammate access can be granted. Credentials never enter task prompts.'));
}

function botKnowledge(ctx, b, act) {
  const paths = b.knowledge_paths || [], notes = ctx.state.knowledge.notes || [];
  const choice = h('select', { class: 'select-input', 'aria-label': `Shared note for ${b.name}`, disabled: ctx.demo || !notes.length },
    h('option', { value: '' }, notes.length ? 'Choose a shared note…' : 'Sync notes first'), notes.map(n => h('option', { value: n.path }, n.path)));
  const preview = async () => {
    if (!choice.value) { ctx.toast('Choose a shared note first.', 'error'); return; }
    try {
      const { note } = await ctx.api(`/knowledge/note?path=${encodeURIComponent(choice.value)}`);
      const title = 'Shared note preview', titleId = `preview-${b.id}`;
      const error = h('p', { class: 'form-error', role: 'alert' });
      const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': titleId }, h('div', { class: 'dialog-form' },
        h('h2', { id: titleId }, title), h('p', null, note.path),
        h('p', { class: 'muted small' }, `Pinned revision ${note.commit.slice(0, 8)} · ${note.content.length} characters`),
        h('pre', { class: 'runtime-output' }, note.content),
        h('p', { class: 'hint' }, 'Import approves this text as bot instructions. Supporting scripts, images and linked files are not imported. Use only a complete, reviewed instruction note.'), error,
        h('div', { class: 'dialog-actions' }, h('button', { class: 'btn', onclick: () => dlg.close() }, 'Close'),
          h('button', { class: 'btn btn-primary', disabled: note.content.length > ctx.M.LIMITS.skillInstructions, onclick: async e => {
            e.currentTarget.disabled = true;
            try { await ctx.api(`/roster/${b.id}/knowledge/import`, { method: 'POST', body: { path: note.path, sha: note.sha } }); dlg.close(); await ctx.refresh(); ctx.toast('Reviewed skill imported.'); }
            catch (x) { error.textContent = x.message; e.target.disabled = false; }
          } }, 'Approve and import as skill'))));
      document.body.append(dlg); dlg.addEventListener('close', () => { dlg.remove(); choice.focus(); }); dlg.showModal();
    } catch (e) { ctx.toast(e.message, 'error'); }
  };
  return h('article', { class: 'bot-card conn' },
    h('div', { class: 'bot-card-head' }, portrait(b, 42), h('div', { class: 'grow' }, h('h3', null, b.name), h('p', { class: 'muted' }, `${b.role} · ${b.enabled ? 'On' : 'Off'}`)), pill(b.connection, b.connection_label)),
    h('ul', { class: 'bullets' }, paths.map(p => h('li', null, p, ' ', h('button', { class: 'link-btn', disabled: ctx.demo, onclick: e => act(e.currentTarget, `/roster/${b.id}/knowledge`, { paths: paths.filter(x => x !== p) }) }, 'Remove')))),
    !paths.length ? h('p', { class: 'muted small' }, 'No shared context notes selected.') : null, choice,
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn btn-sm', disabled: ctx.demo || !notes.length, onclick: e => {
        if (!choice.value || paths.includes(choice.value)) { ctx.toast('Choose a note that is not already selected.', 'error'); return; }
        act(e.currentTarget, `/roster/${b.id}/knowledge`, { paths: [...paths, choice.value] });
      } }, 'Use as context'),
      h('button', { class: 'btn btn-sm', disabled: ctx.demo || !notes.length, onclick: preview }, 'Preview / import skill'),
      h('a', { class: 'link-btn', href: `#/settings/${b.id}` }, 'Edit skills')));
}
