# Task 584 — review of Task 583 (PR #313)

Verdict: **APPROVE**. No code changes needed.

Task 583 is docs-only (it verified already-fixed items). Checked each claim against code:

- **Patients count (#3):** `patients/page.tsx` calls `getPatientStats()` -> `/api/patients?stats=1` -> `countPatientsInMedplum(clinicId)` / `countNewPatientsThisMonth(clinicId)`. The count goes through `clinicPatientParams(clinicId)` with `_total=accurate`, so it is clinic-scoped and exact. The list is paginated (`getPatientsPage`, `searchPatientsPage`).
- **Queue remove (#15):** `components/queue-table.tsx` Remove opens an AlertDialog. Cancel only closes it (`onOpenChange` resets `pendingRemovePatient`). The DELETE runs only from the "Remove" action.
- **Registration wording (#10):** the shared schema gives "Select a gender" and "Enter a contact number". Both forms use it and label DOB with `RequiredLabel`.
- **Scope:** no analytics, sidebar or nav files in the diff. No visual redesign. The only source changes are the Task 576 toast text and tests.
- **Checks:** `tsc --noEmit` clean. The task576/task580 unit tests pass (4/4). The PR is MERGEABLE and `origin/dev` is already merged in.
- **Not exercised:** no browser run. The dialog and count behaviour were verified by reading the code only.
