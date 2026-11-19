# Review of Task 601 (PR #317) — Task 602

Verdict: **APPROVE** (after one small fix pushed on the same branch).

Checked (code read, origin/dev merged cleanly, no conflicts):
- **Composer catalogs**: `OrderComposer` reads `items/services/documents` through `useMemo`, so catalogs arriving after mount fill in; no mount-time snapshot of props. Drawer mounts and the fetch start in the same commit; the old mount-time fetch had the same async fill-in. Time Chit is synthesised even when the document catalog is empty.
- **Fast open race**: the latch was a ref set synchronously, so repeated open/close does not double-fetch.
- **Issue found (fixed)**: the latch stayed set after a failed fetch, so one transient error left the composer with empty catalogs until page reload. New `createComposerCatalogRequester` (lib/orders/composer-catalogs.ts) shares one in-flight request, never repeats a success, and clears the latch on failure so reopening retries.
- **Per-clinic data**: no client/server cache was added. Catalogs still come from the same clinic-scoped endpoints; lazy tabs hold state per page mount, and the page is per clinic/patient.
- **AccessPolicy / clinic isolation**: no policy or route changes. `draftScope` still calls `assertOrderClinic` and requires a Practitioner. `findClinicOrganization` runs the identifier search in parallel with the direct read; the result and fail-closed behaviour are unchanged. `getPatientFromMedplum` still awaits the tenant before returning and checks `matchesClinic`.
- **/auth/me removal**: `draftScope` now uses `loadMe` (memoised per token, failures not cached). Same Practitioner check; the unit test fails if `getProfileAsync` is called. Session handling is unaffected (`requireClinicAuth` untouched).
- Lab/POCT, composer behaviour, nav: untouched.

Tests: added 4 edge cases in `tests/unit/task601-perf.test.ts` (shared in-flight request, retry after failure, partial-failure rejection, inactive/undefined price). Full unit suite 753 pass; tsc (tsconfig.lint.json) clean; eslint clean on changed files. Playwright e2e was not re-run in this review.

Residual (non-blocking): while catalogs load the composer briefly shows empty search results (same as before the change). `time-chit.spec` 409 noted in task-601.md is still unverified against baseline.
