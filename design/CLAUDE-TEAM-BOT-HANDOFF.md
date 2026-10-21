# Team Bot — current implementation and next instructions for Claude

## Latest handoff: review, commit and push — 21 October 2026

Read [CLAUDE-GITHUB-PUSH-INSTRUCTIONS.md](CLAUDE-GITHUB-PUSH-INSTRUCTIONS.md) first for the user's current GitHub publication task. Its scoped command/test/Git permissions supersede the historical file-editing-only and no-publication restrictions below. ChatGPT reran all **52 bot tests** and the Human HQ smoke checks successfully. The app now supports explicitly approved Human HQ members and personal OpenAI/Anthropic API connections; there is no owner CLI fallback in the application. See [PERSONAL-AI-ACCOUNTS.md](PERSONAL-AI-ACCOUNTS.md) for the current boundaries. Google sign-in and live personal API accounts remain unconfigured in the preview. The rest of this document records earlier implementation decisions; older owner-only, shared CLI and pending-test status statements are superseded by this paragraph and the current push instructions.

User direction, consolidated 21 October 2026. Continue in this existing repository. These current requirements supersede the older static Headquarters and manual-bot placement descriptions in AI-HQ-BRIEF.md. Read that brief for the existing application scope and the six references under design/references, then use this document for current behavior.

## Working agreement

Use repository file tools only: Read/Edit/Write/Glob/Grep. ChatGPT runs commands, tests, browser QA and any approved Higgsfield work. Do not use subagents, install dependencies, access credentials, call paid APIs, connect external services, publish Git commits, deploy, or read outside the repository. Preserve the human team workspace at `/` and its existing integrations. The AI workspace remains `/bots/`.

## Latest desk placement decision — implement and preserve

- The owner edits **desks**, rather than dragging bots around manually. Keep the desk selector, drag handles, precise X/Y positions, nudge controls, snap toggle, zoom, Undo, Reset selected, Cancel and explicit Save.
- Keep prominent **Rotate left / Rotate right** buttons. Cycle the four real atlas perspectives in order; use matching desk sprites. A flat CSS spin is not a substitute for a different isometric view.
- While editing, **only the desk and its rug move, rotate or change size**. The user asked for the carpet to stay with its desk. The bot, chair and other scene objects remain at their saved positions. Show the target seat marker separately. Do not let dragging a bot reposition it.
- The rug lies along its desk in every view. The rug art runs down-right, so for `front_left` and `rear_left` (desk atlas column 1, running down-left) it is mirrored. With automatic seating it follows the desk's offset and size. This rule is `rugPlacement()` in `shared/bots-model.js` and has a regression test.
- After Save, the assigned bot and chair align automatically to the desk's seat anchor and facing direction. Saved desk changes must survive reload/restart and adding more bots. Cancel must leave saved actors and positions unchanged.
- Current implementation supports this visual seating by snapping after Save. The user also wants bots to find their desks: walk-to-seat is visual navigation, clearly separate from real AI execution.
- Requirements: derive the target from a stable desk assignment. Walk through floor space around furniture, avoid occupied seats, support rerouting/cancellation, and provide a reduced-motion instant-seat option. Keep agent identity separate from physical furniture. Do not regenerate an office every time the roster grows. Preserve current bot IDs, desk slots, tasks, skills and history in any schema migration.
- **Implemented by Claude, awaiting ChatGPT test run and browser QA:**
  - **Paths:** `shared/bots-nav.js` holds the pure path logic. It uses a traced open-floor polygon for the room plus the annex floor. Obstacles are desks (with their edited offset and scale), the shared table, the owner and other bots' occupied seats. It runs A\* on a 24-unit grid with smoothed paths.
  - **Entry points:** the room door, or the annex back edge.
  - **Animation:** `web/bots/js/walk.js` animates the `robot-actions` walk rows. Columns 0 and 2 plus mirrors come from `headingView()`. The bot cross-fades into the seated sprite on arrival.
  - **When walks run:** only when a bot's arrival key changes (desk slot, desk position or view, restore count, seating mode), which is stored per browser.
  - **Resuming and skipping:** in-progress walks resume or reroute after a redraw or a desk move, and leaving the page cancels them. "Seat everyone" skips.
  - **Starting point:** after a desk move is saved in the layout editor, the bot walks from the seat it last sat in. A new or restored bot walks in from the entrance.
  - **Instant seating:** reduced motion, Settings › Appearance › "Show bots walking to their desks" turned off, an unreachable seat, or a bot switched Off all seat instantly.
  - **Missing frames:** `design/MISSING-ANIMATION-FRAMES.md` specifies the sit-down, turning and four-frame walk frames to request next. Nothing has been generated.

