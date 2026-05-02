# Appointment Clinic Scope Plan

Goal: make sure doctors and staff can only access appointment data for their own clinic, without changing more of the app than needed.

Current principle

- Doctor/staff users may only see and modify data for clinics they are assigned to.
- Clinic assignment is based on PractitionerRole.organization.
- Clinic data ownership should be tied to Organization.
- Platform admin routes remain separate and can use admin privileges.

Current appointment findings

- `app/api/appointments/route.ts` currently uses `getMedplumForRequest()`.
- That confirms the user is authenticated, but does not by itself enforce clinic assignment.
- `lib/fhir/appointment-service.ts` creates FHIR Appointment resources with:
  - Patient participant
  - Clinician display text
  - Reason/status/date
- Appointment does not currently store a clear clinic Organization reference.
- Patient resources already carry clinic ownership:
  - `Patient.managingOrganization = Organization/{clinicId}`
  - clinic identifier with `system: "clinic"`

Recommended first implementation

Use patient-based clinic enforcement first. This avoids changing Appointment FHIR shape immediately and reduces regression risk.

For `/api/appointments`:

1. Replace route-level auth with `requireClinicAuth(req)`.
2. On create:
   - Get `{ medplum, clinicId }` from `requireClinicAuth(req)`.
   - Read the selected Patient through `getPatientFromMedplum(patientId, clinicId, medplum)`.
   - If patient is not found for that clinic, return forbidden/not found.
   - Create appointment only after patient clinic ownership is verified.
3. On list upcoming:
   - Fetch upcoming appointments.
   - For each appointment, resolve its Patient participant.
   - Keep only appointments where the Patient belongs to the current clinic.
4. On list by patient:
   - Verify the Patient belongs to the current clinic first.
   - Then return that patient's appointments.
5. On read/update/delete by appointment ID:
   - Read Appointment.
   - Extract Patient participant.
   - Verify Patient belongs to current clinic.
   - Only then return/update/delete.

Files to touch in first PR

- `app/api/appointments/route.ts`
- `lib/fhir/appointment-service.ts`
- test file for appointment clinic scoping, exact location to follow existing test structure

Do not touch in first PR

- Medplum AccessPolicy provisioning
- global auth/session logic
- unrelated clinical routes
- Appointment FHIR schema beyond what is needed for safe scoping

Why this is safest

- It changes one workflow only: appointments.
- It uses existing Patient clinic ownership.
- It does not require data migration for existing appointments.
- It can be tested with existing appointment create/list/update/delete flows.

Known limitation

Patient-based appointment scoping is safe but not ideal long term. The cleaner long-term model is to also tag Appointment directly with clinic ownership.

Recommended second-stage improvement

After the first PR is verified:

1. Add direct clinic ownership to Appointment, for example:
   - Appointment identifier `{ system: "clinic", value: clinicId }`, and/or
   - supportingInformation/reference to `Organization/{clinicId}` if compatible with the chosen FHIR profile.
2. Update appointment searches to query by direct clinic tag where possible.
3. Add Medplum AccessPolicy criteria for clinic-scoped Appointment access.
4. Consider a migration/backfill for existing appointments.

Testing requirement

Hidayat should not need to manually test this. The implementer must verify:

1. Build passes.
2. Lint passes.
3. Login still works.
4. Correct clinic user can:
   - view appointments
   - create appointment
   - update appointment status
   - reschedule appointment
   - delete/cancel appointment if supported
5. Wrong clinic user cannot access another clinic's patient appointments by direct API call.
6. Browser console has no new errors.
7. API returns clear error for forbidden cross-clinic access.

Suggested rollout

Stage 1: Appointment route only.

Stage 2: If appointment workflow is stable, apply the same pattern to:

- check-in
- triage
- orders
- documents
- referrals

Stage 3: Review remaining service-layer admin client usage and Medplum AccessPolicy criteria.

Decision

Proceed with Stage 1 first. Keep the PR small and easy to test.
