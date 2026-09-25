// Google for each signed-in person: Sign in with Google, plus read-only Calendar and Gmail on the same consent.
// Needs GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (a Google Cloud OAuth client, type "Web application").
// Each person's refresh token is kept in their account in data/users.json (git ignores data/).
import crypto from 'node:crypto';
import { user, updateUser } from './users.js';

const GMAIL = 'https://www.googleapis.com/auth/gmail.readonly';
const CAL = 'https://www.googleapis.com/auth/calendar.readonly';
const SCOPES = ['openid', 'email', 'profile', CAL, GMAIL];
export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const saved = email => { const u = user(email); return u && u.google && u.google.refresh_token ? u.google : null; };
export const hasGmail = email => { const g = saved(email); return !!(g && String(g.scope || '').includes(GMAIL)); };
export const googleStatus = email => { const g = saved(email); return { enabled: googleEnabled(), connected: !!g, email: g ? email : null, gmail: hasGmail(email), calendar: !!(g && String(g.scope || '').includes(CAL)) }; };

const states = new Map(); // anti-CSRF: state -> { exp, next }
/** consent: true forces Google's consent screen (needed the first time, to get a refresh token). */
export function authUrl(redirectUri, { consent = false, hint = '' } = {}) {
  const state = crypto.randomBytes(16).toString('hex'); states.set(state, Date.now() + 10 * 60000);
  const q = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', include_granted_scopes: 'true', state, prompt: consent ? 'consent select_account' : 'select_account' });
  if (hint) q.set('login_hint', hint);
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
}
async function tokenCall(body) {
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...body }) });
  const j = await res.json(); if (!res.ok) throw new Error(`Google token: ${j.error_description || j.error || res.status}`); return j;
}
/**
 * Finish Google's redirect. Returns { email, name, picture, verified, needsConsent }.
 * needsConsent means Google gave no refresh token and we have none saved: send them through consent once.
 */
export async function finishAuth(code, state, redirectUri) {
  const exp = states.get(state); states.delete(state);
  if (!exp || exp < Date.now()) throw new Error('Sign-in link expired. Try again.');
  const j = await tokenCall({ code, grant_type: 'authorization_code', redirect_uri: redirectUri });
  let claims = {}; try { claims = JSON.parse(Buffer.from(j.id_token.split('.')[1], 'base64url').toString()); } catch { }
  const email = String(claims.email || '').toLowerCase();
  if (!email) throw new Error('Google did not share an email address.');
  const prev = saved(email), refresh = j.refresh_token || (prev && prev.refresh_token);
  if (refresh) updateUser(email, u => { u.google = { refresh_token: refresh, scope: j.scope || (prev && prev.scope) || '' }; u.name = claims.name || u.name; u.picture = claims.picture || u.picture; });
  access.set(email, { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 });
  return { email, name: claims.name || '', picture: claims.picture || '', verified: claims.email_verified !== false, needsConsent: !refresh };
}
export function disconnect(email) { updateUser(email, u => { u.google = null; }); access.delete(email); }

const access = new Map(); // email -> { token, exp }
async function token(email) {
  const a = access.get(email); if (a && a.token && Date.now() < a.exp) return a.token;
  const g = saved(email); if (!g) throw new Error('Google is not connected');
  const j = await tokenCall({ refresh_token: g.refresh_token, grant_type: 'refresh_token' });
  access.set(email, { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 });
  return j.access_token;
}

/** Events on the person's primary calendar between two ISO times (the browser sends its own "today"). */
export async function events(email, fromIso, toIso) {
  const q = new URLSearchParams({ timeMin: fromIso, timeMax: toIso, singleEvents: 'true', orderBy: 'startTime', maxResults: '50' });
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + q, { headers: { Authorization: 'Bearer ' + await token(email) } });
  const j = await res.json(); if (!res.ok) throw new Error(`Google Calendar: ${(j.error && j.error.message) || res.status}`);
  return (j.items || []).filter(e => e.status !== 'cancelled').map(e => ({
    id: e.id, title: e.summary || '(No title)', start: e.start.dateTime || e.start.date, end: e.end.dateTime || e.end.date, allDay: !e.start.dateTime,
    location: e.location || '', link: e.htmlLink || '', meet: e.hangoutLink || ((e.conferenceData && (e.conferenceData.entryPoints || []).find(p => p.entryPointType === 'video')) || {}).uri || '',
    declined: (e.attendees || []).some(a => a.self && a.responseStatus === 'declined')
  }));
}

// ---- Gmail (read-only) ----
async function gmail(email, pathAndQuery) {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/' + pathAndQuery, { headers: { Authorization: 'Bearer ' + await token(email) } });
  const j = await res.json(); if (!res.ok) throw new Error(`Gmail: ${(j.error && j.error.message) || res.status}`); return j;
}
/** Thread ids matching a Gmail search. */
export async function threadIds(email, q, max = 25) { return ((await gmail(email, 'threads?' + new URLSearchParams({ q, maxResults: String(max) }))).threads || []).map(t => t.id); }
/** A thread's messages with just the headers HQ needs. */
export async function thread(email, id) {
  const q = new URLSearchParams({ format: 'metadata' }); for (const h of ['From', 'To', 'Cc', 'Subject', 'List-Unsubscribe', 'Precedence']) q.append('metadataHeaders', h);
  const j = await gmail(email, `threads/${id}?${q}`);
  return (j.messages || []).map(m => {
    const h = Object.fromEntries((m.payload && m.payload.headers || []).map(x => [x.name.toLowerCase(), x.value]));
    return { id: m.id, labels: m.labelIds || [], date: Number(m.internalDate), snippet: m.snippet || '', from: h.from || '', to: h.to || '', cc: h.cc || '', subject: h.subject || '', bulk: !!(h['list-unsubscribe'] || /bulk|list/i.test(h.precedence || '')) };
  });
}
