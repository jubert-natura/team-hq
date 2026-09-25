// The "Sign in with Google" page. Self-contained: no app code loads until you are signed in.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MSG = {
  notallowed: e => `<b>${esc(e || 'That account')} isn't in the team's Slack.</b> Sign in with the Google account that uses the same email as your Slack.`,
  starting: () => '<b>HQ is still starting up.</b> Give it a minute, then sign in again.',
  failed: e => `<b>Sign-in didn't finish.</b> ${esc(e || 'Try again.')}`,
  signedout: () => 'You are signed out.',
  unverified: () => '<b>Google says that email isn\'t verified.</b> Use a verified account.'
};
export function loginPage({ error, email, detail, googleReady }) {
  const note = error && MSG[error] ? MSG[error](error === 'notallowed' ? email : detail) : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Team HQ · Sign in</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{--bg:#EEF2E6;--panel:#fff;--ink:#1F2A1C;--muted:#5F6B59;--line:#DDE3D3;--accent:#2F6B3A;--warn:#FFF6E5;--warnline:#F0D9A8}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#12170F;--panel:#1A2117;--ink:#E7EEDF;--muted:#9AA592;--line:#2C3827;--accent:#9BD174;--warn:#2B2616;--warnline:#5A4B22}}
:root[data-theme="dark"]{--bg:#12170F;--panel:#1A2117;--ink:#E7EEDF;--muted:#9AA592;--line:#2C3827;--accent:#9BD174;--warn:#2B2616;--warnline:#5A4B22}
*{box-sizing:border-box}html,body{margin:0;height:100%}
body{background:var(--bg) radial-gradient(circle at 20% 10%,rgba(167,194,90,.35),transparent 55%);color:var(--ink);font:15px/1.5 "IBM Plex Sans",system-ui,sans-serif;display:grid;place-items:center;padding:16px}
.card{width:min(420px,100%);background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:30px 28px;box-shadow:0 18px 50px rgba(0,0,0,.18)}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:22px}
.logo{width:44px;height:44px;border-radius:11px;background:#2F6B3A;color:#fff;display:grid;place-items:center;font:800 17px/1 "Bricolage Grotesque",sans-serif}
.brand b{display:block;font:800 20px/1.1 "Bricolage Grotesque",sans-serif}.brand span{font-size:13px;color:var(--muted)}
h1{font:800 26px/1.15 "Bricolage Grotesque",sans-serif;margin:0 0 8px}
p{margin:0 0 20px;color:var(--muted)}
.g{display:flex;align-items:center;justify-content:center;gap:12px;width:100%;padding:12px 16px;border-radius:10px;border:1px solid var(--line);background:#fff;color:#1F1F1F;font:600 15px/1 "IBM Plex Sans",sans-serif;text-decoration:none;cursor:pointer}
.g:hover{box-shadow:0 2px 8px rgba(0,0,0,.15)}.g:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.g svg{width:20px;height:20px}
.note{background:var(--warn);border:1px solid var(--warnline);border-radius:10px;padding:10px 12px;font-size:13.5px;margin-bottom:18px}
.fine{font-size:12.5px;color:var(--muted);margin:18px 0 0}
.off{opacity:.55;pointer-events:none}
</style></head><body>
<main class="card">
  <div class="brand"><span class="logo">HQ</span><span><b>Team HQ</b><span>Virtual operations center</span></span></div>
  <h1>Sign in</h1>
  <p>Use your Google account. Your setup (groups, views, filters) is saved to it and comes back every time you sign in.</p>
  ${note ? `<div class="note" role="alert">${note}</div>` : ''}
  <a class="g${googleReady ? '' : ' off'}" href="/auth/google">
    <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
    Sign in with Google</a>
  <p class="fine">Only people in the team's Slack can sign in. HQ also asks to read your Calendar and Gmail, so today's meetings and emails waiting on you show up. It never sends, deletes or changes anything.</p>
</main></body></html>`;
}
