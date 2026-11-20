# Task 736 — C4 dev clinic data audit

## References

- Medplum uses `$set-accounts` to maintain account references and Patient compartment propagation. The checked-in clinic seed assigns the matching `HealthcareService` before creating clinical dependents and propagates again at the end. Dev health at `http://127.0.0.1:8113` reported `5.2.15-4d86215`. [Medplum 5.2.8 release](https://github.com/medplum/medplum/releases/tag/v5.2.8) · [Medplum accounts](https://www.medplum.com/docs/api/fhir/operations/set-accounts) · [Medplum conditional delete](https://www.medplum.com/blog/october-2026-update)
- FHIR R4 defines search token matching on the identifier system and value. Patient `$everything` returns the Patient and resources in its compartment. Medplum retains prior versions on soft delete. [FHIR R4 search](https://hl7.org/fhir/R4/search.html#token) · [FHIR R4 Patient $everything](https://hl7.org/fhir/R4/patient-operation-everything.html) · [Medplum retention](https://www.medplum.com/docs/compliance/backup-and-recovery)
- Next.js 16 production mode serves an existing build. The clinic audit runs directly against Medplum. DICOMweb and React are part of the broader C4 rehearsal. [Next.js 16](https://nextjs.org/docs/app/guides/upgrading/version-16) · [Next.js CLI](https://nextjs.org/docs/app/api-reference/cli/next) · [React 19](https://react.dev/blog/2024/12/05/react-19) · [DICOM PS3.18](https://dicom.nema.org/medical/dicom/current/output/html/part18.html)

## Diagnosis and fix

`check-all.sh` runs `e2e/scripts/clinic-check.ts` as its independent `clinics` step. On dev it exited 1 with `invalidClinicIdentifier` on a Patient and one invalid account. Both checks pointed to the same Patient and matched the timestamp and single history version recorded in [Task 722](task-722.md). The Patient lacked a `clinic` identifier and its only account reference pointed to a `HealthcareService` that returned HTTP 404.

Its sole identifier was a synthetic `ic` probe marker. The Patient had no name, managing organization or stable seed identifier. Its only history version identified the dev fixture client as author, and Patient `$everything` returned only the Patient. UCC's registration path writes an `nric` identifier, clinic identifier and registration tag. The four-clinic seed also writes a clinic identifier, along with its own stable seed identifier and tag. The observed record matches a leftover direct fixture write. The original ad hoc probe command could not be identified.

A version-conditional FHIR DELETE returned HTTP 200 on the fake-data dev instance. The unchanged audit then exited 0. The Patient count fell by one, invalid accounts fell from one to zero, and the existing phase-1 inventory of 735 missing accounts stayed stable. The seed guidance now records how to prevent and safely clean up these orphaned test fixtures.

## Verification

- The read-only clinic audit covered 13 clinics. Before cleanup it checked 3,518 Patients and found one invalid Patient identifier and one invalid account. After cleanup it checked 3,517 Patients and reported zero problems.
- Standalone TypeScript and repository lint passed. The changed files are Markdown and were checked with `git diff --check`. The registration and clinic policy unit suites passed all 30 tests.
- The first full `check-all.sh` run passed lint, build and the clinic audit. Playwright reported 94 passed, one failed and four skipped. The checkout workflow timed out waiting for the fake patient's link and the serial page smoke test skipped. Both were flagged against the Task 722 baseline. The focused workflow rerun on the same build passed all 11 tests.
- The second full run passed lint, build and the clinic audit again. Playwright reported 85 passed, two failed and 12 skipped. The workflow login received HTTP 429 and timed out, skipping the other ten serial tests. The disabled X-ray module check got HTTP 200 from `/api/pacs/devices` where it expected 404. That check passed in the first full run. Both full runs passed the clinic and staff-membership isolation checks. The browser baseline comparison remains open.
- The full runs used a single loopback Next.js production-build server on port 3236 with the documented Webpack memory options applied locally during the build. The workflow-only rerun used the same build on port 3237. Each server process group exited and both ports closed.
