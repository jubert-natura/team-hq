// Slack Web API — people, presence, status, DMs. Bot token (xoxb-...).
const TOKEN = () => process.env.SLACK_BOT_TOKEN;
export const slackEnabled = () => !!TOKEN();

async function call(method, params = {}, post = false) {
  const url = new URL(`${process.env.SLACK_API_BASE || 'https://slack.com/api'}/${method}`);
  const opts = { headers: { Authorization: `Bearer ${TOKEN()}` } };
  if (post) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/json; charset=utf-8'; opts.body = JSON.stringify(params); }
  else for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, opts);
  if (res.status === 429) { const wait = +(res.headers.get('retry-after') || 5); await new Promise(r => setTimeout(r, wait * 1000)); return call(method, params, post); }
  const j = await res.json();
  if (!j.ok) throw new Error(`Slack ${method}: ${j.error}${j.needed ? ' (needs scope ' + j.needed + ')' : ''}`);
  return j;
}

export async function teamId() { return (await call('auth.test')).team_id; }

/** Active human members with profile + status. */
export async function listPeople() {
  const out = []; let cursor = '';
  do {
    const j = await call('users.list', { limit: 200, ...(cursor ? { cursor } : {}) });
    for (const u of j.members) {
      if (u.deleted || u.is_bot || u.id === 'USLACKBOT' || u.is_app_user) continue;
      const p = u.profile || {};
      out.push({
        slack_user_id: u.id,
        name: p.display_name || p.real_name || u.name,
        real_name: p.real_name || u.name,
        role: p.title || '',
        email: (p.email || '').toLowerCase(),
        avatar_url: p.image_192 || p.image_72 || '',
        slack_status_text: p.status_text || '',
        slack_status_emoji: p.status_emoji || '',
        tz: u.tz || '',
        is_guest: !!(u.is_restricted || u.is_ultra_restricted)
      });
    }
    cursor = j.response_metadata && j.response_metadata.next_cursor;
  } while (cursor);
  return out;
}

export async function presence(userId) { const j = await call('users.getPresence', { user: userId }); return j.presence === 'active' ? 'active' : 'away'; }

export async function sendDM(userId, text) {
  const ch = await call('conversations.open', { users: userId }, true);
  return call('chat.postMessage', { channel: ch.channel.id, text }, true);
}