Current relevant files: `shared/bots-model.js` (`rotateDeskView`, `deskSeat`, `layoutInput`, `arrangeDesks`); `server/bots-router.js` (`POST /api/bots/layout`); `server/bots-store.js`; `web/bots/js/views/layout.js`; `web/bots/js/scene.js`; `web/bots/layout.css`; `web/bots/js/views/hq.js`.

Desk placement currently lives on the assigned bot's `layout` and stable `desk` slot. New desk edits set `layout.auto_seat: true`; bot/chair coordinates then derive from desk position, offset, scale and view. Legacy manual layouts remain readable. Bot/chair XY overrides are ignored in automatic seating mode; the editor no longer exposes manual actor controls. A future independent desks collection should be a deliberate migration, not a reset of the current roster.

## 3D office version — requested 21 October 2026

The user asked for a 3D version of Headquarters like the human HQ, keeping the bots the same, with a switch between versions. They chose the existing robot art over low-poly robots.

**Implemented by Claude, awaiting ChatGPT's test run and browser QA:**
- **Switch:** Headquarters' title bar has a 2D | 3D switch (`modeSwitch`, stored per browser as `teamBot.hqMode`; 2D is the default). `hq.js` routes to `render3d()` in `js/views/hq3d.js`. Both versions share the title, status bar and bot drawer through `chrome()` and `renderDrawer()`.
- **Office:** built in the human HQ's style (`web/app.js` `initScene`): three.js r128 from the same cdnjs URL, loaded on demand; box furniture, grass, trees; orthographic camera; drag or arrow keys to turn, wheel or buttons to zoom, reset. A single renderer is reused across re-renders, so the camera angle survives selecting a bot.
- **Layout:** a front door, the open office with four desks per column and a team room with the shared table, sofa, shelf and wall screen. Desk *i* is stable slot *i*, so the office grows without moving anyone. An occupied desk gets a rug in its bot's colour and a monitor tinted by recorded status.
- **Bots:** the same bots, drawn from `robot-seated.png` as camera-facing sprites tinted with each style's `robotHue` (canvas filter). `seatedColumn(phi, theta)` in `shared/bots-nav.js` chooses the sheet column from the camera angle. The sprite's depth plane reproduces the 2D layer order (behind the desk when facing you, behind the chair back when facing away). Idle, blink and typing frames follow the 2D rules: typing only for verified or demo bots, nothing under reduced motion, and bots that are Off are dimmed. The owner sprite from `scene-support.png` stands by the table with a "You" tag.
- **Limits:**
  - 2D layout-editor positions and rotations are not applied in 3D, so Edit layout is hidden there.
  - Walk-to-seat runs only on the 2D map.
  - Sprites are discrete diagonal views, not 3D models.
  - No new artwork was generated.

## Reusable office and assets

Keep navigation, header, detail panel and decorative perimeter fixed. The center floor/world expands as bots are added; existing stations keep their stable positions. Use the original warm oak/ivory/lavender office references and reusable transparent layers.

All artwork is through **Higgsfield**, as the user requested. Current source assets are in `web/bots/assets/modular/`: empty office, floor material, desk views, chair views, standing actions, seated actions, scene-support props and single references. Read README.md, atlas.json, generation-record.json and REFERENCE-ASSET-AUDIT.md there. There are ten original PNGs and 64 atlas cells; retain their bytes and alpha. Some views are near duplicates and require documented mirrors; this is a discrete sprite system, not a 3D rig.

Idle/blink, typing A/B and two-frame walking samples exist. Smooth sit-down/stand-up and turning transition frames do not yet exist. Identify a precise missing frame set before asking ChatGPT to create additional Higgsfield assets. Status labels, UI icons, selection outlines and charts belong in SVG/CSS/code. An artwork animation never proves that an AI job ran.

