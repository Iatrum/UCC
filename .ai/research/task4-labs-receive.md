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

## Builder verification (2026-10-31)
- Re-read both receivers, `proxy.ts`, and `receiveLabResults`: proxy only routes/forwards headers; receiver key checks are the only authentication gate. Per-clinic device keys and clinic matching are already recorded in `.ai/BACKLOG.md` (phase 2).
- Shared helper fails closed for unset/empty configuration and missing, empty, non-string or wrong credentials; `x-api-key` takes precedence even when empty/incorrect. Body `apiKey` remains legacy-only. Compare SHA-256 digests via [Node timingSafeEqual](https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b), which requires equal byte lengths; never log credentials.
- [NextRequest](https://nextjs.org/docs/app/api-reference/functions/next-request) extends the Web Request API. JSON parse failures become a null body so authentication still precedes payload validation: unauthenticated malformed requests return 401; authenticated malformed/null bodies return the existing serviceRequestId-required 400.
- The lab input type uses [FHIR R4 Observation.status](https://hl7.org/fhir/R4/observation.html) and permits omission. Route validation rejects all supplied values outside the eight R4 codes, including null/empty/non-string values. Normalize missing status to `final` once at the start of the service, before Observation creation and the [DiagnosticReport final/partial calculation](https://hl7.org/fhir/R4/diagnosticreport.html). This preserves partial reports for any explicit non-final status.
- [Medplum createResource](https://www.medplum.com/docs/sdk/core.medplumclient.createresource) accepts a typed FHIR resource; existing persistence operations remain unchanged. [React server function guidance](https://react.dev/reference/rsc/use-server) was checked; this helper is an ordinary server utility used by route handlers and does not need a Server Function directive.
- Scope: receiver authentication, status handling and generic 500 responses only. No e2e, environment, UI or dependency edits; no dev server, build, e2e or commit by the builder. Dev owns full acceptance checks.
- Builder validation: `NODE_OPTIONS=--max-old-space-size=3072 bun run lint` ran once and passed (exit 0); `git diff --check` passed. Runtime acceptance remains for Dev.
