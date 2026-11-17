# Review: Task 430 (PR #274) — dashboard Billing/Appointments loading + error + Retry

Reviewer: independent (Task 431), head reviewed: 00237c0. Verdict: **APPROVE**

## Checked
- **Correctness**: `consultationsLoading` / `apptLoading` start `true`, so there is no first-paint empty-text flash. Errors are set in `catch` and loading is cleared in `finally`. Both are guarded by `mountedRef`. StrictMode double-effect is safe (the first microtask is skipped via `disposed`).
- **No empty-state flash**: in `BillingTable` the hooks (`useState`, `useMemo`) run before the early returns, so hook order is stable. Order is loading, then error, then table, so "No billable consultations found" only renders after a successful fetch. Same order in the appointments table.
- **Errors not swallowed**: `console.error` is kept and the user sees a visible message plus a Retry button. A non-OK response and a JSON parse failure both reach `catch`.
- **Retry**: the button calls the loaders, which reset the error and set loading. The button is not rendered while loading, so there are no double clicks.
- **Backward compatible**: the new props are optional. `orders-client.tsx` (`BillingTable`) and `appointments-root.tsx` (`UpcomingAppointmentsTable`) are unchanged and behave as before.
- **Clinic data**: no new fetches or endpoints, same `/api/orders/billable` and `/api/appointments`. The error text is a static string, so there is no server message or PHI in the UI.
- **No nav/composer/Lab/POCT changes**: touched files are the dashboard page, two table components, one e2e spec and the changelog only.
- **Types**: `tsc --noEmit` shows no errors in the touched files.
- **Tests**: `e2e/tests/dashboard-load-errors.spec.ts` is meaningful. A gated mock holds the first billable request, so it asserts Loading is visible and the empty text is absent, then 500 gives the error and still no empty text, then Retry gives the list. Appointments covers error then Retry. Data is fake and mocked.

## Not done
- I did not run the e2e live. Another agent's Next dev server is already using :3210 and about 1 GB with about 2.5 GB free on a shared production box, so I did not start a second server. Run `e2e/scripts/check-all.sh task430` before merge.

## Non-blocking notes (no change required)
1. No request-ordering guard on `loadAppointments` / `loadConsultations`: a slow earlier response could overwrite a later Retry. Low risk, as the queue loader's abort pattern could be copied later.
2. A Retry or refresh replaces already-shown rows with the loading text (the appointments table did this before; check-in refresh behaves as before). A "keep stale rows" refinement is optional.
3. The initial queue error banner is still separate and not tied to these tabs (unchanged).
