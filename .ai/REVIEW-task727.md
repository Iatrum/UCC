# Review — Task 727 (reviewer: Task 728, non-author)

**Verdict: APPROVE** (after two small fixes made by the reviewer on the same branch).

## Scope reviewed
PR #349 (`ai/task-727-slots-clinic` → `dev`), diff vs merge-base: test file, `.ai/*` notes only. No app code in the author's commits.

## Clinic isolation, every Schedule/Slot path in `lib/fhir/scheduling-service.ts`
| Path | Check | Result |
|---|---|---|
| `listClinicSchedules` | clinic identifier search + identifier parse + tenant match | OK |
| `ensureClinicianSchedule` | clinic-scoped identifier search + tenant match; create stamps clinic identifier + account | OK |
| `generateSlotsForSchedule` | read by caller-supplied id; identifier clinic compared; 403 before any write | OK; was identifier-only, **hardened (fix 1)** |
| `findSlots` | uses listClinicSchedules; Slot search filtered by clinic identifier | OK |
| overlap / `findExactFreeSlot` | Slot and Appointment searches filtered by clinic identifier | OK |
| `bookSlotToAppointment` | `assertPatientInClinic` first; slot's schedule clinic compared; opaque 403 | OK |
| `manualBookAppointmentWithSlot` | patient check first; schedule from `ensureClinicianSchedule` (own clinic) | OK |
Routes (`slots/generate`, `book`, `manual-book`, `schedules`) all use `requireClinicAuth` and pass the server-derived clinicId; none trusts a clinic from the body.

## Test not weakened
Old assertion (`toThrow('does not belong')`, a substring of a stale message) replaced by stricter: `ForbiddenError` instance + exact message + zero writes. New no-identifier case added. No test removed or skipped. Matches code (ForbiddenError, Task 422).

## Composer
No composer, Lab/POCT or UI file touched by the author's commits or mine.

## Reviewer fixes
1. `generateSlotsForSchedule` now also requires `resourceMatchesClinicTenant(schedule, clinicId)`, matching `listClinicSchedules`/`ensureClinicianSchedule` (closes the follow-up the author flagged).
2. Added unit test: schedule with our practitioner identifier but no tenant marker is refused (403, no writes).

## Notes (not fixed)
- `manual-book` route maps any message matching /unavailable/ to 409 before `handleRouteError`; a ForbiddenError with that text would become 409. Unreachable today (schedule is server-resolved). Consider matching on error class.
- Author reported 2 `dashboard-load-errors` Playwright failures not proven pre-existing; I did not run e2e (no app code changed).

## Results
Unit suite: 1228 pass before fix; re-run after fixes recorded in PR body.
