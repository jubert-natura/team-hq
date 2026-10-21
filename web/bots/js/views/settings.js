// Settings: demo mode and workspace facts. Demo data never touches the real store.
import { h, icon } from '../lib.js';
import { pageHead } from './common.js';
import { botSettings } from '../bot-config.js';
import * as theme from '../theme.js';
import { walkingPreference, setWalking } from '../walk.js';

export function render(ctx, param) {
  const st = ctx.state, demo = ctx.demo;
  const events = st.tasks.reduce((n, t) => n + t.events.length, 0);
  const sw = h('button', { class: 'switch', type: 'button', role: 'switch', 'aria-checked': String(demo), 'aria-labelledby': 'demo-l', 'aria-describedby': 'demo-d', dataset: { fkey: 'demo-switch' }, onclick: () => ctx.setDemo(!demo) }, h('span', { class: 'switch-knob', 'aria-hidden': 'true' }));
  const row = (k, v) => h('div', null, h('dt', null, k), h('dd', null, v));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const page = h('div', { class: 'page' },
    pageHead(ctx, { title: 'Settings', sub: 'Bots, their prompts and skills, and how the workspace looks.', actions: [h('a', { class: 'btn', href: '/bots/guide.html' }, icon('book', 18), 'How to use Team Bot')] }),
    botSettings(ctx, param),
    h('div', { class: 'split-1-1' },
      appearance(),
      h('section', { class: 'panel', 'aria-labelledby': 'demo-h' },
        h('h2', { id: 'demo-h' }, 'Demo mode'),
        h('div', { class: 'setting' },
          h('div', { class: 'grow' }, h('p', { id: 'demo-l', class: 'setting-label' }, 'Show demo data'),
            h('p', { id: 'demo-d', class: 'muted small' }, 'Fills the screens with example data. Changes stay in memory and never touch your real workspace; turning it off brings your workspace back.')),
          sw),
        demo ? h('p', { class: 'callout callout-amber' }, icon('info', 16), 'Demo mode is on. A banner stays visible on every page.') : null)),
    h('section', { class: 'panel', 'aria-labelledby': 'ws-h' },
      h('h2', { id: 'ws-h' }, 'Workspace'),
      h('dl', { class: 'facts cols-2' },
        row('Showing', demo ? 'Demo examples (not saved)' : 'Your workspace'),
        row('Bots', `${ctx.activeBots().length} active · ${ctx.archivedBots().length} archived`),
        row('Live connection', st.runtime.adapter ? `${st.runtime.provider} · ${st.runtime.connected ? 'verified' : 'needs verifying'} · drafts only` : 'None yet · work is recorded by hand'),
        row('Connected bots', demo ? 'None (demo examples)' : String(st.bots.filter(b => b.connection === 'connected').length)),
        row('Records', `${plural(st.tasks.length, 'task')} · ${plural(events, 'event')} · ${plural(st.lessons.length, 'lesson')} · ${plural(st.reports.length, 'saved report')}`),
        row('Saved', 'On the HQ server, separate from the human team workspace'),
        row('Access', 'HQ owner only'),
        row('Human team', h('a', { href: '/' }, 'Open Team HQ')))));
  return { el: page, cleanup: () => stopTheme() };
}

/** Appearance: Light, Dark or System (follows the device). Saved in this browser and applied before the page draws. */
function appearance() {
  const pref = theme.getPref();
  const showing = h('p', { class: 'muted small', role: 'status' });
  const say = t => { showing.textContent = `Showing the ${t} theme${theme.getPref() === 'system' ? ', following your device' : ''}.`; };
  say(theme.current());
  const opt = (value, label) => h('label', null,
    h('input', { type: 'radio', name: 'theme-pref', value, checked: pref === value, onchange: () => theme.setPref(value) }), label);
  const choice = h('fieldset', { class: 'theme-choice' },
    h('legend', null, 'Theme'), opt('light', 'Light'), opt('dark', 'Dark'), opt('system', 'System'));
  // the header toggle or another tab can change the choice while this page is open
  stopTheme = theme.onChange((t, p) => { say(t); for (const r of choice.querySelectorAll('input')) r.checked = r.value === p; });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const walkBox = h('input', { type: 'checkbox', id: 'walk-pref', checked: walkingPreference() && !reduced, disabled: reduced,
    onchange: e => setWalking(e.target.checked) });
  return h('section', { class: 'panel', 'aria-labelledby': 'look-h' },
    h('h2', { id: 'look-h' }, 'Appearance'), choice, showing,
    h('div', { class: 'setting walk-setting' }, walkBox,
      h('div', { class: 'grow' }, h('label', { for: 'walk-pref', class: 'setting-label' }, 'Show bots walking to their desks'),
        h('p', { class: 'muted small' }, reduced
          ? 'Your device asks for reduced motion, so bots are seated instantly.'
          : 'Animation only, not work. Off seats bots instantly.'))));
}
let stopTheme = () => { };
