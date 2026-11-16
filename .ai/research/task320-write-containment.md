# Task 320 — write-side cross-clinic containment

Gap (BACKLOG, Task 090 Phase 0): Medplum AccessPolicy `criteria` does not gate `create`, so a clinic-A user could create resources pointing at a clinic-B Patient.

State on `dev` at start: `createLabOrder` / `createImagingOrder` already call `assertOrderClinic` (lib/fhir/clinic-tenancy.ts) before any create. `saveConsultationToMedplum` already denies foreign patients in `getOrCreatePatient`.

Added `assertPatientInClinic` (lib/fhir/write-containment.ts, thin wrapper over `assertOrderClinic`; no-op when clinicId absent) before the first write in: `saveReferralToMedplum`, `saveAppointmentToMedplum`, `completeCheckoutInvoice`, `createFollowUp` (when patientId given), `createPatientDocument` (when clinicId given).

Tests: tests/unit/write-containment.test.ts (fake Medplum, fake data) — foreign patient → forbidden and zero `createResource` calls; lab/imaging regression.

Not covered / follow-ups: scheduling-service booking routes (`/api/scheduling/book`, `manual-book`), other writers of patient-linked resources not enumerated in Task 320 scope; no live-Medplum e2e added. BACKLOG.md not edited here to avoid conflicts with open PRs #236/#240/#241 — mark the gap resolved on merge.
