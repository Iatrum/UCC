# Task 352 independent review — 2026-11-16

Target: PR #251, `ai/task5-clinic-policy` at eecea53. Own worktree was created from origin/dev, then positioned on the PR head for a stacked review branch. No production access; all API experiments target http://127.0.0.1:8113 with disposable fake projects. No application/UI changes planned.

Official sources verified before changes:
- Medplum tagged 5.2.8 access policy source: https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/fhir/accesspolicy.ts — repository superAdmin derives from the Project. Restoring that flag elevates every member; membership inventory drift must block rollback.
- Medplum 5.2.15 membership validation: https://github.com/medplum/medplum/blob/v5.2.15/packages/server/src/fhir/projectmembership.ts — membership/profile/project identity matters independently of successful authentication.
- https://www.medplum.com/docs/self-hosting/project-settings and https://www.medplum.com/docs/access/access-policies — verify tagged implementation, since current docs evolve.
- https://www.hl7.org/fhir/R4/http.html — conditional updates and HTTP error handling. An empty/error response is not proof of denied access.
- https://nextjs.org/docs/app/getting-started/installation — Next 16 build and lint are separate checks; preserve both gate steps.
- https://react.dev/reference/react/useEffect — composer lifecycle remains outside this scripts-only change.
- https://dicom.nema.org/medical/dicom/2026b/output/chtml/part18/PS3.18.html — separate DICOMweb boundary; retain stable IDs and existing PACS/Firebase links.

Initial findings:
1. MAJOR: rollback dry-run exits before grant/directory/policy drift validation, so a preview says complete even where apply refuses.
2. MAJOR: rollback does not reject new memberships or changed project name/links. Restoring superAdmin can elevate identities absent from the backup and silently overwrite topology changes.
3. MAJOR: missing backed-up policies are silently skipped, allowing false rollback success without restoring grants.
4. MAJOR verification gap: several isolation assertions accept empty results from HTTP failures (e.g. identity-table 500), and staff auth/me is not bound to the expected project/membership/profile.

Dev server version recorded by PR is 5.2.15. This review does not establish runtime compatibility with 5.2.8 or authorize production cutover.

5. MAJOR: duplicate clinic Organization identifiers can map separate Organizations onto one HealthcareService compartment; migration now refuses ambiguous Organization/account identifiers before any migration write.

Units: 154/154 passed. Initial rehearsal passed, but child commands loaded the working scripts while review edits were in progress; it is a setup check, not final immutable evidence. The hardened rehearsal and final gate are recorded separately.
