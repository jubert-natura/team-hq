# User steering: light and dark modes

The user explicitly requested both themes and supplied this palette: Near Black #111111; Dark Grey #262626; White Grey #D2D2D2; True White #FFFFFF; Bright Mint #75FFE6; Dark Mint #45A593; Cool Azure #5566FF; Dark Azure #242E8E; Light Peach #FFB1B1; Dark Peach #FF8888.

Implement a polished light theme and dark theme across every view, dialogs, search, tables, forms, HQ drawer, status cards and focus states. Use CSS variables and derived tints as needed for contrast. Keep the Higgsfield artwork original and use theme-aware framing; no new generation or image editing. Persistent accessible theme toggle in header, Light/Dark/System selector in Settings. Default follow OS, honor saved preference in localStorage, and respond to OS theme changes while System is selected. Apply before first paint to avoid theme flash. Scope to /bots/ only. Theme must persist after reload and route changes. Make plain product copy; avoid server paths/env variable names and implementation jargon in Settings or HQ unless useful to the user's immediate decision.

# ChatGPT review findings to fix alongside the theme

1. A regression is reproduced in work/bot-model-review.mjs outside the repo: lessonEvidence currently counts an older pass even when the same linked task has a later failing result. With five tasks passed, task A later failing, task E passing again, passes must be 4 and canValidate false. For the current instruction version, count each linked task using its latest trial result only. Trials without a linked task can be kept as notes but must not satisfy the five-distinct-task validation gate. Make the UI requirement clear and add regression coverage to test/bots.js. Keep demo fixture compatible (validated example needs five distinct task IDs).

2. bots-store checkShape only checks top-level arrays. Valid JSON with schema 1, seq 0, tasks:[null], lessons:[], reports:[] is corrupt but is accepted and could later be overwritten. Validate stored record shapes (including nested arrays and essential field types/enums/IDs) before accepting real data. Reject invalid shape visibly and preserve file bytes. Add a meaningful regression for malformed records, not just malformed JSON.

Existing bot suite was run by ChatGPT: all 18 tests pass. Independent model checks pass except finding 1. Please implement themes and these fixes using file tools only. ChatGPT runs all tests and browser QA. Do not execute commands, use external services, push, deploy or create new image generations.
