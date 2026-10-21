# Claude: Team Bot skill discovery and shared knowledge

Work in the existing Team-Bot-HQ project. Preserve the current roster, tasks, stable desks, animation, themes and original Higgsfield assets. Coordinate edits with ChatGPT; inspect current files before changing them.

## Product goal

Give each bot a growing, reviewed library of reusable instructions. The canonical team copy belongs in the **Team Knowledge** Obsidian vault and its private GitHub repository. Personal Noah and its MCP connection must remain separate.

Use [Vercel Labs find-skills](https://github.com/vercel-labs/skills/blob/main/skills/find-skills/SKILL.md) as the discovery workflow. Clarify the missing capability, browse the catalog, and search with specific terms when needed. Verify the complete source before suggesting adoption; popularity is one signal, not proof of correctness. Present the relevant alternatives and their sources. If none fits, propose a narrowly scoped team instruction instead.

## What is implemented now

- Bot Settings has Browse skills catalog and Add Find Skills starter. The starter is editable text with upstream attribution, not an executable installation.
- Connections synchronizes eligible Markdown paths from private `natura-hq/team-knowledge`. The backend uses a fixed repository through authenticated `gh api`; it does not pass GitHub credentials to the model or browser.
- A bot can select up to five context notes. These load from the latest published commit at each run. Drafts, Inbox, submissions, chat sessions, hidden paths, symlinks and RASPHIL paths are excluded.
- Preview / import skill approves one complete instruction note. Imports retain repository, path, commit and blob hash. Reimport creates a new reviewed version. Source edits do not silently replace active skills.
- Tasks have an actual Run button and a draft output, source citations, skill versions and timeline events. Review remains human. Disabled skills are omitted and disabled/archived bots cannot start new runs. Server restarts mark unfinished jobs interrupted.
- **Source review (Claude, awaiting ChatGPT test run and browser QA):** a skill can carry an owner-entered review of its upstream source: link, exact revision, license, file inventory, required tools, adaptation (instructions only, or relies on scripts/supporting files), proposed test and result. Rules are `skillSourceInput` / `skillBlocker` in `shared/bots-model.js`. Ready requires a commit hash or release tag, a license, a test, instructions-only adaptation and no required tools; anything else keeps the skill off and the enable route refuses it. Routes: `POST /roster/:id/skills` accepts an optional `source`; `POST /roster/:id/skills/:skill/source` records, updates or removes (`remove: true`) a review; `POST /roster/:id/skills/:skill/copy` copies on the server with `origin`, `source` and a `copied_from` record. Runs exclude blocked skills and save each skill's source URL, revision and license. The store refuses malformed reviews. The Find Skills starter saves with a Needs tools review, so it starts off. Nothing is fetched or installed (step 2 below is covered as owner-entered metadata; automatic file inventory needs a fetch backend).
- The local bridge supports Claude Code and Codex. `HQ_BOT_RUNTIME` selects the actual provider for every bot role; names and avatars do not select providers. Codex is the current fallback because Claude Code's live request returned an invalid OAuth token. Opening Claude desktop does not repair CLI authentication.

## Next discovery implementation

1. Keep catalog discovery separate from installing executable packages. Do not run browser-supplied shell commands. The [documented skills.sh API](https://skills.sh/docs/api) needs Vercel OIDC; show a configuration-required state until that backend identity exists. Catalog browsing works without that integration.
2. Show a candidate preview containing its exact upstream revision, license, full file inventory, required tools/dependencies, expected outputs and a proposed test. Preserve source notices when copying. Files such as scripts, examples and references are part of compatibility review; importing only SKILL.md must not claim the full package works.
3. A reviewed text-only adaptation can be saved as a proposed Team Knowledge note. The owner reviews the diff and publishes it through the existing Git workflow. Keep Issue submissions and untested suggestions separate from official instructions.
4. Import the published note into selected bots. Start disabled when compatibility or required tools remain unresolved. Owner approval of text does not grant external-action permissions.
5. Keep the enabled version stable during a run. Save task/run ID, actual provider, prompt configuration, source commit and skill version. Later updates need preview, diff and a new reviewed version; old run evidence remains attached.
6. Validate on a meaningful task before describing an improvement. Team corrections should become proposed lessons, then tested instruction changes. This updates instructions; it does not train the underlying model.

The current runtime is deliberately text-only. A Find Skills instruction cannot browse the web or install packages inside it. Do not claim autonomous discovery, image generation, file editing or deployment until a permitted tool adapter actually executes and records the action.

## Acceptance checks

Demonstrate: browse candidate → review complete source → publish approved instruction → import to one bot → run a relevant task → see the exact version and cited note → human review. Also check an off skill, a missing dependency, an inaccessible source, a failed run, a concurrent run, demo isolation and non-owner access. Keep the existing regression suite passing. Use Higgsfield if additional artwork is actually needed.
