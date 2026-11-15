# Task 160: durable unsigned draft retention

## Research before implementation
Base: origin/ai/task-u1b-save-state e66086d (PR #234). Explicit task-specific push/PR authorization overrides the general AGENTS restriction. Local Medplum only (:8113); no production services used.

- `patient-profile-workspace.tsx`: clinicalNotes and diagnosis live only in React state; first clinical persistence is POST /api/consultations on Sign. Closing the panel retains state but reload loses it.
- `OrderComposer`: optimistic in-memory entries plus GET/POST/DELETE `/api/consultations/plan`. That route uses Firestore and reports unavailable persistence. Its keys are patient/visit based, with only optional clinic checks and no practitioner ownership. Preserve its response contract and Task 150 status/retry behavior while replacing this draft backend only. Firebase Storage uploads stay unchanged.
- `clinic-access-policy.ts`: DocumentReference already supports patient-compartment inheritance, metadata stripping on create, account write constraints, and update/delete compartment checks. Use the acting client, not privileged writes. `assertOrderClinic` verifies patient and encounter in the authenticated clinic with fresh extended reads. Add explicit clinic identifier, patient, author and deterministic scoped draft-key checks on every draft lookup. No policy rollout required.
- Choose preliminary DocumentReference resources containing JSON form snapshots, keyed by SHA256(clinic, practitioner, patient, visit/draft kind). Subject is Patient, author is authenticated Practitioner. App API returns only this practitioner's drafts. Existing Phase 2 policy isolates clinics; it does not make practitioner authorship a direct-FHIR security boundary within a clinic.
- Do not use localStorage/sessionStorage for clinical text (PDPA). Base64 attachment data is a FHIR encoding, not encryption. Storage remains in the authenticated Medplum backend. Existing Firestore drafts are not imported because this task must not contact production/Firestore; historical import requires a separate scoped migration.
- Conditional creates prevent duplicate draft resources. Version-conditional updates prevent silently overwriting concurrent changes. Serialize client edits and wait before signing/clearing. Guard unload and in-app navigation while work lacks server confirmation; no sidebar/nav layout changes.

## Official sources reviewed
- https://www.medplum.com/docs/access/access-policies — resource criteria, compartments and write constraints; checked against installed policy builder.
- https://www.medplum.com/docs/sdk/core.medplumclient.createresourceifnoneexist — conditional creation, verified in installed SDK declaration.
- https://www.medplum.com/docs/sdk/core.medplumclient.updateresource — request options, verified in installed SDK declaration.
- https://hl7.org/fhir/R4/documentreference.html — preliminary document state, patient subject, author and attachment content.
- https://hl7.org/fhir/R4/http.html#concurrency — If-Match version checks.
- https://react.dev/reference/react/useEffect — clean up obsolete hydration responses and listeners.
- https://nextjs.org/docs/app/api-reference/functions/use-router — App Router navigation; no Pages Router router.events API.

## Validation
Pending implementation, local screenshots, focused retention/save-state specs, lint, full tsc, unit, workflow and one full gate.

## Final validation and rollout limit
Real local policy integration verified draft accounts inherit only the patient's clinic, edits/cleanup work, wrong selected clinic is rejected even for multi-clinic staff, and reassignment revokes direct draft access. Four retention tests and seven save-state tests pass. Lint/tsc, 34 unit tests, build and clinic inventory pass. Single full gate was 47/51 FAIL; after test synchronization/port corrections only, focused recovery yields combined 50/51, baseline summary only, zero skipped, comparator 0. Original gate remains FAIL; detailed evidence is in progress.

Historical Firestore drafts were not read or imported. Deployment of the backend switch requires a legacy-draft transition plan; this draft PR does not authorize that production work. Superseded draft contents remain in FHIR audit history under existing retention controls.
