# Independent review: Task 354 composer plan-save failure (draft PR #261)

Reviewed head `e097190` against `origin/dev`. Dev server on a private port (webpack, 3 GB cap, killed afterwards), dev Medplum :8113, fake data only.

## Verdict
Core fix is sound. One MAJOR gap found and fixed on the same branch (normal commit, no force-push). After the fix: **approve for merge** (still a draft; not merged by me).

## 1. Original bug reproduced on `origin/dev` composer
Ran the PR's `composer-plan.spec.ts` against `origin/dev`'s `order-composer.tsx`:
- Unstubbed route: passes. The server root cause ("Unable to detect a Project Id") is already gone on dev (U1b moved the plan store to Medplum). Agrees with `task354-composer-plan.md`.
- Stub 500 "Project Id" and 401 UNAUTHENTICATED: footer shows "Saved on this device only", so a real server rejection is disguised as an intentional local-only mode. Sign stays enabled.
- Generic failed add: item is rolled back (doctor's item vanishes). "Remove after failure" case also fails.

## 2. Fix confirmed on the PR branch
`composer-plan.spec.ts` 4/4, `save-state.spec.ts` 7/7. The footer shows "Failed to save" with Retry, the item stays, Sign is disabled, and Retry persists it across reload. Only explicit `persistenceAvailable:false` gives local-only. No error-text sniffing remains (`grep` clean).

## 3. MAJOR found: autosave false-positive remained (fixed)
Failed save of item A, then a successful save of item B: the success path did `publishPlan(server plan)`, which lacks A. A **disappeared from the screen while the footer still said "Failed to save"** (nothing visible to retry; same for a failed edit reverting to the server's old value). Probe failed on the PR head, passed after the fix.
Fix: `mergeUnsavedEntries(server, local, failedIds)` in `lib/plan-save-state.ts`, used by the save and delete success paths in the composer (failed adds are re-appended, failed edits keep the local version, removed entries are not resurrected). New unit tests (4) and e2e `composer-plan-unsaved.spec.ts` (fail A, save B, A stays, Retry persists both, survives reload).

## 4. Composer not broken
- Targeted e2e on the fixed branch: 12/12 (`composer-plan`, `composer-plan-unsaved`, `save-state`).
- Unit: 231 pass. `tsc`: no errors in touched files. ESLint on `order-composer.tsx`: identical rule counts to `origin/dev` (pre-existing, none new).
- No change to server routes, Firebase Storage, Lab/POCT, MC/referral documents, or navigation. No critical-result warning added.
- NOT run: full `check-all.sh` (build + whole suite); RAM is shared with production.

## Minor / not fixed
- If a retried write returns `persistenceAvailable:false`, the failed flag stays set while persistence is disabled (stuck "Failed to save" until Retry/reload). The route never returns that value today (only `true`), so unreachable; consider clearing `failedSaves` in the local-only branch if the route ever does.
- `save-state.spec.ts` and `lib/env.ts` default to `/workspace/...` paths; use `UCC_SAVE_SHOTS`, `UCC_EVIDENCE`, `UCC_REPORTS` on this VPS.
