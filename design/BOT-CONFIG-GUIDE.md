# Bot roles, switches and skills

Open **Settings** in the AI workspace.

## Add another role

The Bot role library has ten templates: Planner, Builder, Researcher, Reviewer, Designer, Writer, Analyst, Knowledge Keeper, Automation and Project Coordinator. Choose **Add [role]**, review the name, prompt and design guidelines, then **Add bot**. **Create custom bot** accepts any other role. Templates do not replace the four existing bots or connect providers.

## Turn bots on or off

Use the **On/Off** switch on Team overview, in a Headquarters bot drawer, or under Settings → Bot availability. Off blocks new tasks and improvement-task creation, preserves the desk, skills and history, and stops that bot's scene animation. It does not cancel a job in an external app. Turn it on again to accept new assignments. Availability and a verified AI connection are separate states.

## Add a skill

1. Choose **Skills** on a bot card, or **Settings → [bot] → Prompt & skills**.
2. Choose **Add skill**, or choose a starter such as Weekly project update.
3. Enter the skill's name, **When to use**, and **Instructions**. Paste Markdown from an existing SKILL.md if useful. Include the required inputs, ordered steps, expected output, checks and approval rules.
4. Optionally add a full http(s) SOP/reference link, then choose **Add skill**.

Each skill has its own switch and editable instructions. Editing increments its version. **Copy to bot** creates an independent copy on another bot, with its source review and Team Knowledge revision, and records which skill and version it came from; later edits do not update the copy. Switch a skill off to keep its instructions for later. The optional link is saved but not fetched, and grants no access.

Example:

Name: Weekly project update

When to use: When preparing our weekly project report.

Instructions:
- Read approved project notes and recorded tasks.
- Summarize completed work, current work, blockers and next steps with owners.
- Cite source notes and tasks; label missing information.
- Return a concise draft for human review before sharing.

## Find more skills

Each bot's skill panel now has **Browse skills catalog** (skills.sh), **Original Find Skills** (the Vercel Labs source), and **Add Find Skills starter**. The starter opens a populated review form; it is saved only when you submit it. Use the catalog to choose a skill, inspect its source and requirements, then add its reviewed instructions with their reference link. Complete skill packages may also require scripts or tools that the bot runtime must support.

**Source review.** A skill adapted from an outside catalog can carry a source review (Actions › Add source review). It records the source link, exact revision, license, the package's files, required tools, what was adapted, a proposed test and the result: Not reviewed, Ready for text-only use, Needs tools or Not compatible. Only **Ready** lets the skill be switched on, and Ready needs a commit hash or release tag (not a branch), a license, a proposed test, instructions-only adaptation and no required tools, because the runtime runs text only. Saving any other result switches the skill off. The Find Skills starter is saved with a Needs tools review (it needs browsing), so it starts off. The app does not fetch the source or install anything; the review is what the owner checked. Team Knowledge imports keep their pinned revision instead and do not take a source review. A run records each skill's version and source revision.

The custom dashboard has no in-app catalog search, CLI installer or executable-skill loader yet. Its links and discovery starter do not connect a runtime or automatically fetch Obsidian notes. The Claude handoff records the next integration steps.

## Prompts and design

Choose **Edit prompt & design** to change role instructions, brand colors, design references and output expectations. Prompts, design guidance, skills and availability are stored with the bot. Real changes survive a server restart; demo changes stay in server memory only.

## Current execution limit

This feature saves configuration and controls assignment eligibility. The workspace still has no AI runtime adapter. Turning a bot or skill on does not install software, grant tool permissions, dispatch AI work, ingest the vault or connect a provider. A runtime must later read these saved instructions and apply the enabled skills during execution.

Validation: 29 bot tests and the existing smoke suite passed. Browser checks used an isolated localhost preview and demo data to add a Writer from a template, add a starter skill, and toggle bot/skill availability independently. No production team data was modified by those checks.
