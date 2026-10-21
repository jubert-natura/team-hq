# Shared knowledge and AI runtime

## Daily use

1. Edit approved team material in the official Team Knowledge Obsidian vault. Review `git status` and `git diff`, then commit and push approved changes to private `natura-hq/team-knowledge`. This publication step stays manual, matching the repository's contribution rules.
2. Open Team Bot → Connections → Sync published notes. This verifies private visibility, reads a commit-pinned tree and checks the configured local vault's Git metadata. The model never receives the vault directory or GitHub credentials.
3. Under a bot, choose a published note and Use as context. Up to five selected notes are refreshed automatically at the beginning of each task. Unpublished edits are not read.
4. For an approved, complete instruction note, choose Preview / import skill → Approve and import as skill. Toggle or edit it in that bot's Settings. Imports are pinned; importing a changed source explicitly creates the next reviewed version. Images, scripts and links are not automatically imported.
5. Assign a task with clear acceptance criteria. In Task history select Run with the configured provider. The draft, source paths/revisions and enabled skill versions appear in the task details. Execution completion requests review; it never records a passing review automatically.

## Current personal-account runtime

The shared application now uses each HQ person's own verified API connection. See [Personal AI accounts](PERSONAL-AI-ACCOUNTS.md) for sign-in, access approval, encrypted credential storage and deployment requirements. `HQ_BOT_BRIDGE=true` enables the fixed GitHub knowledge reader. `HQ_TEAM_VAULT` names only the official shared Git checkout; `HQ_GH_BIN` resolves GitHub CLI. No CLI AI adapter is constructed by the application, and no missing personal connection falls back to the owner.

## Earlier local CLI configuration (historical)

`HQ_BOT_BRIDGE=true` enables the local owner bridge. `HQ_BOT_RUNTIME=claude` uses Claude Code; `codex` uses Codex CLI. `HQ_TEAM_VAULT` names only the official shared Git checkout. Optional `HQ_GH_BIN`, `HQ_CLAUDE_BIN` and `HQ_CODEX_BIN` resolve installed executables. Restart the server after changes. Private configuration and bot data are ignored by Git.

GitHub uses the existing `gh` login for fixed, read-only repository calls. No token is copied into this app. This is not a dedicated restricted service identity: a hosted deployment needs a repository-scoped service account. Personal teammate access is implemented separately as described above. Never publish private knowledge or data files to the public application repository.

Claude Code runs with built-in tools disabled, an empty strict MCP configuration, slash skills disabled, hooks disabled and no session persistence. Codex uses ignored user config, read-only execution, disabled shell, apps, hooks, delegation, browser, skill search and local-image attachment, with web search disabled. The runtime receives the task, role/prompt/design instructions, enabled skill text and selected published notes. It has no Team Knowledge filesystem or personal Obsidian MCP connection. Source text is treated as reference material. CLI authentication remains on the owner machine.

Only one job runs at a time. A failed connection creates a blocked task with a retryable error. A restart marks unfinished work interrupted. Prior run evidence is retained when retrying. Changes to active execution/review are refused while a job is running. Draft output is rendered as plain text.

## Current boundary

Publishing from Obsidian remains manual. Context refresh at task start is automatic. Skill promotion and human review remain explicit. This is a draft-generation integration with approved teammate access; it does not perform autonomous daily learning or external actions. The Find Skills catalog links work; authenticated catalog search and complete executable skill packages are separate work described in `CLAUDE-FIND-SKILLS-INSTRUCTIONS.md`.

## Official runtime references

- [Claude Code CLI](https://code.claude.com/docs/en/cli-reference)
- [Codex CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
- [GitHub Git trees REST API](https://docs.github.com/en/rest/git/trees)
