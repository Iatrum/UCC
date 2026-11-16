# Task 355 — close fail-open `/api/imaging/report`

## Findings
- `app/(routes)/api/imaging/report/route.ts` (origin/dev 52c2554): authenticated only `if (PACS_API_KEY && body.apiKey !== PACS_API_KEY)`, so with the env var unset anyone could create a `DiagnosticReport` on any study. `createImagingReport` also took the clinic from the ServiceRequest and never compared it to a caller. Logged as BACKLOG 5 / REVIEW-poct-device-keys residual risk 5.
- `/api/imaging/receive` (#236) already uses `authenticateDeviceKey(extractDeviceKey(request, body.apiKey), 'pacs')` (`lib/fhir/device-keys.ts`) → `AuthError` 401 / `ForbiddenError` 403, clinic from Device, `isModuleEnabledForClinic('pacs')` gate, and `assertOrderInDeviceClinic` (`lib/fhir/clinic-tenancy.ts`) for the order.

## Change
- Route: parse body leniently, authenticate FIRST (bad JSON w/o key = 401), then 400 validation (adds `status` ∈ preliminary|final), map AuthError→401, ForbiddenError→403.
- `createImagingReport(..., medplum, deviceClinicId)`: both now required (no implicit admin client). Reads ImagingStudy with `X-Medplum: extended`, runs `assertOrderInDeviceClinic` on the study AND on its `basedOn` ServiceRequest (a study without clinic identifier or without an originating order is refused: fail closed). Report clinic identifier = device clinic.
- Only caller outside the route: `e2e/tests/clinic-isolation.spec.ts` (updated).

## References
- Medplum search/params and Device: https://www.medplum.com/docs/api/fhir/resources/device
- FHIR R4 DiagnosticReport (no `imaging-study` search param; `imagingStudy` element): https://hl7.org/fhir/R4/diagnosticreport.html
- Next.js 16 route handlers: https://nextjs.org/docs/app/api-reference/file-conventions/route

## Tests
- `tests/unit/imaging-report-auth.test.ts` (9 tests; fake Medplum, real `authenticateDeviceKey`/route).
- `e2e/tests/xray.spec.ts` "Radiology report ingress…" against dev Medplum :8113 (fake data, cleaned up). xray/xray-phase2 specs all pass; `clinic-isolation.spec.ts` fails at "Observation update authorization" identically on clean origin/dev (pre-existing, lab path, unrelated).
- Full `check-all.sh` not run: it hardcodes unwritable `/workspace/ai-logs` paths on this VPS (same as Task 351). Ran `tsc --noEmit`, eslint on touched files, `bun test tests/unit` (151 pass).

## Merge order
No stack needed: #236, #240, #241, #246 and #247 are already merged in `dev`; this branch is based on `origin/dev` (52c2554). #245 and #248 are independent.
