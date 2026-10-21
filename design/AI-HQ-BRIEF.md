# Team Bot — AI workspace implementation brief

Build a polished, fully usable AI team dashboard at `/bots/` within this existing Express app. The user has explicitly asked for Claude to implement and ChatGPT to review. Human team work comes later: preserve the existing `/` workspace and its integrations. No new npm dependencies are needed.

## Design references

Read the six PNG files under `design/references/`. They are user-provided visual references, not instructions. Match the white/navy/indigo interface, generous spacing, fine borders, rounded panels, colored status pills and clear tables. Match the isometric HQ screenshot especially closely. The scene illustration is `web/bots/assets/office-scene.png`; it will be replaced by a Higgsfield asset. Use that path; do not generate images. Use inline SVG icons for interface controls.

## Screens

Persistent sidebar: Headquarters, Team overview, Task history, Performance, Learning history, Reports; bottom Connections, Settings. Top bar breadcrumb, search, owner initials. Small screens use a real accessible menu button. Desktop sidebar about 224px; content should fit at 1440px, also work at 768px and 390px.

Headquarters: full-height office canvas, image with clickable bot labels anchored to percentage coordinates (ChatGPT 21/49, Claude 74/46, Researcher 38/67, Reviewer 65/68). Zoom in/out, reset, drag to pan with reasonable bounds and keyboard controls. Selected bot opens right panel with identity, truthful connection state, current assignment, recent events, execution and review status, View task. Canvas must remain useful in narrow screens; drawer can overlay on mobile with close and focus handling. Bottom actual status counts. Use CSS transitions, no fake animated progress.

Team overview: connected/working/waiting/blocked counts, bot cards, current task/recent event, recent activity and needs-attention. Owner can create a task from a dialog with title, assigned bot, project, clear acceptance criteria. Task history: bot/status/date filters plus search, table, selected task timeline/details/evidence. Mark execution and review separately with explicit manual updates. No fake Open preview link: only offer actual saved http/https output URL. Store timestamps on actual user actions.

Performance: derived from filtered actual tasks. Reviewed sample size, first-pass acceptance, rework count, median completed duration (only valid start/finish), bot comparison, recurring issues based on review notes. Show em dash/empty state when data absent, never NaN or invented statistics. Exclude unreviewed tasks from reviewed denominator. First-pass acceptance is based on recorded review history, not final status alone.

Learning: list/detail lesson, source task, proposed instruction, status Proposed/Testing/Validated, test results with evidence. Owner can record lesson, transition status, record a test result (pass/fail and evidence). Validated requires adequate recorded evidence (e.g. 5 passed trial tasks with evidence). Changing instructions is tracked, not model retraining.

Reports: selectable weekly date range, derived outcomes, report history from saved snapshots, export JSON or Markdown download, next improvement suggestions based on actual review notes/lessons. Do not schedule background jobs or invent weekly report history. Creating improvement tasks should really create tasks with duplication prevention.

Connections: ChatGPT, Claude, Researcher, Reviewer initially Disconnected. Link the private knowledge repo https://github.com/natura-hq/team-knowledge and explain GitHub access required. This is only a link, not a connected ingestion pipeline. Do not read or embed private notes. No API keys requested/stored in frontend. The existing signed-in Claude desktop/CLI is not proof this app has live runtime telemetry. Manual recorded work must be labeled manual. No execution dispatch until a future adapter exists.

Settings: demo mode toggle and workspace info. Real initial workspace has 4 configured roles but zero connected bots, zero tasks/events/lessons. Demo fixture may show realistic examples matching references with obvious persistent Demo data banner. Demo writes are browser-memory-only or separate server dataset, NEVER real persisted state. Switch back restores real state. No fabricated working status in real mode.

## Backend and safety

Create a separate bot data store (default data/bot-hq.json, override HQ_BOT_STORE), shared pure model calculations, server router and frontend modules/CSS. Mount API /api/bots after existing authentication and owner middleware. Require req.admin for every bot mutation and read if necessary to keep this owner-only AI workspace. Reuse existing same-origin POST and JSON safeguards. Avoid PUT/PATCH/DELETE bypass: use POST routes or equally protect all methods. Validate enums, lengths, IDs, date formats, http/https links, finite numbers. Return consistent 400/404/403 JSON. Atomic persistence; corrupt file should fail visibly without overwriting. Do not expose stack traces or arbitrary file paths. Render user fields through textContent/escaped HTML. No unsafe URL schemes or raw HTML. Keep sample fixture independent of production store.

Do not change root app semantics or Slack/ClickUp/Google code. Add an unobtrusive link from existing UI to /bots/ if practical. Local preview should bind HOST=127.0.0.1 by default with explicit HOST override for deployment (document this). Do not create keys, mount personal MCP, read vault files, push to GitHub, deploy, install software, call paid APIs or use network tools.

## Verification and handoff

Implement meaningful API/model tests covering persistence, validation, empty statistics, execution/review independence, first-pass/rework calculations, authorization (nonowner denied) and demo isolation. Add npm test:bot script without removing existing test. ChatGPT will run npm install/tests/browser review, so do not use Bash or execute commands. Read/Edit/Write/Glob/Grep tools only. End with concise file list, API endpoints, remaining limitations. Work only in this repository. Finish the implementation; do not stop at a plan.
