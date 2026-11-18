# Review: Task 568 (PR #312) — Task 569

Verdict: APPROVE. The PR is docs, BACKLOG/CHANGELOG and a unit test only. No policy or app code changed, so policy ids are unchanged and production is untouched.

## Checked
- Diff vs dev: 4 files (.ai notes, tests/unit/clinic-staff-policy-drift.test.ts). Branch contains dev tip (merge-base ok), PR MERGEABLE.
- `bunx tsc --noEmit` clean; `bun test tests/unit` 679 pass, 0 fail.
- Live, dev Medplum 127.0.0.1:8113, fake data, doctor@ucc.local (non-admin, access policy attached):
  - Search ProjectMembership, User, AccessPolicy, Project, Login, Bot: all 403.
  - Practitioner search returns 4 (own clinic scope); Organization 1 (own).
  - Normal flows 200: Patient, Encounter, Invoice, MedicationDispense, MedicationRequest, ServiceRequest, Observation, DiagnosticReport, Condition, Task, Appointment, Medication, AllergyIntolerance, Communication, Practitioner(Role), Organization, HealthcareService.
  - 403 on Claim, Coverage, Location, ChargeItem, Device: not part of the policy before or after this PR (no policy change); app code only uses Device server-side (poct/xray device libs), so no new Forbidden.
- Not re-run: foreign-id reads (needs admin listing of other clinics' ids); relied on 568's evidence plus the criteria pinned by the new test.

## Notes
- Test pins exact criteria strings, so intentional directory-rule changes must update the test (desired).
- Residual by design: same-clinic colleague Practitioner telecom is readable.

No fixes needed on the branch.
