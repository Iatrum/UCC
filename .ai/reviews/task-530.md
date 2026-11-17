# Task 530 — review of PR #296 (Task 529)

Verdict: **APPROVE** (no code fixes needed).

## Clinic isolation (consultation -> patient lookup)
- `GET /api/orders` uses `requireClinicAuth`, then `getConsultationFromMedplum(id, clinicId, medplum)`.
  That function reads the Encounter and returns null when `matchesClinic` fails, so a foreign-clinic
  consultation gives **404** ("Not found"), with no data leaked.
- Patient id comes from the consultation. A client `?patientId=` that differs from it resolves to
  null (404) via `resolveCheckoutPatientId`. The patient read is also clinic-scoped (`getPatientFromMedplum`).
- `resourceMatchesClinicTenant` returns true when `clinicId` is null/empty. `requireClinicAuth`
  resolves/validates the clinic and throws Forbidden if the user isn't assigned, so this is not
  reachable from a normal request. Pre-existing, not changed by this PR.
- The PR's claim that UX #17 was already fixed by Task 458 checks out; the page leaves `patientId` optional.
  Existing unit tests (`task458-checkout.test.ts`) cover the resolver. No live cross-clinic HTTP test was
  run (no dev server started).

## recent= clamp
- `clampRecentLimit`: junk/empty/0/null -> 10; negative -> 1; >50 -> 50. Applied in `GET /api/consultations`.
- Only caller (`getRecentConsultations`, default 10) never exceeds 50. Clinic scoping of that route is unchanged.

## Checks (run in worktree)
- `tsc --noEmit`: pass. eslint on 3 changed code files: clean.
- `bun test recent-limit + task458-checkout`: 17 pass, 0 fail.
- Diff touches only the route, a new helper, a test and UX-FINDINGS.md. No composer, Lab/POCT, nav or secret changes.
