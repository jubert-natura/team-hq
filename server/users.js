// Per-person data, keyed by email: saved setup (prefs, groups), Google tokens, Gmail "Done" list,
// the Slack status HQ set. Kept in data/users.json (git ignores data/). Sessions live in data/sessions.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = () => path.dirname(path.resolve(process.env.HQ_STORE || 'data/store.json'));
const USERS = () => path.join(dir(), process.env.HQ_STORE ? path.basename(process.env.HQ_STORE, '.json') + '-users.json' : 'users.json');
const SESSIONS = () => path.join(dir(), process.env.HQ_STORE ? path.basename(process.env.HQ_STORE, '.json') + '-sessions.json' : 'sessions.json');
const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };

let users = read(USERS()), sessions = read(SESSIONS());
const timers = {};
const saveLater = (name, file, data) => { clearTimeout(timers[name]); timers[name] = setTimeout(() => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); }, 250); };
const saveUsers = () => saveLater('u', USERS(), users);
const saveSessions = () => saveLater('s', SESSIONS(), sessions);

const key = email => String(email || '').trim().toLowerCase();
/** A person's saved data (created on first use). */
export function user(email) {
  const k = key(email); if (!k) return null;
  if (!users[k]) users[k] = { prefs: {}, groups: [], google: null, mailDone: {}, slackSet: null, created: Date.now() };
  return users[k];
}
export const knownEmails = () => Object.keys(users);
export function updateUser(email, fn) { const u = user(email); if (!u) return null; fn(u); saveUsers(); return u; }

// one-time move of the old single-owner data into the owner's account
export function migrateOwner(email, { groups, mailDone, slackSet, googleFile }) {
  const u = user(email); if (!u || u.migrated) return;
  if (groups && groups.length && !u.groups.length) u.groups = groups;
  if (mailDone && !Object.keys(u.mailDone).length) u.mailDone = mailDone;
  if (slackSet && !u.slackSet) u.slackSet = slackSet;
  if (googleFile && !u.google) { const g = read(googleFile); if (g && g.refresh_token) u.google = g; }
  u.migrated = true; saveUsers();
}

// ---- sessions ----
const DAYS30 = 30 * 864e5;
export function createSession(email) {
  const sid = crypto.randomBytes(32).toString('base64url');
  sessions[sid] = { email: key(email), exp: Date.now() + DAYS30 };
  for (const [s, v] of Object.entries(sessions)) if (v.exp < Date.now()) delete sessions[s];
  saveSessions(); return sid;
}
export function sessionEmail(sid) {
  const s = sid && sessions[sid]; if (!s) return null;
  if (s.exp < Date.now()) { delete sessions[sid]; saveSessions(); return null; }
  if (s.exp - Date.now() < DAYS30 - 864e5) { s.exp = Date.now() + DAYS30; saveSessions(); } // sliding: stays signed in while used
  return s.email;
}
export function endSession(sid) { if (sid && sessions[sid]) { delete sessions[sid]; saveSessions(); } }
