// Slack Web API — people, presence, status, DMs. Bot token (xoxb-...).
// Optional user token (xoxp-...) for the HQ owner: sets your own Slack status, lists your channels, reads your Pause notifications.
const TOKEN = () => process.env.SLACK_BOT_TOKEN;
const USER_TOKEN = () => process.env.SLACK_USER_TOKEN;
export const slackEnabled = () => !!TOKEN();
export const userTokenEnabled = () => !!USER_TOKEN();

async function call(method, params = {}, post = false, token = TOKEN()) {
  const url = new URL(`${process.env.SLACK_API_BASE || 'https://slack.com/api'}/${method}`);
  const opts = { headers: { Authorization: `Bearer ${token}` } };
  if (post) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/json; charset=utf-8'; opts.body = JSON.stringify(params); }
  else for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, opts);
  if (res.status === 429) { const wait = +(res.headers.get('retry-after') || 5); await new Promise(r => setTimeout(r, wait * 1000)); return call(method, params, post, token); }
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

/** Do Not Disturb windows for up to 50 users at a time. Needs the dnd:read scope. */
export async function dndInfo(userIds) {
  const out = {};
  for (let i = 0; i < userIds.length; i += 50) Object.assign(out, (await call('dnd.teamInfo', { users: userIds.slice(i, i + 50).join(',') })).users || {});
  return out;
}

/** Workspace custom emoji (name -> image URL or "alias:name"). Needs the emoji:read scope. */
export async function customEmoji() { return (await call('emoji.list')).emoji || {}; }

export async function sendDM(userId, text) {
  const ch = await call('conversations.open', { users: userId }, true);
  return call('chat.postMessage', { channel: ch.channel.id, text }, true);
}

// ---- as the HQ owner (user token) ----
const asUser = (method, params, post) => call(method, params, post, USER_TOKEN());

/** Set your Slack status. expiration is a unix time in seconds (0 = never). */
export const setMyStatus = (text, emoji, expiration = 0) => asUser('users.profile.set', { profile: { status_text: text, status_emoji: emoji, status_expiration: expiration } }, true);
/** 'auto' or 'away'. */
export const setMyPresence = presence => asUser('users.setPresence', { presence }, true);
/** Pause notifications for N minutes, or end the pause. */
export const snooze = minutes => asUser('dnd.setSnooze', { num_minutes: minutes }, true);
export const endSnooze = () => asUser('dnd.endSnooze', {}, true);
/** Your own Do Not Disturb, including a manual Pause notifications (bots can't see that). */
export const myDnd = () => asUser('dnd.info');

/** Channels you are in. With the user token: all of yours, private too. Without it: the ones the bot can see you in. */
export async function myChannels(userId) {
  const byUser = userTokenEnabled(), out = []; let cursor = '';
  do {
    const params = { types: 'public_channel,private_channel', exclude_archived: true, limit: 200, ...(cursor ? { cursor } : {}), ...(byUser ? {} : { user: userId }) };
    const j = byUser ? await asUser('users.conversations', params) : await call('users.conversations', params);
    for (const c of j.channels || []) out.push({ id: c.id, name: c.name, is_private: !!c.is_private, members: c.num_members || null, topic: (c.topic && c.topic.value) || '', purpose: (c.purpose && c.purpose.value) || '' });
    cursor = j.response_metadata && j.response_metadata.next_cursor;
  } while (cursor);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Latest messages in a channel (newest first), as you. Needs channels:history / groups:history on the user token. */
export async function history(channel, limit = 60) { return (await asUser('conversations.history', { channel, limit })).messages || []; }
/** A thread: the parent message first, then its replies. */
export async function replies(channel, ts) { return (await asUser('conversations.replies', { channel, ts, limit: 200 })).messages || []; }
/** Anyone not in HQ's people list (guests, bots, people from other workspaces). */
export async function userInfo(id) { return (await call('users.info', { user: id })).user; }
