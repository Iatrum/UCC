# Review of Task 500 (PR #286, branch ai/task-500) — Task 501

Verdict: **APPROVE** (after one small fix pushed to the branch).

## Checks run (one dev server on :3501, timeout-wrapped, killed afterwards)
- `bun run lint` (tsc + clinic-admin guard): pass. `tsc --noEmit`: pass. `bun test tests/unit`: 551 pass / 0 fail.
- New specs: `purchases-scope.spec.ts` 5/5, `dispense-checkout-ui.spec.ts` 4 pass + 1 intentional skip (#279 still open). Re-run after fix: pass.

## Findings
- Determinism: no fixed sleeps; only web-first assertions and `waitForURL`. Serial mode within a file is used for the shared fixture chain; each file creates and removes its own data, no dependence on other specs or run order. OK.
- Real behaviour: stock asserted before view (10), after checkout (10-4), inventory page cell, exactly one `completed` MedicationDispense with stockAfter, and no second deduction on re-POST. Purchases: list contains own PO only, foreign/non-PO/missing id 404 with no clinic leak, foreign resource versionId unchanged, anon 401/403. OK.
- Secrets / patient data: fake names/NRIC only, no credentials in specs. OK.
- App behaviour: no app code changed (only 2 specs + research note). OK.
- Fixed: the Encounter created directly in `beforeAll` was never deleted; `afterAll` now removes it.
- Notes (not blocking): purchases write cases assert the 403 "disabled" contract while `INVENTORY_PURCHASING_ENABLED=false`; the enabled branch is untested until the flag flips. The skipped RM 0 test should be enabled when #279 merges. The branch is behind `dev`; GitHub reports it mergeable.
