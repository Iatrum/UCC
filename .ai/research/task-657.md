# Task 657 — PILOT-READINESS A7: Time Chit staff walk (dev, fake data)

Spec: `e2e/tests/time-chit-staff.spec.ts` (one test, ~2.7 min). Run on a single dev server (`next dev --webpack -p 3657`,
`NODE_OPTIONS=--max-old-space-size=3072`) against dev Medplum `:8113`, wrapped in `timeout`; server process group killed afterwards.
Sources: existing `e2e/tests/time-chit.spec.ts`, `lib/document-templates.ts` (DEFAULT_TIME_CHIT_TEMPLATE), `.ai/research/task-549.md`, `task-637.md`.

## What the walk does (all as a NON-admin staff user)
1. Medplum admin invites a throwaway user into the `demo` clinic (`/api/admin/users/invite`); everything after runs on that user's session.
   Asserts the staff session gets 401/403 on `/api/admin/users/invite` (not an admin).
2. Staff creates a fake patient + visit, opens Treatment, adds Time Chit (date 2026-11-14, 09:15-11:45, "Dr Fake Walk"), duration shows 2.5 h,
   composer preview iframe shows the template and the patient name, Complete document, Sign (POST /api/orders 200).
3. Patient Documents tab -> Time Chit preview: asserts "TIME CHIT / SURAT MASA", patient name, NRIC, clinic letterhead, "14 Nov 2026", 09:15, 11:45,
   "not a Medical Certificate", no demo-template patient; Print / Save PDF opens the hidden print iframe. Screenshot: `.ai/evidence/task-657-time-chit-staff-preview.png`.
4. Stored Procedure note has `tcHours: 2.5` and carries the `clinic|demo` identifier.
5. Lock: re-sending the signed procedures unchanged -> 200; changing time-out -> 409 (message mentions "signed"); deleting it (empty list) -> 409;
   exactly one Time Chit remains, unchanged.
6. Cleanup removes the Practitioner/role/membership and the catalog row. Medplum 429 on login is retried per Retry-After.

Result: PASS (1 passed, 2.7 min).

## Finding (not changed): letterhead is the PARENT organisation, not the caller's clinic
First run expected the clinic's own name ("Demo UCC Clinic") in the print; it showed "Klinik Bravo". Cause: `GET /api/organization`
(`app/api/organization/route.ts`) returns `getParentOrganizationFromMedplum()` = `parents[0]` of ALL standalone orgs, regardless of the caller's clinic
(`lib/fhir/admin-service.ts` `getParentOrganizationsFromMedplum`). In dev data the demo clinic is `partOf` Klinik Bravo (itself a clinic org, picked by the
single-company legacy fallback), so the result happens to equal the demo clinic's parent and the walk asserts exactly that.
Risk: on an install with more than one parent company/standalone clinic, every clinic's MC/Time Chit/referral letterhead would show the first one found, and
`PUT /api/organization` would edit that same org with the admin client. Not changed here because the intended letterhead semantics (company vs clinic, and the
Settings page that edits it) are a product decision and production is single-company; added to BACKLOG for a decision.
