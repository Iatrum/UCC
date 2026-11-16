# Review: Task 380 (PR #254) — admin redirect + purchases not-found

Verdict: **approve, no blocking findings.** Reviewed at 079609f. `bun test tests/unit` 159 pass / 0 fail; `tsc --noEmit` clean.

## Root cause
- Purchases 500: `medplum.readResource` rejects with `OperationOutcomeError` (not-found), which `handleRouteError` did not map. Fix maps `isNotFound(outcome)` to 404; other Medplum errors stay 500 (tested). Correct and minimal.
- `admin.<base>/admin/x` -> `<base>/admin/admin/x`: `adminPortalPath()` is idempotent; `/administrator` correctly becomes `/admin/administrator`. Correct.
- /admin login loop: not reproduced, already guarded by Task 310. Honest; can't be confirmed without production topology.

## Clinic isolation / roles
- Purchases GET/PATCH still check `belongsToClinic`; a cross-clinic id returns the same 404 as a missing id (no existence leak). `requireClinicAuth` unchanged. No role-check changes. No cross-clinic reads added.
- Global 404 mapping only changes status for not-found; Medplum 403 handling is earlier in the function and unchanged.
- No sidebar/nav, composer, Lab/POCT or Firebase changes.

## Tests
- Unit tests use real `proxy()` and real error classes (no mocks), so they are meaningful. E2E spec only covers API status codes (needs an authenticated dev server; not run here).

## Non-blocking notes (pre-existing, out of scope)
1. `GET /api/purchases` list searches all clinics' purchase-order Basics (`_count=500`) then filters in memory. Other clinics' orders could crowd out a clinic's own once >500 exist; should filter by `identifier=clinic|<id>` in the search. Not data leakage, but a correctness/isolation-hygiene issue.
2. A same-clinic `Basic` that is not a purchase order makes `fromBasic` throw a plain Error -> 500 (PR text implies non-purchase ids 404). Could check `code` in `belongsToClinic`.
3. `check-all.sh` not run (stated in PR).
