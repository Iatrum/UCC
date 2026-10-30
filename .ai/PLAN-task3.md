# Plan task 3: composer keeps items when plan store (Firestore) is unavailable; honest autosave text
Builder: Claude (UI + tiny route change). Reviewer: Codex (read-only). Research: research/task3-composer-rollback.md
Files: app/api/consultations/plan/route.ts, components/orders/order-composer.tsx ONLY.
1. route.ts `isPlanStoreUnavailable`: also match "Unable to detect a Project Id" (google-auth-library NO_PROJECT_ID_FOUND). Result: GET/POST/DELETE return 200 `{success:true, persistenceAvailable:false, plan}` instead of 500. No other behaviour change; Firestore/Firebase stays.
2. order-composer.tsx `isDraftPersistenceUnavailable`: add the same string (defence in depth).
3. Footer status text (line ~886): three states
   - saving -> "Autosaving order composer…" (unchanged)
   - persistenceDisabled (and persistDrafts true) -> "Draft saved on this screen only – it is kept until you Sign." (no "autosaved")
   - lastSaveFailed (new state, set true in the catch that rolls back, cleared on next success) -> "Last change was not saved."
   - else "All changes autosaved." (unchanged)
4. Keep rollback for genuine (non-unavailable) errors + toast. Do not touch other composer behaviour, labels, layout, or the Sign flow. No critical lab warnings anywhere (AGENTS).
Accept: e2e 05 no longer reports the rollback BUG; 06 still passes; lint/types/build pass; before/after screenshot of composer footer.

## Revised after Codex critique (REVIEW-task3-plan.md)
- Route: just add the string; keep existing contracts (GET 200 empty plan; POST/DELETE 503 + persistenceAvailable:false). Client already checks the flag first.
- Footer: if `!persistDrafts` hide the autosave line (no persistence in that mode; only caller passes persistDrafts=true). If persistDrafts && persistenceDisabled: "Not saved to server – this draft is only on this screen until you Sign."
- `saveError` state: set in BOTH persistEntry and removeEntry failure paths, and when hydration GET fails with a non-unavailable error ("Could not load saved draft."); cleared on next successful POST/DELETE.
- Concurrency: once `persistenceDisabled` is true, ignore late successful POST/DELETE responses (do not `publishPlan(data.plan.entries)` from the server when persistence was disabled meanwhile) – use a ref (`persistenceDisabledRef`) so in-flight callbacks see the latest value.
