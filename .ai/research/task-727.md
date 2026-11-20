# Task 727 — "generateSlotsForSchedule refuses a schedule that belongs to another clinic" fails on origin/dev

## Question
Real clinic-isolation bug (foreign schedule accepted) or stale test?

## Findings
- `lib/fhir/scheduling-service.ts` `generateSlotsForSchedule` reads the Schedule, parses the clinic from its
  `urn:iatrum:schedule:clinic-practitioner` identifier (`<clinicId>:<practitionerId>`), and throws if it differs
  from the caller's clinic (or is missing). The throw happens before the window check, the Slot search and any
  `createResource`, so nothing is written. The failing run confirms it threw (message mismatch only, no accept).
- Commit bef4301 (Task 645) changed the throw from `Error("Schedule does not belong to this clinic")` to
  `ForbiddenError("Schedule unavailable in current clinic")` (Task 422 rule 2: a caller-supplied reference in a
  payload is a 403, and the message must not confirm the foreign resource exists). The test (Task 639) still
  matched the old wording `'does not belong'`.
- `ForbiddenError` is mapped to HTTP 403 by `lib/server/route-helpers.ts` (error handler), and
  `app/api/scheduling/slots/generate/route.ts` goes through it.
- FHIR R4: Schedule/Slot carry no clinic concept of their own; the clinic is our `identifier` (and the Medplum
  account tenant). Listing (`listClinicSchedules`) additionally checks tenant meta; generation checks the identifier.

## Verdict
Stale test, not an isolation bug. Code behaviour is correct and intended. Fix = test only, kept strict:
asserts `ForbiddenError` + exact message + zero writes; added a case for a Schedule with no clinic identifier.
Not weakened to a loose substring.

## Observation (no change)
Generation relies on the identifier only, while listing also requires tenant meta match. Identifiers are only
set server-side, so this is not exploitable today; adding `resourceMatchesClinicTenant` would be defence in depth
and is left as a possible follow-up.
