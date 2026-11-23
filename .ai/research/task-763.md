# Task 763 — PR #355 merge conflict resolution

Compared the PR branch with `origin/dev`. The PR adds scheduling request validation and unit coverage for scheduling, appointments, catalog, and server-side clinic resolution. The merge should preserve those changes and the history entries from both branches.

- [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16) documents running ESLint directly in Next.js 16.
- [React 19 release](https://react.dev/blog/2024/12/05/react-19) covers the UI framework version. This conflict fix does not require UI changes.
- [Medplum 5.2.8 release](https://github.com/medplum/medplum/releases/tag/v5.2.8) and [Medplum API docs](https://www.medplum.com/docs/api) cover the requested version and FHIR API context. This task makes no server or SDK version changes.
- [FHIR R4 DiagnosticReport](https://hl7.org/fhir/R4/diagnosticreport.html) and [DICOM PS3.18](https://dicom.nema.org/medical/dicom/current/output/html/part18.html) cover the existing diagnostic reporting and imaging standards. This task does not change lab or imaging behavior.
