# Review: Task 446 (PR #278, branch ai/task-446)

**Verdict: APPROVE**

Reviewed commit 67550be against origin/dev (5 files, +97/-9).

## Checks
- **History refresh after Sign:** `withSignedConsultation` adds the just-signed consult (set in `setSignedConsultationForTreatment` before `router.refresh()`) to the list, deduped by id, so the row shows at once and is not doubled once the server list returns. Feeds the existing `mergeByVisit`. OK.
- **No clipping:** the history table wrapper gets `overflow-x-auto`. The `Table` component already scrolls internally, but the extra wrapper stops the grid/flex parent growing past the viewport. Harmless and correct.
- **Visit counting:** header now says "Last consult"/"Total consults", counted from the consultation list (newest valid date, invalid dates ignored). It no longer claims "completed visit" for a signed-but-unbilled consult. Note: the count is of raw consultations, while the history table merges same-day/same-complaint/same-diagnosis rows by visit, so the two can differ. The label is honest about this. Non-blocking.
- **Empty-state "Start consult"** hidden while the drawer is open. OK.
- **Composer untouched:** no change to `order-composer` or sign logic. The only edits are the memo, wrapper class and button condition.
- **No sidebar/nav changes**, no Lab/POCT or X-ray code touched (so the X-ray toggle is unaffected), no clinic-scoping or query changes (clinic data stays separate).
- **No secrets/.env/real data** in the diff (grep clean). The test uses fake ids only.
- `bun test tests/unit/task446-profile-history.test.ts`: 4 pass. `tsc --noEmit`: no errors in touched files.

## Findings
None blocking. No fixes needed. Not browser-verified (static review only).
