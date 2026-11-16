# Task 398 — appointment update/delete clinic containment

## Research and scope (2026-11-16)

- Base: origin/dev e6c8278. PR #264 (Task 396) is OPEN and unmerged. Its create-path audit uses `assertPatientInClinic` / `assertOrderClinic`, the shared clinic identifier/account matching functions, and `ForbiddenError` mapped to HTTP 403. Keep the appointment guard local to appointment-service to avoid overlapping its changes.
- Existing update/reschedule helpers read Appointment but never check ownership; delete does not read. Only server callers are PATCH/DELETE in app/api/appointments/route.ts. Route checks currently rely on the patient and return 404 before invoking helpers. Pass authenticated clinicId to every helper, and let mutations use their resource guard (GET behavior stays unchanged).
- Reuse `resourceMatchesClinicTenant` and `getResourceAccountReferences` / `resolveClinicTenant`, as used by assertOrderClinic. Fail closed without clinic; reject conflicting clinic identifiers and foreign/mixed accounts. Read Appointment without cache and with X-Medplum: extended before authorizing, then mutate the authorized resource.
- Official Medplum 5.2.8 source verifies readResource(type, id, options), updateResource(resource), deleteResource(type, id), no-cache request options: https://github.com/medplum/medplum/blob/v5.2.8/packages/core/src/client.ts . Local available SDK is 5.1.13; use only signatures supported there too. No dependency changes.
- FHIR R4 REST read/update/delete operate on individual resource IDs; authorization remains an application/server concern: https://hl7.org/fhir/R4/http.html .
- Next.js 16 server/client boundary: https://nextjs.org/docs/app/getting-started/server-and-client-components . React 19 reference: https://react.dev/reference/react . No UI/component changes are needed.
- DICOM Studies APIs apply to imaging, outside this appointment-only change: https://dicom.nema.org/medical/dicom/current/output/chtml/part18/chapter_10.html . No imaging behavior changes.

## Validation plan

Fake-server unit cases for each helper: foreign clinic => ForbiddenError/HTTP 403 and zero writes; own clinic => expected write with existing fields preserved. Include absent clinic, untagged/mixed ownership and account-conflict cases. Temporarily remove the guard and verify targeted regression tests fail, then restore. Run unit tests and tsc --noEmit only, per task override of AGENTS check-all requirement. No dev server, Playwright, real records, or container access.