## Bots, prompts, skills and contribution

Already implemented locally:
- Ten role templates: Planner, Builder, Researcher, Reviewer, Designer, Writer, Analyst, Knowledge Keeper, Automation and Project Coordinator; custom roles are supported.
- Bot On/Off switches: off blocks new assignments/improvement tasks, retains history, and stops scene animation. It does not cancel external jobs or establish a connection.
- Editable role prompts and design guidance. Per-bot skills have a name, when-to-use trigger, Markdown instructions, optional reference link, On/Off, versioned edits and independent Copy to bot.
- Owner-recorded tasks, execution, reviews, lessons, trial results and reports. Real data is persisted separately; demo data stays in server memory.

The intended learning loop is team task → reviewed output → specific correction/lesson → proposed skill change → meaningful test → owner approval → new approved skill version. Preserve evidence and provenance. Do not call saved notes model training, automatically promote every correction, or show an improvement without supporting results. The review fixes described in `design/THEME-AND-REVIEW.md` are now present: the latest outcome per distinct task governs validation, and malformed nested stored records are refused without overwriting their file. Preserve these regression checks; the current 35-test suite passes.

Approved bot skills belong in **Team Knowledge**, the shared Obsidian vault. The local bridge now reads its published private GitHub repository, exposes sync freshness/errors and loads selected context at task start. Reviewed skill imports stay pinned until explicitly reimported. Enabled skill versions and source revisions accompany the actual draft. Do not connect or copy the owner's personal Second Brain into the team app. Obsidian publication and skill promotion stay reviewed/manual; automatic daily learning is not configured.

Team members should eventually sign in, submit tasks, review drafts, add approved references/SOPs and propose skill improvements. Keep owner approval for publishing shared skills, tool permissions and sensitive actions. The present bot API is **owner-only**; teammate accounts, access checks and the contribution/approval flow are future work. GitHub repository membership and dashboard login are separate access systems.

## Current integration update — 2026-10-21

The owner explicitly authorized implementing the shared knowledge/runtime pipeline. ChatGPT has now built and exercised the local bridge: 96 eligible shared notes were listed, the official vault was clean and matched GitHub commit `e043bd1ddd239ec2820288239f1a9f6723a16ffa`, Reviewer imported Code Review Skill v1, and a real Codex run returned a draft citing CONTRIBUTING.md. The validation task remains Pending review. Obsidian publication stays manual; selected context refreshes at task start. Claude Code authentication returned 401, so Codex is the labeled fallback provider. This supersedes the older no-adapter descriptions below; those describe the earlier implementation boundary.

Read [CLAUDE-FIND-SKILLS-INSTRUCTIONS.md](CLAUDE-FIND-SKILLS-INSTRUCTIONS.md) for the focused Find Skills assignment and [SHARED-KNOWLEDGE-RUNTIME.md](SHARED-KNOWLEDGE-RUNTIME.md) for operation, authentication boundaries and limitations. Preserve the new `server/bots-bridge.js`, bridge API routes, connection UI, task draft/provenance and regression coverage while editing.

## Skill discovery requested by the user

Use the Vercel Labs **find-skills** workflow as the discovery entry point: https://github.com/vercel-labs/skills/blob/main/skills/find-skills/SKILL.md . Official project documentation: https://github.com/vercel-labs/skills and https://skills.sh/docs/api . The project is MIT licensed; preserve license notices when copying package contents. Review each discovered skill's own license and requirements separately.

Implemented now: each bot's skill panel has a **Browse skills catalog** link and an **Add Find Skills starter** button. The starter is a Team Bot adaptation with a source link, not a global installation of the upstream package. The owner reviews the populated form and explicitly saves it to a bot. Existing skill switches/versioning/copy behavior apply.

**Source review, implemented by Claude, awaiting ChatGPT's test run and browser QA:** Settings › Bots › skill Actions › Add source review records what the owner checked upstream: link, exact revision, license, files, required tools, adaptation, proposed test and a result. Only "Ready for text-only use" lets the skill be on. Ready needs a commit hash or release tag, a license, a test, instructions-only adaptation and no required tools. The Find Skills starter saves with a "Needs tools" review, so it starts off. Copy to bot now runs on the server and keeps `origin`, `source` and a `copied_from` record. Runs skip blocked skills and log each skill's source revision. Details are in CLAUDE-FIND-SKILLS-INSTRUCTIONS.md.

