# Task 521: patient + queue UX re-verification (origin/dev cab678a)

Method: read the code on `origin/dev`; no dev server was started. Result: every listed item is already fixed, so no source change was needed.

| UX-FINDINGS item | Status on dev | Evidence |
|---|---|---|
| Part 1 #3 patient total vs Analytics | Fixed | Patients page uses `GET /api/patients?stats=1` -> `countPatientsInMedplum` / `countNewPatientsThisMonth` (`app/api/patients/route.ts:95-101`). Analytics uses the same `countPatientsInMedplum(clinicId, medplum)` (`app/(routes)/analytics/page.tsx:19`). One clinic-scoped count (`_summary=count`, `_total=accurate`). Test: `tests/unit/task434-patient-counts.test.ts`. |
| Part 1 #7 history table clipped | Fixed | `overflow-x-auto` wrapper + `min-w-[860px]` table at md+, card list below md (`patient-profile-workspace.tsx:835-836`). |
| Part 1 #8 / Part 2 #19 header stats contradict | Fixed | Header shows "Last consult" / "Total consults", both from `consultSummary(consultations)` (`lib/patients/profile-history.ts`, `patients/[id]/page.tsx:105,186-193`); "No consults yet" when empty. Test: `tests/unit/task446-profile-history.test.ts`. |
| Part 1 #10 registration wording | Fixed | Shared `lib/patients/registration-schema.ts`: "Select a gender", "Enter a contact number"; DOB uses `RequiredLabel` and the message says it is filled from the NRIC. Both `new` and `new-v1` forms use the shared schema. Test: `tests/unit/ux-polish-456.test.ts`. |
| Part 1 #15 Remove from Queue confirm | Fixed | `AlertDialog` driven by `pendingRemovePatient` in `components/queue-table.tsx:249-273`; menu item only sets state (`:397`). E2E: `e2e/tests/task476-queue-confirm.spec.ts`. |

Not verified in a browser (code reading only). Note: the task text numbers history/header as #6/#7/#8; in the file they are Part 1 #7, #8 (and #6 is the stale-history item, also fixed by Task 446).
No sidebar/nav, checkout, billing, imaging or composer files touched.
