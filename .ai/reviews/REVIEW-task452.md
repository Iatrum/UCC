# REVIEW — Task 452 (queue keeps previous list) — Task 453

Reviewed: commit 236f4c6 on `ai/task-430` (PR #274, which carries Task 430 + Task 452). Note: PR #274 is open, not draft.

## Verdict: APPROVE (after 1 fix loop; small fixes applied on the same branch)

## Checks
- **Merge**: `origin/dev` is fully contained (merge cbe3593 + duplicate-Button-import fix 51c881a). Diff vs dev is 6 files, all dashboard/billing/appointments/e2e/docs. Mergeable against dev.
- **Queue keep-previous-list**: correct. Skeleton only when `loading && !queueLoaded`; full error panel + Retry only when `error && !queueLoaded`; after a first success a failed refetch keeps the list and the existing "Queue could not be refreshed" banner shows. Interrupted fetches (pagehide/beforeunload, abort by newer request/unmount) are silent; the 10 s timeout still reports "taking too long". Verified in the browser.
- **No nav label change**: `components/navbar.tsx` untouched; the "Login/Logout" flash is explicitly left to the owner in the changelog.
- **No sidebar/nav/composer changes**; no Lab/POCT, X-ray/PACS, Firebase or clinic-scoping code touched (X-ray toggle unaffected). Clinic data stays separate: only existing clinic-scoped `/api/queue`, `/api/appointments`, `/api/orders/billable` endpoints are called.
- **Secrets**: no `.env*`, `e2e/.secrets`, tokens or real patient data in the diff; fixtures are fake (`fake-pat-*`).
- `tsc --noEmit` and eslint on the changed files: clean.

## Findings fixed (e2e + one tiny code fix)
1. **Queue tests could never pass**: fixtures used `name`, but `QueueTable` renders `patient.fullName`, so the list never appeared. Fixed to `fullName`.
2. **Billing test strict-mode clash**: after Task 432 (merged from dev) each billing row has two links named after the patient (name link + "Open checkout for ..."). Test now uses `.first()`.
3. **Navigate-away test was invalid**: a client-side link click waits for dev route compile, so the request aborted while still mounted, and `.catch(() => {})` hid failed clicks. Rewritten: hung `/api/queue`, then a real `page.goto('/patients')`.
4. **Real (minor) bug found by the fixed test**: interrupted Appointments/Billing fetches on unload still called `console.error` (guard came after the log). Now guarded by `unloadingRef`, same as the queue. UI was already silent.

## Test run
Dev server (webpack, port 3291, fake data, killed afterwards) with `e2e/tests/dashboard-load-errors.spec.ts`: before fixes 1 passed / 4 failed; after fixes 5/5 passed. The full `check-all.sh` gate was not run (RAM shared with production); the change is confined to the dashboard page, two presentational tables and one spec.

## Left alone (non-blocking)
- Appointments/Billing tables still show their loading block on manual refresh (only the queue keeps the previous list); changelog wording "same quiet handling" refers to errors, not list retention.
