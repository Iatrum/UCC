# Task 482 — Task 475 review follow-ups (PR #267)

Basis: `.ai/research/task422.md` rule — id-addressed foreign/missing => 404 (Medplum AccessPolicy already behaves this way: [Medplum access policies](https://www.medplum.com/docs/access/access-policies)); caller-supplied patient reference foreign/missing => 403 (`assertOrderClinic`).
Reading `meta.accounts` needs `X-Medplum: extended` ([Medplum extended header](https://www.medplum.com/docs/access/projects)), as already used in Task 330/400.

## Changes
- `assertStoredResourceInClinic(medplum, stored, clinicId, label)`: explicit clinic tag required, no conflicting tag, every `meta.accounts` entry equals the clinic tenant account; else `NotFoundError`. Empty clinic => `ForbiddenError`.
- Appointments: `readAppointmentForMutation` uses it, then `assertPatientInClinic` on the stored patient participant.
- Lab/imaging order update/delete: `readOrderForMutation` (extended read + assert) before `assertPoctOrderMutable` / `assertXrayOrderMutable`.
- Tests with fake servers; guard removal verified to fail them (stored assert off: 65 fails; appointment patient check off: 9; documents DELETE authz off: 2).

## Not changed
Task 400 helpers still return 403 for a foreign id (own tests pin that). Documents route already authorized before deleting; now test-pinned.
