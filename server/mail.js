// Gmail -> Needs You. Two kinds of item, both only for the HQ owner:
//   important: unread inbox mail marked Important or Starred (last 7 days)
//   reply:     a Primary inbox thread where the last message is from someone else, sent to you, not answered yet (last 14 days)
// An item clears itself once you read it / reply / archive, or when you press Done (until a new message arrives).
import * as google from './google.js';
import { db, hq, applyChange, logError, persist } from './store.js';

const AUTOMATED = /(^|[._+-])(no-?reply|do-?not-?reply|noreply|notifications?|notify|mailer-daemon|postmaster|bounces?|newsletter|news|updates?|alerts?|marketing|billing|receipts?)([._+-]|@)/i;
const addr = s => { const m = String(s).match(/<([^>]+)>/); return (m ? m[1] : String(s)).trim().toLowerCase(); };
const nameOf = s => { const m = String(s).match(/^\s*"?([^"<]+?)"?\s*</); return m ? m[1].trim() : addr(s).split('@')[0]; };
const HOUR = 3600000;

let running = false;
export async function pollMail() {
  if (running || !google.hasGmail() || db.mode.demo) return;
  running = true;
  try {
    const me = String(google.googleStatus().email || process.env.OWNER_EMAIL || '').toLowerCase();
    const [imp, rep] = await Promise.all([
      google.threadIds('in:inbox is:unread (is:important OR is:starred) newer_than:7d', 25),
      google.threadIds('in:inbox category:primary newer_than:14d -from:me', 30)
    ]);
    const want = new Map(); // threadId -> item
    for (const id of [...new Set([...imp, ...rep])]) {
      let msgs; try { msgs = await google.thread(id); } catch (e) { logError('gmail thread', e); continue; }
      const last = msgs[msgs.length - 1]; if (!last) continue;
      const from = addr(last.from);
      if (!from || from === me) continue; // you sent the last message: nothing waiting
      if ((hq.mailDone || {})[id] === last.id) continue; // you pressed Done on this message
      const unread = last.labels.includes('UNREAD'), inInbox = last.labels.includes('INBOX');
      if (!inInbox) continue;
      const important = unread && (last.labels.includes('IMPORTANT') || last.labels.includes('STARRED'));
      const toMe = addr(last.to).includes(me) || String(last.to).toLowerCase().includes(me);
      const human = !last.bulk && !AUTOMATED.test(from) && !last.labels.some(l => /CATEGORY_(PROMOTIONS|SOCIAL|UPDATES|FORUMS)/.test(l));
      const reply = toMe && human && rep.includes(id);
      if (!important && !reply) continue;
      const teammate = db.workers.find(w => w.email && w.email === from);
      want.set(id, {
        kind: reply ? 'reply' : 'important', starred: last.labels.includes('STARRED'), last_msg: last.id, from: teammate ? teammate.id : null,
        sender: { name: teammate ? teammate.name : nameOf(last.from), email: from, teammate: !!teammate },
        title: last.subject || '(no subject)', body: last.snippet.slice(0, 280), created: last.date,
        url: `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(me)}#inbox/${id}`,
        priority: important && last.labels.includes('STARRED') ? 1 : important ? 2 : 3
      });
    }
    applyChange(() => {
      const now = Date.now();
      for (const n of db.needs) {
        if (n.type !== 'email' || n.state === 'resolved') continue;
        const tid = n.source.slice(6);
        if (!want.has(tid)) { n.state = 'resolved'; n.resolved = now; }
      }
      for (const [tid, it] of want) {
        const ex = db.needs.find(n => n.source === 'gmail:' + tid && n.state !== 'resolved');
        if (ex) { const fresh = ex.last_msg !== it.last_msg; Object.assign(ex, it); if (fresh) ex.state = 'open'; continue; }
        db.needs.push({ id: 'm' + now.toString(36) + Math.random().toString(36).slice(2, 6), type: 'email', source: 'gmail:' + tid, task: null, state: 'open', ...it });
      }
      db.needs = db.needs.filter(n => n.state !== 'resolved' || now - n.resolved < 6 * HOUR);
    });
  } catch (e) { logError('gmail', e); } finally { running = false; }
}

/** "Done": hide this thread until someone writes again. */
export function markDone(n) {
  hq.mailDone = hq.mailDone || {};
  hq.mailDone[n.source.slice(6)] = n.last_msg;
  const keys = Object.keys(hq.mailDone); if (keys.length > 500) delete hq.mailDone[keys[0]];
  persist();
}
