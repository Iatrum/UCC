# Task 351 research — independent Task 350 review

Reviewed PR #247 at 6cf8842646b12acb8eb12bb9b43e125b2581665d; base `dev` fetched at 730d56e. Isolated worktree initially created from origin/dev, then review branch set to the submitted PR head (no merge/rebase).

Official sources checked before edits:
- Medplum **v5.2.8** server implementation: https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/fhir/repo.ts (`getAccounts`, `canWriteAccount`, `removeInternalMetaFields`). Admin account stamping requires extended mode; raw REST mapper writes do not enable it. Patient-linked resources inherit patient accounts otherwise.
- SDK pinned source: https://github.com/medplum/medplum/blob/v5.2.8/packages/core/src/client.ts (`searchResources`, request headers). SDK defaults to extended mode. Use explicit no-cache/extended options on containment reads; search `_compartment` is supported by server.
- https://www.medplum.com/docs/access/access-policies — create cannot rely on read/search criteria for patient-link authorization.
- https://hl7.org/fhir/R4/compartmentdefinition-patient.html — patient links include Appointment actors, Observation/Encounter subject, Task.for.
- https://nextjs.org/docs/app/guides/authentication — Next 16 route handlers must authorize independently, close to data access.
- https://react.dev/reference/react/useEffect — effect cleanup/dependencies matter to composer persistence. No UI/effect edits proposed.
- https://dicom.nema.org/medical/dicom/current/output/chtml/part15/chapter_A.html — remote image access requires explicit restrictions; no DICOM protocol changes in this PR.

Initial evidence: Task 350 focused tests 8/8 pass; GitHub MERGEABLE/CLEAN. Export Patient searches are unscoped admin reads and `isOwn` accepts identifier before checking conflicting account. Billing exception Task creator has no patient/visit guard. Shared patient guard permits missing clinic; consultation create/update and triage complaint helper need explicit checks/stamping. Existing :3210 is occupied; no server started or stopped. Full gate has hardcoded /workspace output and baseline, absent on this VPS; do not run against another worktree's server.
