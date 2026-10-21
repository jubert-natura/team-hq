// Light / Dark / System theme for the AI workspace (/bots/ only).
// index.html applies the saved choice before first paint; this module keeps it in sync afterwards:
// saving the choice, following the operating system while System is selected, and updating every control.
const KEY = 'teamBot.theme';
const PREFS = ['light', 'dark', 'system'];
const media = matchMedia('(prefers-color-scheme: dark)');
let memory = null; // used when the browser blocks storage, so the choice still holds for this visit
const listeners = new Set();

export function getPref() {
  let v = memory;
  try { v = localStorage.getItem(KEY) || memory; } catch { /* storage blocked */ }
  return PREFS.includes(v) ? v : 'system';
}
export const resolve = pref => (pref === 'system' ? (media.matches ? 'dark' : 'light') : pref);
export const current = () => resolve(getPref());

export function apply(pref = getPref()) {
  const theme = resolve(pref), root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.themePref = pref;
  for (const fn of listeners) fn(theme, pref);
}
export function setPref(pref) {
  if (!PREFS.includes(pref)) return;
  memory = pref;
  try { if (pref === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref); } catch { /* keep in memory */ }
  apply(pref);
}
/** Header button: switch to the opposite of what is showing now (an explicit choice, not System). */
export const toggle = () => setPref(current() === 'dark' ? 'light' : 'dark');
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

media.addEventListener('change', () => { if (getPref() === 'system') apply('system'); });
// another tab changed the choice
window.addEventListener('storage', e => { if (e.key === KEY) apply(); });
