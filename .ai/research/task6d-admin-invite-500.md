# Task 6d – Admin "invite user" always 500s

## Finding (admin e2e RUN 10310416, /workspace/ai-logs/admin-e2e/FINDINGS.md)
- POST /api/admin/users/invite -> 500 `Unexpected token '<' … not valid JSON`.
- lib/fhir/admin-service.ts:736 builds `${medplum.getBaseUrl()}/admin/projects/<id>/invite`; getBaseUrl() already ends with `/` -> `//admin/...` -> Medplum 404 HTML -> `response.json()` throws.
- Possible next blocker: invite needs a HealthcareService for the clinic (admin-service.ts:39) but branch creation (line ~387) only creates an Organization.

## Sources
- Medplum invite API: POST `/admin/projects/:projectId/invite` https://www.medplum.com/docs/user-management/invite-user (and https://www.medplum.com/docs/api/project-admin/invite)
- MedplumClient `getBaseUrl()` returns base URL with trailing slash; `medplum.post(url, body)` resolves relative paths: https://www.medplum.com/docs/sdk/core.medplumclient

## Plan
1. Use `medplum.post(medplum.fhirUrl? no -> 'admin/projects/<id>/invite', body)` or build the URL with `new URL('admin/projects/<id>/invite', medplum.getBaseUrl())`. Keep explicit headers only if needed.
2. Parse body defensively: if not JSON, throw a clear error with HTTP status (no HTML in the UI).
3. Re-run e2e/tests/admin.spec.ts; if the HealthcareService step then fails, fix within this task only if small, else backlog.

## Builder verification
- Installed `node_modules/@medplum/core/dist/esm/index.d.ts`: `getBaseUrl(): string` (3717), `post<T>(url: URL | string, ...)` (3818), `getAccessToken(): string | undefined` (4757). Kept fetch to handle malformed/non-JSON responses explicitly; `new URL(relativePath, baseUrl)` avoids the duplicate slash.
- Official invite endpoint documentation verified: https://www.medplum.com/docs/api/project-admin/invite ; SDK reference: https://www.medplum.com/docs/sdk/core.medplumclient . No React or Next API changes.
- Verified clinic creation only creates Organization. Clinic policy lookup now creates a missing HealthcareService with the exact selected clinic identifier and Organization reference, supporting existing clinics as well as new branches (7 added lines).
- Only requested admin Playwright spec will run; no check-all, commit, remote operations, or extra login.
- FHIR R4 HealthcareService fields verified against installed `@medplum/fhirtypes/dist/HealthcareService.d.ts` and https://hl7.org/fhir/R4/healthcareservice.html (`identifier`, `active`, `name`, `providedBy`).
- RUN 10310424: invite and user edit/clinic reassignment pass. Only spec run exited 1: existing expected-400 console check; successful DELETE response-body/navigation race. Fixed DELETE helper to avoid reading successful response bodies; no rerun because only one login is authorized. Full findings appended under “After 6d” in /workspace/ai-logs/admin-e2e/FINDINGS.md.

## Review fix loop 1
- Verified installed `@medplum/core/dist/esm/index.d.ts:4337`: `createResourceIfNoneExist<T extends Resource>(resource: T, query: string, options?: MedplumRequestOptions): Promise<WithId<T>>`.
- Official reference: https://www.medplum.com/docs/sdk/core.medplumclient.createresourceifnoneexist . Query contains only search parameters; shared helper uses URLSearchParams to encode `identifier=clinic|<clinicId>`.
- Branch creation now provisions the HealthcareService immediately after creating its Organization; invite policy lookup uses the same helper to backfill old clinics. No clinic-tenancy behavior changes.
- Admin validation console exception is scoped to the validation submission, exact endpoint URL, and exact expected Chromium HTTP 400 message; other errors remain failures.
- Per user instruction, TypeScript only; no Playwright, check-all, commit, or remote operations.
