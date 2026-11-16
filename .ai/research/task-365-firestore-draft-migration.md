# Task 365 research: legacy Firestore draft migration

Explicit task authorization (push, one draft PR into dev) overrides the general AGENTS "never push" rule for
this task only. No real Firebase, Supabase or production Medplum was contacted.

## Code read
- Legacy route: `app/api/consultations/plan/route.ts` at c5550dc (before #235). Firestore collection
  `consultation_treatment_plans`, document id = `draftId`, fields `draftId, clinicId?, patientId,
  consultationId?, entries, summary, createdAt, updatedAt`. Delete on clear-all. "Persistence unavailable"
  fallback when Firestore credentials were missing.
- New store: `lib/fhir/consultation-draft.ts` (key derivation, `authorize`, conditional create, If-Match update,
  cleared = `superseded` + `e30=`), `app/api/consultations/plan/route.ts`, `app/api/consultations/draft/route.ts`.
- Draft ids in use: `patient-profile-workspace.tsx:275`, `checkout-client.tsx:487`.
- Entry shape and total recomputation: `lib/treatment-plan.ts` (`normalizeTreatmentPlanEntry`).
- Review gate: `.ai/REVIEW-u1b-draft.md` (Task 170), `.ai/research/u1b-draft-retention.md`, DECISIONS (U1b).

## Docs
- https://www.medplum.com/docs/sdk/core.medplumclient.createresourceifnoneexist (conditional create)
- https://www.medplum.com/docs/sdk/core.medplumclient.updateresource (request options, If-Match)
- https://www.medplum.com/docs/access/access-policies (compartments, accounts)
- https://hl7.org/fhir/R4/http.html#concurrency and #ccreate
- https://hl7.org/fhir/R4/documentreference.html
- https://firebase.google.com/docs/firestore/query-data/get-data (collection get, Admin SDK)

## Dev Medplum trial (localhost:8113, fake data, 2026-11-16)
Hand-written fake export of two drafts (one visit, one pending) for a seeded demo patient.
- Dry-run: both `owner-unresolved` (dev encounters have no practitioner participant; `meta.author` is a Practitioner).
- With `--owner-from-encounter-author`: apply wrote 1; second apply `already-migrated`; rollback dry-run, rollback,
  repeat rollback `already-rolled-back`; re-apply `restore:previously-rolled-back`; final rollback.
- The clinic-account check passed for a client-credential write (draft inherited the patient's account).
- Left behind on dev: one cleared (`superseded`, `{}`) DocumentReference, identical to an app-cleared draft.