Future integration: discovery → source/file preview → compatibility review → owner-approved import → assign to bots. Retain origin, exact revision/hash, license and required tools; distinguish Markdown instructions from complete packages with scripts/references. Updates should be reviewed versions rather than silently replacing active instructions. Installing for Claude Code or Codex does not install a skill into this custom application's runtime.

The documented skills.sh programmatic API requires Vercel OIDC authentication. A Vercel project/API credential is not configured here. Keep catalog browsing functional until a backend integration is explicitly configured; do not invent an unauthenticated endpoint, expose credentials, run a shell command from browser input, or automatically execute third-party instructions. This file-editing handoff does not authorize installing the CLI or connecting an external service.

When an approved runtime exists, load the relevant enabled skill and its required supporting files at task start and log the version used. Discovery/import alone is not task execution, learning, Obsidian sync or a live connection.

## Connections and honest runtime behavior

The optional local CLI adapter now dispatches real text-only jobs and derives connection verification from an actual response. Codex is configured as the verified fallback while Claude Code's OAuth sign-in needs renewal. Opening a desktop app alone does not establish this connection. The dashboard's On state means available for assignment; Connected identifies availability of the configured shared provider. All role bots currently use that same provider.

The local owner flow is task → selected published notes and enabled skills → configured runtime → draft → human review. Teammate login, service credentials, external-action tools and automatic lesson promotion remain separate work. Keep private configuration and bot data out of the public application repository. Under this file-editing handoff, Claude should not access credentials, enable public access or connect personal tools. Preserve truthful provider labels, failure states and manual/demo isolation.

## Light and dark themes

The main `/bots/` app now includes Light/Dark/System controls and a header toggle; ChatGPT observed the dark theme in the browser during the skill-discovery check. Preserve these collaborating changes. Palette: #111111, #262626, #D2D2D2, #FFFFFF, #75FFE6, #45A593, #5566FF, #242E8E, #FFB1B1, #FF8888. Verify saved preference before first paint, OS changes in System mode and coverage across every view/dialog/form/map control/editor. Scope to `/bots/` and preserve original PNGs. The isolated asset previews are separate from the main app.

## Validation and completion

`test/bots.js` now has **42 tests**, and the malformed-record test has three more source-review cases. Seven tests have not been run yet:
- **3D column rule (1):** `seatedColumn` for the default camera, half and whole turns.
- **Skill source review (2):** the Ready rules, staying off until Ready, refusing to enable, a downgrade switching the skill off, removing a review, server-side copy with provenance, persistence and owner-only routes.
- **Rug rule (1).**
- **Walk navigation (3):** reachable paths around obstacles, mid-walk rerouting, the annex entrance and unreachable seats, plus heading-to-atlas mapping. Before them, ChatGPT ran **35 bot tests successfully**, including four-direction rotation, automatic seating, atomic layout saves, authorization, demo isolation, distinct-task trial validation and malformed nested-record rejection. Earlier smoke checks for the existing human workspace passed. Browser checks confirmed that desk-only movement/rotation preserves actor/chair positions until Save, then automatically aligns the actor. The new Find Skills starter opens a populated review form with its source URL; it has not been installed as an executable package. Full theme coverage remains a separate browser QA item.

Latest verification: **45 bot tests pass**, including the collaborating source-review, 3D view and rug changes plus the shared-knowledge/runtime checks. Existing human-workspace smoke checks pass. A real Reviewer task using Code Review Skill v1 and CONTRIBUTING.md returned a Codex draft and remains Pending review. Browser QA confirmed the published-note preview, sync status, actual provider, output and provenance. The walking-scale request was cancelled by the owner and is excluded from this work.

Add meaningful regression cases for changes. ChatGPT runs `npm run test:bot`, the existing smoke suite where appropriate, and browser checks. Finish with the files changed, observed results and remaining limitations. Do not claim deployment or teammate access; both remain unconfigured.
