# Task 812 (pilot A7): Time Chit staff walk

## What already existed
- `e2e/tests/time-chit-staff.spec.ts` (commit 061ae87): non-admin walk that issues a chit and checks the Documents preview/print for patient + doctor, but not clinic letterhead, the time range text, or a foreign-clinic user.
- `e2e/tests/time-chit.spec.ts`: wide core spec (checkout PDF, validation, foreign-clinic API/raw FHIR denial, no module switch).
- `tests/unit/time-chit.test.ts`: validation, no module id, guard, escaping.
- Shared template: `lib/document-render.ts` -> `renderDocumentHtml({kind:'time-chit'})` -> `fillTimeChitTemplate`; MC/referral use the same `common` letterhead/patient fields and `/api/organization`.

## What the walk now covers (fake data, non-admin `doctor@ucc.local`)
1. `/api/auth/me` non-admin; `time-chit` is not a module id (legacy id ignored).
2. Register fake patient + visit, open patient > Treatment, add TIME CHIT, fill date/in/out/doctor, see duration, Complete document, Sign.
3. Saved consultation holds exactly one `time-chit` procedure (hours server-derived 1.5).
4. Reload > Documents tab lists exactly one Time Chit; preview and print iframe show title, patient name + NRIC, letterhead (= `/api/organization`), "19 Nov 2026 from 09:00 to 10:30 (1.5 hours)", doctor, "not a Medical Certificate".
5. Fake user in a fake foreign clinic (admin invite, removed afterwards): `/api/consultations?id=` and `/api/orders?...` return 403/404; raw FHIR `Procedure/<id>` 403/404 and search returns 0 entries.

## Findings
- No Time Chit bug. Test-side surprises: plural label "1.5 hours" (hoursLabel, by design); print iframe is aria-hidden so use count not visibility; production `next start` sets Secure cookies so the base URL must be `http://localhost:<port>` (not 127.0.0.1) for Playwright's API context.
- Observation (not fixed, shared with MC/referral): the letterhead name comes from `getParentOrganizationFromMedplum()` = first parent organisation (practice-level), not the per-clinic Organization. Fine for a single-practice pilot; revisit if clinics under one project need their own letterhead.

## How it was run
`next build --webpack`, `next start -p 3812` (one server, heap 3072), `UCC_BASE_URL=http://localhost:3812 timeout 480 npx playwright test tests/time-chit-staff.spec.ts` -> 1 passed. Server process group killed afterwards. `bun run lint` OK, 53 unit tests pass (time-chit, document-render, task682-document-templates).
Docs: https://playwright.dev/docs/api-testing, https://www.medplum.com/docs/access/access-policies, https://hl7.org/fhir/R4/procedure.html
