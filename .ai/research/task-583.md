# Task 583 — UX-FINDINGS Part 1 #3, #10, #15

Verified on origin/dev (merged into the #313 branch). All three were already fixed; no code change.

- #3: `app/(routes)/patients/page.tsx` uses `getPatientStats()` (`lib/fhir/patient-client.ts:223`, clinic-scoped count) and paginated `getPatientsPage`/`searchPatientsPage`. Analytics untouched (PR #308).
- #10: `lib/patients/registration-schema.ts` has "Select a gender" / "Enter a contact number"; both `new-patient-form.tsx` and `new-v1/new-patient-form-v1.tsx` use it and mark DOB with `RequiredLabel` (DOB is required, submit rejects a missing DOB).
- #15: `components/queue-table.tsx` Remove from Queue opens an `AlertDialog` (pendingRemovePatient) before the DELETE.

Marked in `.ai/UX-FINDINGS.md`.
