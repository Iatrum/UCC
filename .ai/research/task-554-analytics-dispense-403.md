# Task 554: analytics "most dispensed" empty on dev (403 on MedicationDispense)

## Root cause (verified against dev Medplum 127.0.0.1:8113, fake data)
- `app/api/analytics/[tab]/route.ts` calls `requireClinicAuth(req)` (lib/server/medplum-auth.ts).
  - Normal mode: the client is the signed-in staff user's own token, governed by "UCC Clinic Staff Policy".
  - Local-auth-disabled mode (`NEXT_PUBLIC_DISABLE_AUTH=true`, non-production only): the client is `getAdminMedplum()`,
    the app service client, governed by "UCC App Server Policy".
- The code uses the correct client in both modes; the clinic filter (`identifier=clinic|<id>` + `resourceMatchesClinicTenant`) is unchanged.
- Dev's stored "UCC App Server Policy" (AccessPolicy a3b99fcc…) had 37 rules and lacked only `MedicationDispense`
  (diff vs `appServerPolicyResources()` in lib/fhir/clinic-access-policy.ts: missing=[MedicationDispense], extra=[]).
  `GET MedicationDispense` with that client returned 403. The dev "UCC Clinic Staff Policy" already had MedicationDispense.
- So the dev policy was stale (predates the Task 358 checkout stock deduction that added the type); not a code bug.

## Fix
- DEV ONLY: PUT of that single AccessPolicy with rules from `appServerPolicyResources()` (backup kept outside the repo).
  Afterwards `MedicationDispense` search returns 200. No code change.
- Production already has the updated policy; nothing to apply there. Staging: confirm `clinicStaffPolicyDrift` /
  `bun run medplum:setup-access` shows no drift for both policies.

## Verification (fake data, demo clinic)
- Staff session: `/api/analytics/clinical?range=30d` -> `mostDispensed = [Paracetamol x4]`; summary/money 200.
- Browser: Klinikal tab panel "Ubat paling banyak dispens" lists Paracetamol, no empty state.
  (The panel is on the Klinikal tab, not Duit & Operasi.)
- Task 552 review: truncation notice already exists on all three tabs; no other blockers.
