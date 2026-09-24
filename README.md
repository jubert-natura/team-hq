# Team HQ

A real-time command center for your team: a 3D office on top of **Slack** (people, presence, DMs) and **ClickUp** (tasks, workflow). The office is only a view of the data. It never becomes a second task system.

- **Needs You**: one queue of what is waiting on you, and only you. It includes tasks you created or watch that move to a review status, blocked tasks tagged `needs-owner`, and ClickUp comments that @mention you with a question. Approve / Request changes write back to ClickUp. The bell rings again every 30 minutes while anything is waiting.
- **Team**: Slack members matched to ClickUp users by email (or by name when the emails differ).
- **Groups**: put people into named groups (for example Video editors). Each group gets its own area in the 3D office with a color, a sign and the station style you pick: glass cubicle, cubicle or open desk. Show in office zooms to it; Tasks filters to it.
- **Channels**: your Slack channels, read inside HQ with threads, reactions and files. The icon at the top right opens the channel or thread in Slack. Needs `channels:history` and `groups:history` on the user token.
- **Tasks**: live ClickUp tasks as a List, Board or Calendar, with filters for person, project, priority and search, plus sort and group. A project's board uses its own ClickUp statuses and colors, with Add Task per column and drag and drop. You can only change the status of tasks assigned to you.

With no tokens set, the app runs a **demo workspace** so you can try it straight away.

---

## Run it on GitHub Codespaces (no install)

1. **Create the repo.** On github.com, click **New repository** and name it `team-hq` (Private is fine). Upload this folder's files, or push it:
   ```bash
   git remote add origin https://github.com/<you>/team-hq.git
   git push -u origin main
   ```
2. **Open a Codespace.** In the repo, go to **Code → Codespaces → Create codespace on main**. It installs everything and starts the server. A browser tab opens on port 3000 with the demo workspace.
3. **Add your tokens as Codespaces secrets.** Go to **repo Settings → Secrets and variables → Codespaces → New repository secret** and add:

   | Secret | Where to get it |
   | --- | --- |
   | `SLACK_BOT_TOKEN` | See "Slack app" below (`xoxb-…`) |
   | `CLICKUP_API_TOKEN` | ClickUp → avatar → **Settings → Apps → API Token** (`pk_…`) |
   | `OWNER_EMAIL` | Your email, the same in Slack and ClickUp |
   | `HQ_PASSWORD` | Any password. It protects the page once the port is public |

   Codespaces only loads secrets when it starts. After adding them, go to **Codespaces menu → Stop codespace**, then open it again. Or run **Rebuild container**.
4. **Make the port public so ClickUp webhooks can reach you.** In the **Ports** tab, right-click port 3000 → **Port visibility → Public**. The server registers its ClickUp webhook itself on start. If the port stays private, HQ still works but checks ClickUp every 60 seconds instead of updating instantly.
5. Open the forwarded URL and log in with any username and your `HQ_PASSWORD`.

### Slack app (5 minutes)
1. Go to <https://api.slack.com/apps> → **Create New App → From scratch** and pick your workspace.
2. Open **OAuth & Permissions**. Under **Bot Token Scopes** add `users:read`, `users:read.email`, `users.profile:read`, `chat:write`, `im:write`. Optional: `dnd:read` (Do Not Disturb shows as Focus) and `emoji:read` (workspace custom emoji as status icons).
3. Click **Install to Workspace**, then copy the **Bot User OAuth Token** (`xoxb-…`).

DMs sent from HQ come from this bot.

---

## Run it on your computer (VS Code / Claude Code)
```bash
npm install
cp .env.example .env     # fill in the tokens
npm run dev              # http://localhost:3000
```
For instant ClickUp updates on localhost, expose the port with a tunnel and set `PUBLIC_URL`:
```bash
cloudflared tunnel --url http://localhost:3000   # or: ngrok http 3000
```

## Test
`npm test` runs the server against fake Slack and ClickUp APIs. It checks email matching, status mapping, Needs You creation, write-back on approve, webhook signature checks, and Slack DMs.

---

## How it works
```
Slack ──people, presence (polled 2 min), DMs──┐
                                              ├─► server (Node) ─► SSE ─► browser (3D office + panels)
ClickUp ──tasks (webhooks + poll), write-back─┘        │
                                                       └─ data/store.json: Needs You, status-map
                                                          overrides, manual statuses, activity
```
- **Status mapping.** HQ guesses how each ClickUp list's statuses map to `Up next / Working / In review / Changes requested / Blocked / Done`. Fix any wrong guesses under **Automations**.
- **Worker status.** A status you set in HQ (Focus / Meeting / Break / Offline) wins first. Then Slack presence: away in Slack counts as Offline. Then the Slack status: "In a meeting" → Meeting, "Deep Work" / "Focus" / Do Not Disturb → Focus, "Lunch" / "Break" → Break. Then an in-progress task (Working). Otherwise Online. No screen or activity tracking.
- **Office.** Everyone in Slack has a desk. Meetings go to the meeting room, breaks to the pantry (they sit and eat), and offline people walk out the front door until they come back online. Each name tag ends with the person's Slack status emoji. Everyone shows on the Team page.
- **Matching.** Slack and ClickUp accounts link by email, then by name when the emails differ. Fix mismatches in **Integrations → People matching**. Everyone in Slack appears; set `SLACK_ONLY_MATCHED=true` to show only people with a ClickUp account.

| File | What |
| --- | --- |
| `shared/model.js` | Status rules, current-task pick, Needs You rules (server and browser share it) |
| `server/sync.js` | Builds people and tasks from Slack and ClickUp, webhook handler |
| `server/slack.js`, `server/clickup.js` | API clients |
| `server/index.js` | HTTP API, password, webhook endpoint, boot |
| `server/demo.js` | Demo workspace and simulator |
| `web/` | The HQ page |

## Next
Move `data/store.json` to Supabase (tables in the spec), deploy the server (Render, Railway, Fly), and swap the SSE stream for Supabase Realtime.
