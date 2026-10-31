# Changelog

## Unreleased (ai-work)
- fix(security): /api/labs/receive and /api/imaging/receive fail closed without a valid x-api-key (timing-safe), no error details in 500s; lab result without status defaults to final, invalid status -> 400. Set POCT_API_KEY / PACS_API_KEY on every server before deploying.
- fix(composer): items added before the saved draft finished loading were wiped when it loaded; hydration now merges (your items win, deleted items stay deleted) and resets cleanly when the draft changes.
- fix(composer): when the Firebase plan API is unavailable ("Unable to detect a Project Id"), the plan route returns persistenceAvailable:false instead of 500; composer switches to on-screen-only mode, shows "Not saved to server – this draft is only on this screen until you Sign.", ignores late server responses, and shows clear messages/toasts on real save/load failures. (Follow-up race fixed in the next entry.)
- chore(e2e): idempotent local seed for 4 clinics (5c60391).
- chore(ai): AGENTS.md, .ai/ workspace, e2e suite + check-all gate (ad24db1).
