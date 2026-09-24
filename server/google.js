// Google Calendar + Gmail for the HQ owner, via OAuth ("Connect Google" in the clock dropdown). Read-only.
// Needs GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (a Google Cloud OAuth client, type "Web application").
// The refresh token is kept in data/google.json, which git ignores.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = path.resolve('data/google.json');
const GMAIL = 'https://www.googleapis.com/auth/gmail.readonly';
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.readonly', GMAIL];
export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

let saved = null; // { refresh_token, email, scope }
let access = { token: null, exp: 0 };
try { saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* not connected yet */ }
const save = () => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(saved || {})); };
export const googleStatus = () => ({ enabled: googleEnabled(), connected: !!(saved && saved.refresh_token), email: (saved && saved.email) || null, gmail: hasGmail() });
/** Gmail needs its own permission; people who connected before it was added reconnect once. */
export const hasGmail = () => !!(saved && saved.refresh_token && String(saved.scope || '').includes(GMAIL));

const states = new Map(); // anti-CSRF: state -> expiry
export function authUrl(redirectUri) {
  const state = crypto.randomBytes(16).toString('hex'); states.set(state, Date.now() + 10 * 60000);
  const q = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}
async function tokenCall(body) {
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...body }) });
  const j = await res.json(); if (!res.ok) throw new Error(`Google token: ${j.error_description || j.error || res.status}`); return j;
}
export async function finishAuth(code, state, redirectUri) {
  const exp = states.get(state); states.delete(state);
  if (!exp || exp < Date.now()) throw new Error('Sign-in link expired. Try Connect Google again.');
  const j = await tokenCall({ code, grant_type: 'authorization_code', redirect_uri: redirectUri });
  access = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  let email = null; try { email = JSON.parse(Buffer.from(j.id_token.split('.')[1], 'base64url').toString()).email; } catch { }
  saved = { refresh_token: j.refresh_token || (saved && saved.refresh_token), email, scope: j.scope || '' }; save();
}
export function disconnect() { saved = null; access = { token: null, exp: 0 }; try { fs.rmSync(FILE, { force: true }); } catch { } }

async function token() {
  if (access.token && Date.now() < access.exp) return access.token;
  if (!saved || !saved.refresh_token) throw new Error('Google is not connected');
  const j = await tokenCall({ refresh_token: saved.refresh_token, grant_type: 'refresh_token' });
  access = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return access.token;
}

/** Events on your primary calendar between two ISO times (the browser sends its own "today", so it's your local day). */
export async function events(fromIso, toIso) {
  const q = new URLSearchParams({ timeMin: fromIso, timeMax: toIso, singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + q, { headers: { Authorization: 'Bearer ' + await token() } });
  const j = await res.json(); if (!res.ok) throw new Error(`Google Calendar: ${(j.error && j.error.message) || res.status}`);
  return (j.items || []).filter(e => e.status !== 'cancelled').map(e => ({
    id: e.id, title: e.summary || '(No title)', start: e.start.dateTime || e.start.date, end: e.end.dateTime || e.end.date, allDay: !e.start.dateTime,
    location: e.location || '', link: e.htmlLink || '', meet: e.hangoutLink || ((e.conferenceData && (e.conferenceData.entryPoints || []).find(p => p.entryPointType === 'video')) || {}).uri || '',
    declined: (e.attendees || []).some(a => a.self && a.responseStatus === 'declined')
  }));
}

// ---- Gmail (read-only) ----
async function gmail(pathAndQuery) {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + pathAndQuery, { headers: { Authorization: 'Bearer ' + await token() } });
  const j = await res.json(); if (!res.ok) throw new Error(`Gmail: ${(j.error && j.error.message) || res.status}`); return j;
}
/** Thread ids matching a Gmail search. */
export async function threadIds(q, max = 25) { return ((await gmail('threads?' + new URLSearchParams({ q, maxResults: String(max) }))).threads || []).map(t => t.id); }
/** A thread's messages with just the headers HQ needs. */
export async function thread(id) {
  const q = new URLSearchParams({ format: 'metadata' }); for (const h of ['From', 'To', 'Cc', 'Subject', 'List-Unsubscribe', 'Precedence']) q.append('metadataHeaders', h);
  const j = await gmail(`threads/${id}?${q}`);
  return (j.messages || []).map(m => {
    const h = Object.fromEntries((m.payload && m.payload.headers || []).map(x => [x.name.toLowerCase(), x.value]));
    return { id: m.id, labels: m.labelIds || [], date: Number(m.internalDate), snippet: m.snippet || '', from: h.from || '', to: h.to || '', cc: h.cc || '', subject: h.subject || '', bulk: !!(h['list-unsubscribe'] || /bulk|list/i.test(h.precedence || '')) };
  });
}
