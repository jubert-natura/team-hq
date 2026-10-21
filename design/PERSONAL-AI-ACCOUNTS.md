# Personal AI accounts and Human HQ identity

The shared app runs bot tasks through each person's verified OpenAI Responses API or Anthropic Messages API connection. It never dispatches through the owner's Codex or Claude CLI session. The older CLI adapter module remains for isolated tests and historical evidence; `server/index.js` does not construct it.

## Account setup

1. Configure real Human HQ integrations, `OWNER_EMAIL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, the matching Google callback URL and HTTPS deployment. Human HQ currently activates Google authentication when a real Slack or ClickUp integration and Google credentials are configured. Google login admits the owner and people matched to the Slack team. A shared `HQ_PASSWORD` is not an individual identity.
2. The owner opens `/bots/team.html` and explicitly approves an eligible real Human HQ teammate under Teammate access. Demo workers cannot be approved. Revocation blocks subsequent AI API and page access for that HQ session. Existing shared knowledge supplied to the provider cannot be recalled after dispatch.
3. Each approved teammate signs in through Human HQ and opens AI team. The browser uses the same HttpOnly, SameSite HQ session cookie at path `/`; no second email/password form or client-supplied identity is used.
4. Each person saves their own API provider, exact model ID and API key, then verifies it. Verification makes a small billable text request. An existing chat app session does not configure this connection. Model access, account billing and limits follow the API provider's account.
5. Create a task and explicitly run it. The server supplies that bot's approved prompt, enabled compatible skills and selected published Team Knowledge notes. Completed drafts stay Pending review until a person records a decision.

No personal keys, consumer OAuth registrations or Google configuration have been supplied in this preview. Account isolation and provider parsing are verified with simulated responses, not claims of live teammate/provider authentication. The loopback preview address is not a team deployment.

## Permissions

The owner controls bot configuration, availability, selected knowledge, skill promotion, layout, lessons, reports and member approval. Approved members can read shared bot configuration, create tasks and read/run/update/review their own tasks. Members cannot read legacy owner tasks or guess another member's task ID to operate on it. The owner sees workspace task history. Task authors, run initiators and reviewers are recorded independently.

Approval grants access to the bot instructions and selected shared notes used in that person's runs. GitHub repository access is separate: the server reads the fixed private repository, then sends only selected notes to the person's provider. For a hosted deployment, configure a dedicated repository-scoped read-only GitHub service credential rather than carrying the owner's desktop login to the host. No deployment or repository credential migration is performed by this change.

## Credentials and transport

`bot-personal-ai.json` and `bot-personal-ai.json.key` live beside `HQ_BOT_STORE` (default `data/`). AES-256-GCM encrypts each API key with the HQ email as authenticated data. Raw API keys are never returned by any endpoint. Provider URLs are fixed, redirects are refused, tools are omitted, error response bodies are not exposed, and verification requires a completed text response. A failed run clears that connection's verification; no fallback exists.

The browser holds a key only while submitting the form and clears the field immediately. The server stores only encrypted key material and safe provider/model/status metadata. The encryption key stays on the server; protect that directory with the host's account permissions. An administrator with both files can decrypt credentials. Back up the encrypted file and key together to protected storage. Missing keys, invalid ciphertext or malformed account storage prevent startup instead of overwriting the file.

Remote connection entry requires a real HQ identity and HTTPS. Local owner preview requires a loopback socket and loopback Host. `HQ_TRUST_PROXY` defaults to loopback; production proxy trust must match the hosting topology. POST endpoints require JSON and refuse cross-site requests. Credentials belong to the authenticated HQ identity, never an email supplied in the request body.

One task runs at a time in this version. An already dispatched provider request finishes if membership is revoked; revocation during note loading prevents dispatch. In-flight credentials cannot be changed. Provider requests time out after two minutes, use bounded text output, and save the provider, model, runner and pinned skill/source evidence. Owner-selected GitHub notes continue to refresh at task start; official publication and skill promotion remain manual.

## Validation

`npm run test:bot` includes encrypted storage recovery/tampering, fixed provider requests, sanitized failures, active-request guards, shared HQ session helpers, two-person task ownership, approval/revocation, demo restrictions, and no CLI fallback. `npm test` verifies the existing Human HQ workflow using fake Slack and ClickUp servers. Real Google login and each live API account must be verified once configured.
