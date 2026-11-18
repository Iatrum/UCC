# Task 592 - review of PR #317 (Task 591 perf)

Verdict: **APPROVE** (after small fixes pushed to the branch).

## Checks
- **Clinic isolation**: `getPatientConsultationsFromMedplum` still sends the clinic identifier and post-filters with `matchesClinic` + patient identifier. New test: foreign-clinic / foreign-patient encounters returned by the server are dropped.
- **Tenant memo** (`resolveClinicTenantMemo`): WeakMap per client instance, key = clinicId, 5 s TTL, failures never cached. No cross-clinic or cross-user sharing (staff clients are request-scoped, so AccessPolicy outcomes are not shared). Swapping it into read-only count/page/search paths keeps the fail-closed `clinicPatientParams`.
- **Results preserved**: original fix removes a silent truncation (20-encounter default page). Review found it replaced it with a single un-paged `_count=1000` page and one child-search URL with up to 1000 `Encounter/` refs (~46 KB, over typical header limits; sibling batch reader uses 100).
  - Fixed: Encounter search now pages by `_offset` (1000/page, max 10 pages); children are batched at `CHILD_BATCH` (100).
- **Numbers**: FHIR call counts (8 -> 5 for stats, 15 -> 15 for profile) are consistent with the diff. Profile warm time not improved locally (100-135 -> 114-146 ms) and the notes say so honestly. Nit (not fixed, doc only): research note says "45 of 100 patients showed 0 consultations" before, but also "4 -> 71 patients with history"; these figures do not reconcile (55 vs 96 would be expected). Does not affect the code.

## Tests
Added: paging beyond 1000 encounters, child batch size <= 100, clinic/patient isolation. Unit suite 735 pass, `tsc --noEmit` clean, eslint clean on changed files.
