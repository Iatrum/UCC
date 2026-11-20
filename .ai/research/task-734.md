# Task 734 — dashboard-load-errors Playwright specs "fail"

Reported by the Task 727/728 author (`ai/task-727-slots-clinic`): the two specs `dashboard Billing tab` and
`dashboard Appointments tab` in `e2e/tests/dashboard-load-errors.spec.ts` fail, "not proven pre-existing".

## Method
- Worktree `/home/dev/ucc-734` on untouched `origin/dev` (737cbd8). One Next dev server (turbopack, `:3734`,
  `--max-old-space-size=3072`), Medplum dev `:8113`, Playwright wrapped in `timeout`. Fake/mocked data only.
- Specs mock `/api/orders/billable` and `/api/appointments`; the app only needs a logged-in session.

## Code reading
- `dashboard-client.tsx` throws `Error('Failed to fetch consultations')` / `'Failed to fetch appointments'` on a non-OK
  response, and `describeFetchError` (lib/load-state.ts) returns `err.message` for a plain `Error`, so the panel
  shows exactly that text with a Retry button (`components/billing/billing-table.tsx`, view `error`). Loading and
  empty texts are exclusive via `resolveLoadView`. Spec text matches the app.

## Results
| Run | Spec version | Server | Result |
|---|---|---|---|
| 1 | origin/dev | cold (first compile) | 2/2 pass |
| 2-4 | origin/dev, whole file (5 tests) | warm | 5/5 pass x3 |
| 5 | **old spec from `ai/task-727-slots-clinic`** (unscoped `getByText`) | warm | 2/2 pass |
| 6 | old spec, `.next` wiped | cold | 2/2 pass |
| 7 | origin/dev, whole file | cold | 5/5 pass |

## Finding
- **No app bug and no stale test on `origin/dev`.** Both specs pass reliably, cold and warm.
- The 727 branch is based on an older `dev` that lacks `eaae41c` (Task 675: "scope dashboard error assertions to the
  tab panel (dev overlay duplicates the text)"). Its spec uses the unscoped, non-exact `getByText('Failed to fetch ...')`,
  which can hit a Playwright strict-mode violation when the Next dev error overlay also renders the logged
  `console.error` text ("Error loading consultations: Error: Failed to fetch consultations"). That is the most
  plausible source of the report. I could not reproduce even that failure (Next 16 overlay behaviour is timing
  dependent), so it is a probable explanation, not a proven one.
- Task 727/728 changed only `lib/fhir/scheduling-service.ts` and a unit test; nothing in dashboard/billing code.
- Resolution: nothing to fix. Rebase/merge `origin/dev` into 727/728 to pick up Task 675's scoped assertions.

Task 735 found a separate Billing failure that the mocked HTTP responses bypassed. See
[the review](../REVIEW-task734.md) for the fix and verification.
