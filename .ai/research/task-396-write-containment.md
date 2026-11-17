# Task 396: write-side cross-clinic containment audit

Basis: D36 and `.ai/research/clinic-isolation.md` ("Phase 0 results"): Medplum AccessPolicy `criteria` gates read/search but not `create`, so each service must prove the Patient (and Encounter) belong to the caller's clinic before `createResource`. Medplum docs: https://www.medplum.com/docs/access/access-policies (criteria apply to read/search/update of existing resources; a create has no prior resource to match). FHIR R4 Observation/ServiceRequest `subject` is a plain reference, so the server will not validate tenancy.

## Audit (every `createResource`/`validateAndCreate`/bundle site in `lib/` and `app/`)
All patient-referencing create paths already call `assertPatientInClinic` / `assertOrderClinic` / `assertEncounterInClinic` / `makeClinicStamper` before writing (Tasks 320, 321, 350, 351):
- Orders: `createLabOrder`, `createImagingOrder` (X-ray and POCT gates unchanged).
- Referral, MC / letter documents (`createPatientDocument`), appointments, scheduling bookings, follow-ups, invoices, billing exception tasks, triage and check-in.
- Consultation save and update (Encounter, Condition, Observation, Procedure, MedicationRequest), the legacy mappers (`createScopedResource`), consultation drafts, exports.
- Device receive paths (`receiveLabResults`, `receiveImagingStudy`, `createImagingReport`) use `assertOrderInDeviceClinic` (clinic from the authenticated Device). `createProvenance` reads every target with the caller's client first.
- No patient reference at all (out of scope): suppliers, insurers, purchases, catalog, inventory, procedure definitions, feedback, subscriptions, schedules/slots.
- No callers: `saveFhirResource`, `createFhirResource`.

## Gap found and fixed
`getOrCreatePatient` (consultation save path, carries prescriptions) already rejected a foreign patient before any write, but with a plain `Error`, so the API answered 500. It now throws `ForbiddenError` (403).

## Tests
`tests/unit/write-containment-matrix.test.ts`: fake server, clinic-A caller, for 8 create paths (lab order, imaging order, referral, MC/document, appointment, follow-up, consultation prescription, MedicationRequest mapper): clinic-B patient => 403 via `handleRouteError` and zero writes; own clinic => created. Mutation check: removing the guard in `createImagingOrder` makes its test fail. The earlier lab/imaging regression test only asserted "some error" with an empty test list and never covered the own-clinic case.

## Not changed (follow-up, deliberately out of scope: not creation paths)
Update/delete-by-id helpers that read a resource and write it back without a clinic check: `updateAppointmentStatus`, `rescheduleAppointment`, `deleteAppointment`, `updatePatientDocument`, `updateBillingExceptionTaskStatus`, communication status updates. `updateReferralInMedplum` checks only when `clinicId` is passed. For policied memberships the preceding read is already denied for foreign resources; the remaining exposure is the unpolicied memberships (Task 090 Phase 2 migration). Recorded in BACKLOG.
