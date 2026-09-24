// Slack status emoji (":gear:") -> something a browser can show: a Unicode character,
// or an image URL for workspace custom emoji (only when the bot has emoji:read).
// The shortcode list is iamcal/emoji-data (the set Slack uses), fetched once and cached in data/.
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'https://cdn.jsdelivr.net/npm/emoji-datasource@15.1.2/emoji.json';
const CACHE = path.resolve('data/emoji-map.json');
const TONES = { '1F3FB': 2, '1F3FC': 3, '1F3FD': 4, '1F3FE': 5, '1F3FF': 6 };
const chr = u => String.fromCodePoint(...u.split('-').map(h => parseInt(h, 16)));

let unicode = {};
let custom = {};

/** Load the shortcode map from cache, or download it. Safe to call more than once. */
export async function loadEmoji() {
  try { unicode = JSON.parse(fs.readFileSync(CACHE, 'utf8')); if (Object.keys(unicode).length) return; } catch { /* not cached yet */ }
  try {
    const list = await (await fetch(SRC)).json(), map = {};
    for (const e of list) {
      for (const n of e.short_names) map[n] = chr(e.unified);
      for (const [tone, v] of Object.entries(e.skin_variations || {})) if (TONES[tone]) for (const n of e.short_names) map[`${n}::skin-tone-${TONES[tone]}`] = chr(v.unified);
    }
    unicode = map;
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify(map));
  } catch (e) { console.error('emoji list:', e.message); }
}
export const setCustomEmoji = map => { custom = map || {}; };

/** "COOKING! :bangbang:" -> "COOKING! ‼️" (custom emoji codes are left as they are). */
export const emojifyText = s => String(s || '').replace(/:([a-z0-9_+'-]+(?:::skin-tone-\d)?):/gi, (m, n) => { const e = resolveEmoji(n); return e && e.char ? e.char : m; });

/** Returns { char } or { url } or null. */
export function resolveEmoji(code) {
  let name = String(code || '').replace(/^:|:$/g, '');
  if (!name) return null;
  for (let hop = 0; hop < 3 && custom[name]; hop++) {
    const v = custom[name];
    if (!v.startsWith('alias:')) return { url: v };
    name = v.slice(6);
  }
  const ch = unicode[name] || unicode[name.split('::')[0]];
  return ch ? { char: ch } : null;
}
