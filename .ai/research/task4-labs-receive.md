# Task 4 research: lock /api/labs/receive + 500 on missing status

## Code facts
- `app/(routes)/api/labs/receive/route.ts`: checks key ONLY `if (process.env.POCT_API_KEY && body.apiKey !== key)` -> when env unset the endpoint is fully open to anonymous callers (e2e `security: /api/labs/receive requires auth or API key` fails on baseline). Plain `!==` (not timing-safe). Key only in JSON body. Error path returns `details: error.message` (internal leak).
- `lib/fhir/lab-service.ts receiveLabResults`: `status: result.status as any` -> undefined when omitted -> Medplum validation rejects (Observation.status is 1..1) -> 500. DiagnosticReport status = all final ? final : partial.
- `.env.local` on box: POCT_API_KEY not set.
- e2e workflow step 07 posts results with the logged-in session and no key; after locking it must send a key (fake local key in e2e/.secrets + .env.local, both git-ignored).

## Standards
- FHIR R4 Observation.status 1..1, required binding: registered|preliminary|final|amended|corrected|cancelled|entered-in-error|unknown. https://hl7.org/fhir/R4/observation.html
- DiagnosticReport.status 1..1 (registered|partial|preliminary|final|…). https://hl7.org/fhir/R4/diagnosticreport.html
- Node `crypto.timingSafeEqual` needs equal-length buffers (compare hashes). https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b
- OWASP API2:2023 Broken Authentication – fail closed. https://owasp.org/API-Security/editions/2023/en/0xa2-broken-authentication/

## Plan (Codex builds, both review = security)
1. Fail closed: if POCT_API_KEY unset -> 503 `{error:"POCT receiver not configured"}`? -> NO: test + clients expect 401/403 for anon; use 401 for both unset and wrong key (log a server warning once when unset).
2. Accept key from `x-api-key` header (preferred) or body `apiKey` (back-compat); timing-safe compare of SHA-256 digests.
3. Validate `status` if present against the R4 code list -> 400 on bad value; if absent default to `final` (POCT analysers send completed results; this matches the documented example). Decision logged.
4. Do not return `error.message` to callers; log it server-side.
5. e2e: send key via header from `e2e/.secrets/poct_key` (fake, local).
