# Independent review of Task 320 (write-side containment), Task 321

Reviewed PR #243 (`ai/task-320-write-containment`) as a non-author.

## Findings
- **MAJOR (fixed here):** triage and check-in creators were not covered. `saveTriageEncounter` and `checkInPatientInTriage` create an Encounter with `subject: Patient/<id>` without proving the patient belongs to the caller's clinic. They are reached from `/api/triage`, `/api/check-in`, `/api/queue` and `lib/actions.ts`. Added `assertPatientInClinic` to both, plus a test. The test fails with the assertion removed.
- Lab and imaging order creators already assert via `assertOrderClinic` (verified). Referral, appointment, invoice, follow-up and document creators are covered by #243.
- **MINOR / follow-up (not fixed):** `/api/scheduling/book` and `manual-book` are unreviewed (the author also listed them). `lib/models.ts` and `lib/models/consultation.ts` `updateConsultation` create an Observation on an Encounter id with no clinic check. `export-to-medplum` and `export-consultation` create Patient/Encounter graphs. The `clinicId`-absent path skips the assertion by design (admin-only callers).
- **Tests:** meaningful. With the assertion neutralised, 5 of 7 tests fail; the other 2 are the lab/imaging regression tests, which assert independently via `assertOrderClinic` and so are unaffected. Weakness: `reject()` accepts any error type, so it can't tell forbidden apart from a validation failure.
- **No regressions found:** `bun test tests/unit` 42/42 pass, `tsc --noEmit` clean. The diff has no changes under `app/` or `components/`, so no nav or sidebar changes. The composer is untouched. No live-Medplum e2e or dev server was run; the changes are service-level and unit-tested with fake data.

## Verdict
APPROVE after the triage/check-in fix (loop 1 of 2). The follow-ups above remain open.

## Task 350 update
The follow-ups above (scheduling book/manual-book, updateConsultation x2, export-to-medplum, export-consultation, /api/fhir/export) are addressed in Task 350; see `.ai/research/task350-containment-2.md`.
