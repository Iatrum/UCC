# Review: Task 394 conflict-resolution merge on PR #261 (Task 395)

Reviewed commit `4d14512` ("Merge origin/dev into Task 354 branch"), parents `b4cbe7c` (Task 354 side) and `e6c8278` (dev, incl. PRs #260/#262).

## Verdict: PASS — no composer behaviour lost

- Versus the Task 354 parent (`b4cbe7c`), the merge changes only dev-side files (`.ai/` docs, `scripts/dev/smoke-purchases-scope.ts`, `tests/unit/task383-purchases-scope.test.ts`). No composer, `lib/plan-save-state.ts` or e2e file is touched, so every Task 354 change survives unchanged.
- `components/orders/order-composer.tsx` has no conflict markers; `planWriteOutcome()` still gates all three plan-write sites (lines ~588, ~684, ~787). The status line shows "Saved (server)" only when nothing is saving, failed or erroring; a rejected save shows "Failed to save" and the item is kept.
- Conflicts were in `.ai/CHANGELOG.md` / `.ai/BACKLOG.md` only; both sides' entries are kept (the Task 385 entry is present, none dropped).

## Checks run (worktree at 4d14512)
- `bunx tsc --noEmit`: exit 0
- `bun test tests/unit`: 243 pass, 0 fail (`plan-save-state` 8/8)
- e2e (`check-all.sh`) not run in this review (review-only, one dev server limit); the composer e2e specs are unchanged by the merge.

## Mergeable state (live, `gh pr view 261`)
OPEN, base `dev`, mergeable = MERGEABLE, mergeStateStatus = UNSTABLE (no conflicts; `gh pr checks` reports no checks on the branch, so the cause is not visible from here). Not merged by this review.
