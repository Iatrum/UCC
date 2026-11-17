# Task 522: review of PR #291 (Task 521)

Verdict: **APPROVE**. PR is MERGEABLE into `dev` (base cab678a, one docs-only commit).

## Scope
Diff is only `.ai/research/task-521.md` (+14). No sidebar/nav, composer, billing, imaging or lab files touched.

## Claims re-verified against the code (not just the note)
- Counts: `countPatientsInMedplum` (`lib/fhir/patient-service.ts:829`) builds params via `clinicPatientParams`, which throws without a clinicId (fail closed) and filters on the clinic identifier + `active=true`; uses `_summary=count&_total=accurate`. `/api/patients?stats=1` and Analytics both call it with the resolved clinic. Patients page reads it via `getPatientStats`.
- History table: `overflow-x-auto` + `min-w-[860px]` at md+, in `app/(routes)/patients/[id]/patient-profile-workspace.tsx:835-836`. (Note cites a non-existent short path `patient-profile-workspace.tsx`; cosmetic.)
- Header stats: "Last consult" / "Total consults" / "No consults yet" in `patients/[id]/page.tsx:186-192`.
- Registration wording: shared `lib/patients/registration-schema.ts` used by both `new` and `new-v1` forms.
- Queue remove confirm: AlertDialog in `components/queue-table.tsx`; menu item only sets pending state.

## Tests
`bun test tests/unit`: 613 pass, 0 fail (incl. task434, task446, ux-polish-456). Playwright e2e (task476-queue-confirm) not run: no browser/dev server started, per RAM limits; spec file exists. Remote check `lint-and-build` was still pending at review time; the PR changes no code.

## Non-blocking observation (pre-existing, not changed here)
`countNewPatientsThisMonth` filters on `_lastUpdated`, so any patient edited this month counts as "new". FHIR Patient has no creation-date search param; a real fix needs a stored registration date. Suggest backlog.

## Fixes made
None needed.
