# Task 647 — Reliability on slow internet

Scope: dashboard queue, patient profile, triage/check-in, appointments, billing list, checkout, inventory.
Excluded to avoid conflicts with open PR #317 (perf): `patient-profile-workspace.tsx`, `order-composer.tsx`, `patient-service.ts`,
consultation-* libs. The composer is untouched. Sidebar/nav untouched.

References: MDN `AbortController` / `fetch` (no built-in timeout; abort via signal),
React 19 docs "You Might Not Need an Effect" (fetch cleanup), Next.js 16 App Router client components.

## Already fine (no change)
- Dashboard queue: `loadQueueOnce` has a 10 s timeout, error + Retry, keeps list while refetching (Tasks 430/480).
- Checkout pay POST: `isSubmittingRef` + `completing` already prevent double-submit.
- Queue row actions (add/start/complete/remove): `loadingSet` guard + disabled buttons.

## Confirmed gaps and fixes
| Area | Gap | Fix |
|---|---|---|
| Inventory page | `getMedications()` swallowed every error and returned `[]`: a failed/hung load looked like an EMPTY stock list; no Retry; no timeout; a failed refresh after save blanked the list | `fetchMedicationsStrict()` (timeout, throws); error state with Retry; failed post-save refresh keeps list + toast |
| Checkout load | 3 reads with no timeout (endless "Loading checkout..."), error card had no Retry | `fetchWithTimeout` + Retry button (reloadKey) |
| Dashboard appointments / billable | no timeout | `fetchWithTimeout`; timeout/network-specific message |
| Billing table + appointments table | `loading` replaced the whole table with a spinner on every refetch; error replaced stale data | `resolveLoadView`: spinner/error only when no data; otherwise stale list + inline Retry banner |
| Triage/check-in submit | guard relied on `submitting` state only (double-tap before re-render could POST twice) | ref guard |
| Appointment "check in" PATCH | no in-flight guard at all | ref guard |

## Deliberately NOT done
- No timeouts/aborts on mutating POSTs (check-in, sign, pay): aborting does not cancel the server write, so a retry could duplicate. They stay disabled while pending instead.
- Patient profile "sign" lives in `patient-profile-workspace.tsx` (PR #317 file): audited only, follow-up after #317 merges.
- Queue 30 s poll, orders-client background refresh: already keep stale data and fail silently.

## Helper
`lib/load-state.ts` (`resolveLoadView`, `showStaleBanner`, `describeFetchError`), tests in `tests/unit/task647-load-state.test.ts`.
Verification: `tsc -p tsconfig.lint.json` clean, ESLint on changed files clean, `bun test tests/unit` 822 pass. No dev server was started (no e2e run).
