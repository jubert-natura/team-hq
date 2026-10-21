# Team Bot: session summary for continuing in a new chat

Repo: `Team-Bot-HQ`. The Express app serves the human team workspace at `/`, which is unchanged, and the owner-only AI workspace at `/bots/`.

**Read first:**
- `CLAUDE.md`
- `design/CLAUDE-TEAM-BOT-HANDOFF.md` (the current spec; it supersedes `design/AI-HQ-BRIEF.md` where they differ)
- `design/THEME-AND-REVIEW.md`
- `design/MISSING-ANIMATION-FRAMES.md`
- `web/bots/assets/modular/README.md` and `atlas.json`

## Working agreement

- Claude edits files only, using Read/Edit/Write/Glob/Grep.
- No terminal, network, MCP, subagents, installs, credentials, git push or deploy.
- ChatGPT (Codex) runs the tests (`npm run test:bot`, `npm test`), does browser QA and any Higgsfield artwork.
- ChatGPT also edits this repo. Re-read a file before editing it, and preserve its changes.
- Report honestly: no live AI connection unless it has been verified. Manual and demo data stay labelled.

## Key files

| Area | Files |
| --- | --- |
| Shared model (pure) | `shared/bots-model.js`: roster, character styles, desk slots and `arrangeDesks`, `deskSeat`, `rugPlacement`, `layoutInput`, validation, performance, lessons, reports |
| Walk navigation (pure) | `shared/bots-nav.js`: floor polygons, obstacles, A* `findPath`, `entryFor`, `robotSpot`, `headingView` |
| Server | `server/bots-store.js` (atomic JSON store, schema 2, record-level shape checks), `server/bots-router.js` (`/api/bots/*`, owner-only, GET/POST only), `server/bots-demo.js` (in-memory demo) |
| Browser shell | `web/bots/index.html` (theme set before first paint), `js/app.js`, `js/lib.js` (`h`, `icon`, `formDialog`, `slider`, `actionMenu`), `js/theme.js` |
| Office scene | `js/scene.js` (stations from atlases, rug, annex floor, blink/typing), `js/walk.js` (walk-to-seat), `js/views/hq.js` (2D map, shared title/status/drawer), `js/views/hq3d.js` (3D office and the 2D/3D switch), `js/views/layout.js` (desk editor, ChatGPT's) |
| Other views | `js/views/overview.js`, `tasks.js`, `performance.js`, `learning.js`, `reports.js`, `connections.js` (ChatGPT's runtime and knowledge parts), `settings.js`, `js/bot-config.js`, `js/roster.js`, `js/skill-discovery.js` |
| CSS | `web/bots/bots.css` (theme tokens, light and dark), `config.css` (settings, cards, slider, menu), `layout.css` |
| Tests | `test/bots.js` (42 tests), `test/bots-bridge.js` (ChatGPT's), `test/smoke.js` (human app) |

## Done and in place

- **Screens:** Headquarters, Team overview, Task history, Performance, Learning, Reports, Connections and Settings.
- **Roster:** stored roster with add, edit, archive and restore, 10 character styles, stable desk slots and an annex that grows with the team.
- **Office scene:** composed from the modular Higgsfield atlases. Occlusion comes from layer order. Typing animation shows only for verified or demo bots; reduced motion is honoured.
- **Walk-to-seat (animation only):**
  - New or restored bots walk in from the door or the annex edge.
  - After a saved desk move, the bot walks from its old seat.
  - Walks resume or reroute after a redraw, and "Seat everyone" skips them.
  - A Settings toggle turns walking off.
- **Review fixes:**
  - Lesson validation counts the latest result per distinct linked task; unlinked trials are only notes.
  - Malformed nested records in the store are refused and the file is never overwritten.
- **Themes:** Light, Dark and System from the supplied palette (header toggle and Settings › Appearance). The artwork is unedited; dark mode dims it with CSS only.
- **Settings:** a two-pane "Bots" panel (list with On/Off sliders | prompt, guidelines and skills with slider and Actions menu), a template grid, Appearance next to Demo mode, and workspace facts in two columns.
- **Overview cards:** compact, with a Details dropdown, an On/Off slider and an Actions menu. The grid no longer overflows.
- **Layout editor:** the rug moves, rotates and resizes with its desk, and is mirrored for the `front_left` / `rear_left` views (`rugPlacement`, tested).
- **3D office (newest, untested):** Headquarters has a **2D | 3D** switch in its title bar, remembered per browser (`teamBot.hqMode`).
  - The 3D version (`js/views/hq3d.js`) is built like the human HQ: three.js r128 from the same cdnjs URL, loaded only when 3D is opened; box furniture, grass and trees, an orthographic camera you drag to turn, zoom and reset.
  - The bots are still the same bots, drawn as camera-facing sprites from `robot-seated.png` in their character hue. `seatedColumn()` in `shared/bots-nav.js` (tested) picks the sheet column from the camera angle. Idle, blink and typing frames follow the 2D rules.
  - Desks follow the stable desk slots (four per column, slot 0 by the team room). Positions from the 2D layout editor do not apply in 3D, so Edit layout is hidden there.
  - Same labels, status bar, drawer and open desk as 2D; the owner ("You") stands by the shared table. No walk-to-seat animation in 3D.
  - If three.js or WebGL is unavailable, the page offers the 2D map.
- **Skill source review (untested):**
  - Skills adapted from an outside catalog carry an owner-entered review: link, exact revision, license, files, required tools, adaptation, proposed test and result.
  - Only Ready lets the skill be on (`skillSourceInput`, `skillBlocker`).
  - The Find Skills starter starts off with a Needs tools review.
  - Copy to bot is now a server route that keeps `origin`, `source` and a `copied_from` record.
  - Runs skip blocked skills and log each skill's source revision.
- **ChatGPT's additions (keep these):** bot On/Off, prompts, skills with versions and copy, ten role templates, the Find Skills starter, the local CLI runtime bridge (`HQ_BOT_BRIDGE`, drafts only), Team Knowledge sync and import, the layout editor and auto-seat.

## Pending: ChatGPT to verify

- **Test run:** `npm run test:bot` and `node --test test/bots-bridge.js`. The newest tests are not yet confirmed: walk navigation (3), the rug rule (1), skill source review (2), three malformed-review store cases and the 3D column rule (1).
- **Browser QA:**
  - 3D office: switch to 3D and back; the choice survives reload.
  - Robots sit on their chairs in every direction. Turn the office a full circle: facing you, each robot is in front of its chair and behind its desk; facing away, it is in front of its desk and behind the chair back. If feet or depth look off, the tuning numbers are `ROBOT_SIZE` and the `F`/`P` offsets in `place()` in `hq3d.js`.
  - Tints match the 2D colours (canvas `filter`; untinted where a browser lacks it).
  - Labels follow robots while turning and zooming. Selecting a robot or label opens the drawer, and the camera keeps its angle.
  - Light and dark grass. Narrow (390 px) layout.
  - The load-failure message when offline.
  - Settings › Bots: add the Find Skills starter (it should start Off with a "Needs tools" badge and a disabled switch). Then Actions › Review source → Ready with a commit hash. The switch should enable. Copy it to another bot, then check the Source details on both.
  - Mirrored rugs line up with every desk view.
  - Card grid at 1440, 768 and 390 px.
  - The Actions menu works by keyboard and pointer.
  - Theme coverage across every view, dialog and editor.
  - The walk animation looks right: feet, cross-fade, reachable seats in a full room.

## Known limitations and next ideas

- **Walking floor:** the walkable outline (`ROOM_FLOOR`) is traced by eye, so some seats in a full room may be unreachable; those bots are seated directly.
- **Missing frames:** sit-down, turning and four-frame walk frames are specified in `design/MISSING-ANIMATION-FRAMES.md` but not yet generated.
- **Skills catalog:** in-app catalog search needs Vercel OIDC, which isn't configured. Source reviews are entered by the owner; nothing fetches the upstream file list or checks the revision. Publishing a reviewed adaptation as a proposed Team Knowledge note (step 3 in `CLAUDE-FIND-SKILLS-INSTRUCTIONS.md`) is not built.
- **Not built yet:**
  - teammate accounts and the contribution/approval flow;
  - a shared Obsidian vault connection for approved skills;
  - an independent desks collection, which would need a deliberate migration.
