# Task 594 - review of Task 593 (PR #317)

Verdict: **APPROVE** (small test hardening pushed to the branch).

## Checks
- **Clinic isolation**: `findClinicOrganization` still uses the same `clinic|<id>` identifier query; no new cache. `resolveClinicTenantMemo` is unchanged (per-client WeakMap, keyed by clinicId, 5 s TTL, failures not cached), so no cross-clinic or cross-user sharing and AccessPolicy outcomes of request-scoped staff clients are not shared. New test: two clinics on one client never share a tenant.
- **Rejection safety**: the early search promise is wrapped in `searchSettled` (no unhandled rejection if the direct read wins); `tenantPromise.catch` in `getPatientFromMedplum` covers a Patient read failing first. Search failure still surfaces only when the direct read fails. Cross-clinic patient: tenant awaited, no history queries, returns null. Tenant failure still -> null.
- **Pagination**: Task 592's paged Encounter search / 100-ref child batches are intact. Note (pre-existing, unchanged by the PR, follow-up): patient `AllergyIntolerance`/`Condition`/`MedicationStatement` history searches use the default page of 20 without paging.
- **Numbers** (task-593.md): 100 - 4 = 96 empty before, 71 + 29 = 100, 74 vs 5 encounters, 67 of 71 wrongly empty all reconcile and match the correction in task-591.md. Waves 4 -> 3 and 3 -> 2 match the diff (one 404 hop removed; history no longer behind tenant). Wall-clock deltas are honestly labelled as within noise. Minor cost: for UUID clinic ids the identifier search is now issued redundantly (one extra cheap call).

## Tests
Task593 tests relied on wall-clock thresholds (flaky on this loaded box); replaced with call-ordering assertions. Added: direct read wins over differing search result, memo cross-clinic isolation, Patient read failing first returns null. Unit suite 744 pass, tsc (tsconfig.lint.json) clean, eslint clean on changed files.
