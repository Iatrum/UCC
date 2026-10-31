# Changelog

## Unreleased (ai-work)
- fix(composer): when the Firebase plan API is unavailable ("Unable to detect a Project Id"), the plan route returns persistenceAvailable:false instead of 500; composer switches to on-screen-only mode, shows "Not saved to server – this draft is only on this screen until you Sign.", ignores late server responses, and shows clear messages/toasts on real save/load failures. Known gap: e2e probe 05 still sees the added item disappear (suspected hydration effect re-running and re-publishing initialEntries) – follow-up.
- chore(e2e): idempotent local seed for 4 clinics (5c60391).
- chore(ai): AGENTS.md, .ai/ workspace, e2e suite + check-all gate (ad24db1).
