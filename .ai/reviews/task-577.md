# Review of Task 576 (PR #313, draft)

Verdict: **APPROVE as-is. No fixes needed.**

| Check | Result |
|---|---|
| stockNegative / stockUnresolved / stockError reach the toast | Yes. `POST /api/billing` returns all three (`app/api/billing/route.ts`), `buildStockNotice` turns them into lines, `checkoutToastDescription` appends them to the toast. Unit test covers all three. The page banner is unchanged. |
| Invoice preview number | Nothing sends `previewNumber=true` any more (Task 519). The UI shows "Assigned on completion". The PR does not touch it. |
| Saved invoice number logic | Unchanged. The diff has no change in `lib/fhir`, `app/api` or `components`. |
| Empty invoice | Already handled (Task 458): button disabled, warning shown, API 400. Not touched. A confirm dialog would be redundant. |
| One MedicationDispense per line | Dispense code untouched. `dispense-service` and `dispense-consistency` tests pass. |
| Layout, sidebar, nav | Toast text only. No layout or nav change. |
| Tests | `bun test tests/unit`: 679 pass, 0 fail. |
| tsc | `tsc --noEmit` clean. |
| Mergeable vs dev | Clean (`git merge-tree` against origin/dev 620d0c8). One commit ahead. |

Note: the PR is narrower than the task title suggests. Items (c) and (d) were already fixed on dev, which `.ai/research/task-576.md` records correctly.
