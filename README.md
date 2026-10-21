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

## Sign in and personal setup
When `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, HQ asks everyone to **Sign in with Google**. Only people whose Google email matches someone in your Slack get in (the owner in `OWNER_EMAIL` always can). Signing in also connects that person's Calendar and Gmail (read-only).

Each person gets their own view, saved to their account and restored whenever they sign in again, on any device: their Needs You (their ClickUp tasks, @mentions and Gmail), groups and office layout, views, filters, panel sizes, calendar and status. Team-wide settings (Automations, Integrations, people matching) and reading Slack channels (it uses the owner's `SLACK_USER_TOKEN`) stay with the owner. Sessions last 30 days. Accounts live in `data/users.json`, which git ignores.

Without Google set up, HQ falls back to the optional `HQ_PASSWORD`.

## Listening address
Locally the server listens on `127.0.0.1` only. To accept outside connections (deployment, some containers), set `HOST` explicitly, for example `HOST=0.0.0.0`. If a forwarded port (Codespaces, a container) doesn't respond, set `HOST=0.0.0.0` there too, together with `HQ_PASSWORD` or Google sign-in.

## AI team workspace (`/bots/`)
An AI dashboard linked as **AI team** in Human HQ. It uses the same Google session. The owner manages shared bots and skills; explicitly approved teammates use `/bots/team.html` for their own API connection and task history. Local preview remains owner-only until real Human HQ sign-in and teammates are configured.

- **Growing roster**: the team starts with ChatGPT, Claude, Researcher and Reviewer, but the roster is stored data. **Add bot**, **Edit** and **Archive** (and Restore) live on Team overview and in the Headquarters drawer; no code changes are needed. Each bot stores its name, role, description, character style, capabilities and connection status. Cards, filters, task assignment, reports and office desks all come from the roster.
- **Character styles**: ten reusable looks built from the existing portrait sheet (four originals plus hue-shifted variants), so a new bot never needs new artwork.
- **Office scene** (`web/bots/js/scene.js`, assets in `web/bots/assets/modular/`): the empty room (`office-empty.png`) is a fixed backdrop. Each active bot gets a workstation composed from the shared atlases: rug, desk, chair and seated robot, recoloured by its character style. Layering, not masks, handles occlusion: chair → robot → desk when the bot faces the viewer, desk → robot → chair when it faces away.
- **Stable desks**: each bot stores a desk number. A new bot takes the lowest free desk and nobody else moves; archiving frees that desk; restoring returns a bot to its old desk if it is still free. Desks 1–8 surround the shared table in the room. From desk 9 onward, a code-generated annex floor (the repeating `floor-texture.png` on isometric geometry) grows outside the room, three desks per column. The world grows instead of shrinking existing desks; **Show every desk** (or `A`) fits it all.
- **Motion**: robots idle and blink. Typing frames play only for a bot whose recorded status is Working and whose runtime connection is verified, or for labeled demo data. Nothing animates under reduced motion.
- **Walk to seat** (`web/bots/js/walk.js`, paths in `shared/bots-nav.js`): when a bot first gets a desk (it is added or restored, or its desk moves), it walks to its seat. A new or restored bot comes in from the room's door, or the annex's back edge, and a bot whose desk was moved walks over from its old seat. It walks around desks, the shared table, the owner and other bots' occupied seats, then fades into its chair. This is animation only and is labelled as such. A walk resumes or reroutes when the page redraws or the desk moves mid-walk, and stops when you leave the page. **Seat everyone** skips it. Reduced motion, or Settings › Appearance › "Show bots walking to their desks", seats bots instantly, and an unreachable seat is filled directly. `design/MISSING-ANIMATION-FRAMES.md` lists the frames still needed for a real sit-down and turning.
- **Tuning**: sprite scales and offsets live in `TUNE` / `VIEWS` in `scene.js`. Press `D` on the map to show station and seat anchor points.
- **Themes**: Light, Dark or System (Settings › Appearance, or the header button), built from the supplied palette. The choice is saved in the browser and applied before the page draws. System follows the device. Artwork is never edited; dark mode only dims the office slightly with a CSS filter.
- **Connections**: every person configures and verifies their own OpenAI or Anthropic API key and exact model ID. Credentials are encrypted on the server, isolated by HQ identity, and never returned to the browser or included in prompts. There is no owner CLI fallback. Bot names do not select providers. See [Personal accounts and teammate setup](design/PERSONAL-AI-ACCOUNTS.md).
- **Archiving** removes a bot from the office and from new assignments only. Its tasks, lessons, reviews and history stay in Task history, Performance and Reports (labeled archived). Bots are never deleted.

- **Screens**: Headquarters (office map with pan/zoom and a bot drawer), Team overview, Task history, Performance, Learning history, Reports, Connections, Settings.
- **Execution**: tasks start queued. Run with the configured provider loads enabled skill versions and selected shared notes, then saves the AI draft and provenance. Manual updates and runtime events are labeled separately. Draft completion leaves human review pending. With the bridge disabled, work remains manual. A bot with nothing recorded shows "No assignment".
- **Data**: `data/bot-hq.json` (override with `HQ_BOT_STORE`), written atomically. If the file can't be read, or any stored record inside it is malformed (wrong types, unknown statuses, bad ids, duplicates), the API returns an error and never overwrites it. Files from before the stored roster (schema 1) gain the four starting bots and are saved as schema 2 on the next change.
- **Demo mode** (Settings): realistic examples from a fixture, kept in server memory only. Demo writes never reach the real file; switching back restores the real workspace.
- **Knowledge**: Connections synchronizes eligible Markdown from private `natura-hq/team-knowledge`, using the owner's existing GitHub CLI login for fixed read-only requests. Select notes as current context, or preview and approve a pinned skill import. Publishing vault changes to GitHub remains manual. Personal Obsidian is not connected. [Find Skills instructions for Claude](design/CLAUDE-FIND-SKILLS-INSTRUCTIONS.md).

API (`GET`/`POST` only, JSON, same-origin; `X-Bot-Dataset: demo` is owner-only). Shared configuration endpoints below are owner-only. Approved members can read their own filtered state, create tasks, run and review their own tasks, and manage their own connection. Request bodies cannot select another person's identity.

| Method | Path | What |
| --- | --- | --- |
| GET | `/api/bots/state` | Roster (active and archived), character styles, tasks, lessons, saved reports |
| GET / POST | `/api/bots/account` | Read safe personal connection status / save own provider, model and API key |
| POST | `/api/bots/account/disconnect` | Remove own saved API connection |
| POST | `/api/bots/runtime/verify` | Verify own connection with a small provider request |
| GET / POST | `/api/bots/access` | Owner: list eligible real Human HQ teammates / approve or revoke access |
| POST | `/api/bots/tasks/:id/run` | Run using the caller's verified API account; save identity, model, sources and skill versions |
| POST | `/api/bots/roster` | Add a bot: `name, role, focus?, style, capabilities?` (starts Disconnected) |
| POST | `/api/bots/roster/:id` | Edit a bot's configuration (connection status is not editable) |
| POST | `/api/bots/roster/:id/archive` | Archive a bot; its history is kept |
| POST | `/api/bots/roster/:id/restore` | Restore an archived bot |
| GET | `/api/bots/reports/preview?from&to&tz` | Report derived for a date range |
| POST | `/api/bots/tasks` | Create a task: `title, bot, project, criteria, output_url?` |
| POST | `/api/bots/tasks/:id/execution` | Record execution: `status, note?` |
| POST | `/api/bots/tasks/:id/review` | Record review: `status` (pending, passed, changes_requested), `note`, `issue?` |
| POST | `/api/bots/tasks/:id/output` | Save or clear an http(s) output link |
| POST | `/api/bots/tasks/:id/note` | Add a timeline note |
| POST | `/api/bots/lessons` | Record a lesson |
| POST | `/api/bots/lessons/:id/status` | Proposed / Testing / Validated (validated needs 5 different linked trial tasks whose latest result is a pass with evidence; unlinked trials are notes) |
| POST | `/api/bots/lessons/:id/tests` | Record a trial: `result, evidence, evidence_url?, task?` |
| POST | `/api/bots/lessons/:id/instruction` | Tracked instruction change (new version needs new trials) |
| POST | `/api/bots/reports` | Save a report snapshot for `from, to, tz` |
| POST | `/api/bots/improvements` | Create tasks from suggestions (`keys`); open duplicates are skipped |
| POST | `/api/bots/demo/reset` | Rebuild the demo fixture (demo only) |

## Test
`npm test` runs the server against fake Slack and ClickUp APIs. It checks email matching, status mapping, Needs You creation, write-back on approve, webhook signature checks, and Slack DMs.

`npm run test:bot` tests model calculations, validation, persistence and corrupt-file handling, execution/review independence, lessons, reports, permissions, demo isolation, and server integration. Personal-account tests cover encrypted storage, real HQ session helpers, two-user task isolation, fixed provider adapters with simulated responses, verification failures, access revocation, and absence of an owner CLI fallback. Live provider keys and Google sign-in still require configuration and verification.

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
