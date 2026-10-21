# How to use Team Bot

Your practical guide to assigning work, using shared knowledge and improving bot instructions.

## Start with one useful task

The daily flow is **choose a bot → select notes and skills → assign a task → run → review**. A task is saved when you create it; the AI starts only after you click its Run button.

This version produces text drafts. Good first tasks include checklists, summaries, briefs, proposed code and reviews of supplied text or code. Keep the dashboard server running on this computer while using it.

## 1. Choose a bot

Open [Settings](http://127.0.0.1:4318/bots/#/settings) and select a bot. Turn its availability switch **On**. An off or archived bot cannot receive new work; its history stays saved. Turning a bot off does not cancel a run already started.

Each bot has its own role, prompt, design guidance, skills and task history. Your tasks use your verified personal API provider and model. A bot named Claude can use your OpenAI connection; its name and avatar do not select the provider. The owner manages bot availability and shared instructions.

Approved teammates use the same Human HQ sign-in session and shared bot roster. They open **AI team** from Human HQ to reach their personal task workspace. Members see their own tasks; the owner can see workspace history and manages shared configuration. Sign-in does not create another roster or connect an AI account.

## 2. Check the connection

Open [My AI connection](http://127.0.0.1:4318/bots/team.html). Check the displayed HQ identity. Choose **OpenAI** or **Claude / Anthropic**, enter the exact model ID from your provider console and your own API key, then click **Save my connection**. Click **Verify my connection** to make a small, billable API request. Tasks become runnable only after verification. Changing the key, provider or model clears verification.

Keys are encrypted on the HQ server and are never returned in API responses, stored in browser preferences, or included in task prompts. Each person's connection is separate. **Disconnect** removes the saved connection; revoke the key in your provider console if you no longer need it. HQ never falls back to the owner's terminal login.

Opening ChatGPT or Claude does not configure this API connection. API access follows the provider's billing and model permissions; check your console even if you have a chat subscription. This version uses personal API credentials and does not implement a consumer-account OAuth connection.

The owner approves eligible people under **Teammate access** on the same page. This requires working Google sign-in in Human HQ and the real team roster. A shared password or local preview cannot distinguish teammates. The current local preview has no Google sign-in configured, so teammate approval remains disabled. Team access also grants the bot access to its owner-selected shared knowledge for that person's tasks.

The owner uses **Sync published notes** in Connections to list eligible Markdown from private Team Knowledge. If edits exist only in Obsidian, review, commit and push them to GitHub first. Sync does not publish local edits.

Use your real workspace for live work. **Demo mode**, under Settings, contains sample records and cannot run the live AI.

## 3. Give the bot useful knowledge

The owner chooses a shared note under each bot on Connections and clicks **Use as context**. Select up to five relevant notes and remove ones unrelated to the bot's work. Members use these approved selections.

**Context** supplies facts or reference material. **Skills** supply repeatable working instructions. For example, a brand guide can be context; a checklist for reviewing brand copy can be a skill.

Selected context refreshes from the latest published commit whenever a task starts. The bot does not read every note in the vault. Links inside notes, images, attachments and optional reference URLs are not automatically fetched.

## 4. Add or enable skills

For your own instructions, open the bot's Settings, choose **Add skill**, enter a name, when to use it and the steps, then save. Turn the skill **On** when you want it included in a run.

For an approved Team Knowledge instruction note, use **Preview / import skill** on Connections. Read the full preview, then choose **Approve and import as skill**. Its source revision is retained. Later note edits require another reviewed import; syncing context alone does not update a pinned skill.

The runtime includes enabled, compatible skills and records their versions. Start with one or two relevant skills so instructions stay focused.

**Find Skills:** use the catalog link in bot Settings to discover candidates. Review the complete source, exact revision, license, supporting files and tool requirements. Record the source review. Catalog skills stay off until their review is Ready. Current AI runs cannot browse the catalog, install packages or execute a skill's scripts. A saved Find Skills instruction does not enable those capabilities.

## 5. Assign and run a task

Teammates open [My AI connection and tasks](http://127.0.0.1:4318/bots/team.html) and use **Give a bot a task**. The owner's Task history also has **Assign task**. Complete these fields:

- **Title:** the specific result you want.
- **Assigned bot:** an available bot.
- **Project:** a useful grouping for the work.
- **Acceptance criteria:** the full brief, facts to use, output format, length and how you will judge success. This field is also the task's instruction; there is no separate chat box.
- **Output link:** optional; leave blank unless a real link already exists.

Click **Create task**. It starts **Queued**. Click **Run with my AI account** in your personal workspace, or the displayed provider in the owner's task details. You should see **In progress**, then **Completed / Pending review** when a draft arrives. This version processes one task at a time; it asks you to retry if another task is active. Provider verification requests use each person's own connection.

Office walking is visual animation. Real execution is established by the task's runtime status, timeline and returned output.

## Try this example

Ask the owner to select **Home.md** and **CONTRIBUTING.md** as context for the available bot, and enable **Knowledge answer with sources**. Our earlier guided example used Claude / Builder through the owner's local Codex connection. New tasks use your personal API connection.

**Title:** First bot task: team knowledge checklist

**Project:** Team Bot getting started

Paste this into **Acceptance criteria**:

```text
Create a friendly checklist for a new teammate explaining how to contribute a correction or new knowledge. Use only the selected Home.md and CONTRIBUTING.md notes. Give 5 clear steps, explain who approves official changes, and state what happens after a suggestion is submitted. Cite the note paths supporting the answer. Keep it under 220 words, identify anything not specified, and label it Draft for human review. Do not submit an Issue or publish anything.
```

Create the task, run it and compare the result with the two source notes. This example drafts instructions; it does not submit anything to GitHub.

## 6. Review the result

Read the draft in your personal task history, or under **AI runtime** in the owner's task details. Check its facts, completeness, source links and recorded skill versions. **Completed** means the AI returned a draft; **Passed** is a separate review decision.

Choose **Passed** only after reviewing the result. Choose **Changes** to record a specific correction and, optionally, a reusable issue label. Adding a review note does not automatically start another AI run or change a skill.

For a revision, create a new task containing the correction and a short excerpt of the previous answer when needed. Include the relevant notes again. Each run is a fresh request: task notes, previous answers and other bots' outputs are not automatically passed to it.

You can select and copy the draft text. **Export** in Task history downloads the task records, including saved runtime output. Keep exported records with the intended audience.

## Improve bots over time

Record the observed problem and the specific correction in **Learning history**. Propose a focused instruction change, test it on comparable tasks, and review the evidence before adopting it. Lesson validation requires passing evidence from five distinct linked tasks on the current instruction version. Unlinked trials are notes rather than validation evidence.

The owner can publish an approved skill note to Team Knowledge and explicitly import the new version into the chosen bots. Saving a lesson does not automatically update their skills or train the underlying AI model.

## Where to find things

- **Headquarters:** office view, bot selection and layout.
- **Team overview:** roles, availability and current recorded work.
- **Task history:** create tasks, run the AI, read drafts and record reviews.
- **Performance:** metrics derived from recorded work and reviews.
- **Learning history:** proposed instructions, trials and evidence.
- **Reports:** summaries and suggested improvement tasks.
- **Connections:** provider verification, published-note sync and skill imports.
- **Settings:** bot prompts, skills, On/Off, theme and demo mode.

## If something does not work

- **No bot in the assignment list:** turn one on and make sure it is not archived.
- **Run is disabled:** check bot availability, demo mode and whether another request is active. A completed or cancelled task cannot be started directly; create a follow-up task, or deliberately reopen work using its execution control.
- **Task says In progress but has no active runtime run:** the status may have been recorded manually. Recording an execution status does not start the AI.
- **Blocked or interrupted:** read the runtime error. Resolve the connection, missing note or instruction-size issue before retrying. Check for an active job before restarting the server.
- **Claude or ChatGPT is open but HQ is disconnected:** open My AI connection and save and verify your own API key. The chat app's session is separate from this API connection. Check the exact model ID, API account access and billing if verification fails.
- **A note is missing:** publish approved changes, sync again and check the eligible-path rules. Hidden paths, Inbox, drafts, submissions, chat sessions and RASPHIL paths are excluded. The personal Noah vault is separate.
- **The answer lacks evidence:** select the relevant note and put a clear citation requirement in the acceptance criteria. The current runtime cannot browse for missing facts.

## Current scope

Live tasks return drafts for review. They do not publish notes, send messages, execute code, deploy changes or generate images. They can prepare an asset brief for a separate Higgsfield workflow. Publishing from Obsidian, promoting skills and approving work remain explicit actions.

The personal connection flow and account isolation have been verified with simulated provider responses. A real teammate's Google session and live API key must still be verified when those accounts are configured. The preview address on this computer is not a shared deployment.
