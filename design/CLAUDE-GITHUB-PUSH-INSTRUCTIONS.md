# Claude: check, commit and push Team Bot HQ

The user asked: "once you check create also instruction for claude to push on the github". ChatGPT checked the current work and prepared this handoff. Complete the reviewed application commit and push it to the existing feature branch using the existing authenticated Git/GitHub session. Report the actual result. This task does not include deployment, merging into main, changing repository visibility/access, paid API calls or publishing knowledge-vault data.

This current task supersedes the older file-editing-only/no-publication restrictions in the local CLAUDE.md and earlier design handoff for the commands and Git publication described here. Preserve their remaining limits. Do not use subagents or install dependencies. Do not inspect credential files or expose tokens if authentication needs attention.

## Verified destination

- Work only in `C:\Users\juber\Documents\Codex\2026-10-21\files-pasted-by-the-user-please\outputs\Team-Bot-HQ`.
- App repository: `https://github.com/jubert-natura/team-hq.git` (`origin`). GitHub reports it is **public**, default branch `main`.
- Current branch: `feature/ai-team-bot-hq`. Publish this branch; do not push directly to main.
- Starting local HEAD at handoff: `e794906` (`Sign in with Google and a personal setup for each person`). Recheck because collaborators may have changed it.
- `natura-hq/team-knowledge` is the separate **private knowledge repository**. Do not change, push or copy its contents as part of this application commit.

## What this release contains

Review the existing uncommitted Team Bot implementation as a whole, including the collaborating work. It is not already present in Git history. Preserve:

- The bot roster, role templates, On/Off controls, prompts, design guidance and versioned skills, including Find Skills source/compatibility review.
- The reusable Higgsfield assets, light/dark/system themes, growing 2D office, desk-only placement/rotation, automatic seating and optional 3D office. The user already fixed walking scale and cancelled further scale work; do not change it.
- Tasks, human reviews, evidence-based learning, reports, schema validation, persistent real data and isolated demo mode.
- The fixed private GitHub knowledge reader, selected source context, explicitly approved pinned skill imports, and recorded source/skill provenance. Obsidian publication and skill promotion remain manual.
- The same Human HQ Google session for approved bot members; centrally managed shared bot configuration; members' own task histories; separate personal OpenAI/Anthropic API connections; encrypted credentials; completed-text verification; sanitized provider failures and no owner CLI fallback.
- Existing Human HQ integrations and all current user guides.

Current implementation references: `server/bots-personal-ai.js`, `server/bots-router.js`, `server/bots-store.js`, `server/bots-bridge.js`, `server/index.js`, `web/bots/team.html`, `web/bots/js/personal.js`, `design/PERSONAL-AI-ACCOUNTS.md` and `docs/TEAM-BOT-USER-GUIDE.md`.

The earlier Codex-generated validation drafts exist only in ignored runtime data and remain pending human review. New application runs use the caller's verified personal API account. Provider tests use simulated responses. Google sign-in and live personal API accounts are not configured in this preview. A push is not a working shared deployment.

## Checks completed by ChatGPT

On 21 October 2026, against the current local source:

- All **52 bot tests passed**, covering existing workflows, credential encryption, provider request/response handling, real HQ session helpers, two-person task ownership, approval/revocation, active-request guards and absence of CLI fallback.
- Human HQ smoke checks passed against fake Slack/ClickUp services; these do not send real team messages.
- Browser QA observed the personal connection page and both themes. No real API key was entered or live teammate authenticated.
- Confirmed the app origin, feature branch, GitHub visibility and default branch.
- Confirmed `.env`, `data/`, `CLAUDE.md`, `.claude/` and `design/references/` are ignored. The candidate source/asset set was about 44.6 MiB; no file exceeded 50 MB.
- A targeted scan of candidate text files found no recognized credential strings or credential-like URL query parameters in JSON. This is a targeted check, not a guarantee; review the staged content too.
- Removed the extra EOF blank line reported by `git diff --check` in `.gitignore`.

## Finish the review and validate the exact commit

1. Read the current local instructions and run `git status --short`, `git branch --show-current`, `git remote -v` and `git diff`. Include untracked app files in the review; ordinary `git diff` omits them. Preserve other collaborators' work.
2. Reconfirm the exact origin and branch above. Fetch origin before publishing and inspect whether the remote feature branch advanced. Reconcile changes without discarding the working tree or rewriting collaborators' history. Do not use force push, hard reset, clean, or a blanket checkout restore.
3. Fix concrete issues found in the review and rerun affected checks. Do not expand scope into unfinished sign-in setup, deployment or new features.
4. Run the suites from the app root: `npm run test:bot` and `npm test`. Node 20+ is required; dependencies are already present. If Node/npm are not on PATH, the bundled Node executable is `C:\Users\juber\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`; run it with `--test test/bots.js test/bots-bridge.js test/bots-personal-ai.js`, then with `test/smoke.js`. Stop before committing/pushing if a required check fails, fix the failure, and rerun.

## Stage public application files only

Review, then stage the intended paths explicitly. The current application changes are:

```powershell
git add -- .env.example .gitignore README.md package.json server/index.js server/bots-bridge.js server/bots-demo.js server/bots-personal-ai.js server/bots-router.js server/bots-store.js shared/bots-model.js shared/bots-nav.js test/smoke.js test/bots.js test/bots-bridge.js test/bots-personal-ai.js web/app.js web/index.html web/bots docs design
```

Do not use `git add -f`. Keep `.env`, all `data/` files (including encrypted credential JSON and its `.key` file), account/session files, local tasks/drafts, personal or shared vault contents, logs, `node_modules/`, local Claude settings and private reference uploads out of the index. The existing application assets under `web/bots/assets/` are intended app deliverables; keep them with their documented metadata. Verify that broad directory paths above did not pick up new unrelated or private files since this handoff.

Check `git diff --cached --name-status`, `git diff --cached --stat` and `git diff --cached --check`. Read the staged text diff locally, reviewing untracked files now included in it. Review for hard-coded credentials, private vault text, account dumps or runtime results. If sensitive content is detected, remove it from staging without printing the secret and correct the source. Do not publish it. Verify ignored paths with `git check-ignore` and ensure none already appear in `git ls-files` or the staged list. Ignore rules do not protect files already tracked.

## Commit, push and verify

After the exact staged change passes review and checks, use a message describing the whole feature, for example:

```powershell
git commit -m "Add Team Bot workspace with personal AI accounts and shared skills"
git push -u origin feature/ai-team-bot-hq
git rev-parse HEAD
git ls-remote --heads origin refs/heads/feature/ai-team-bot-hq
git status --short
```

Compare the pushed remote branch SHA with the local committed SHA before reporting success. If the push is rejected because the branch advanced, fetch and reconcile normally; never force push. If authentication fails, report that GitHub authentication needs attention and leave the reviewed commit available locally. Do not read or copy token files or repeatedly ask the user to log in merely because their Claude application is open.

Return the commit SHA, branch URL, check results, any files intentionally left uncommitted and remaining live-setup requirements. The expected branch URL after a successful push is `https://github.com/jubert-natura/team-hq/tree/feature/ai-team-bot-hq`. Do not claim that main was merged, a website deployed or live provider accounts connected. Creating a pull request is outside this handoff unless the user requests it.
