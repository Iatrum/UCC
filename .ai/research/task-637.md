# Task 637 — mcEndDate partial day; Time Chit spec 409

## 1. mcEndDate (lib/clinic-dates.ts)
Confirmed from code + the skipped test (tests/unit/task633-clinic-dates-followup.test.ts, Task 634): guard was `numDays > 0`,
then `addClinicDays(start, Math.floor(n) - 1)`. For 0 < n < 1, floor(n) = 0, offset -1 -> end date = day BEFORE start.
Semantics chosen: a partial day is a same-day MC (offset `max(1, floor(n)) - 1`), so end >= start always.
Also reject non-finite n (Infinity) explicitly. Fractions >= 1 still floor (1.5 -> 1 day, 2.9 -> 2 days; unchanged).
Only caller: lib/document-render.ts, which already clamps `days = max(1, Number(mcDays) || 1)`, so rendered MCs never hit
the bug (UI/API unaffected in practice); the fix hardens the helper. MC and Time Chit share the template renderer; Time Chit
does not use mcEndDate.
Tests: un-skipped, plus 0.01/0.5/0.99/1.5, +/-Infinity, invalid start, year-boundary.

## 2. 409 from PATCH /api/consultations in the Time Chit spec (seen in Task 631)
Verdict: test artefact, not an app bug. No app change.
- 409 sources in the PATCH path: `signedDocumentMutationError` (lib/clinical-documents.ts) and `assertTimeChitMutationAllowed`
  (lib/fhir/time-chit-guard.ts, invalid Time Chit details) -> ConflictError -> 409. There is NO If-Match/versionId check in
  PATCH /api/consultations (versionId checks exist only in consultation-draft.ts, a different endpoint), so it is not an
  optimistic-lock conflict.
- Cause: Task 549 made signed MC/Time Chit/referral immutable (void + reissue). The old spec re-PATCHed the unsigned template
  line (`tcHours: '999'`) over the already-signed Time Chit and expected 200. Task 631's branch predated the spec fix.
- Task 609 (e1bb239, already on dev) reproduced it on plain dev with server log
  `Conflict: Signed documents cannot be edited or deleted...` and fixed the spec (resend unchanged -> 200, edit -> 409).
- Not re-run here: no new dev server was started; conclusion rests on Task 609's logged reproduction and code reading.
  Added a unit test pinning the exact scenario (stored note with server-computed tcHours vs stale line).
- User-facing: an edit of a signed document returns a clear 409 message by design; no stale-version flow found.
