# PLAN Task 4 – lock POCT/PACS result receivers + fix 500 on missing status
Builder: Codex (security, high effort). Reviewers: Claude + Dev (security => both). Research: .ai/research/task4-labs-receive.md
Files: new `lib/server/device-api-key.ts`; `app/(routes)/api/labs/receive/route.ts`; `app/(routes)/api/imaging/receive/route.ts`; `lib/fhir/lab-service.ts` (status only).

1. Helper `verifyDeviceApiKey(request, body, envName)` -> `{ ok: true } | { ok: false, status: 401 }`.
   - Read expected key from `process.env[envName]`. If unset/empty: FAIL CLOSED (401) and `console.warn` once per process that the receiver is not configured (never print the key).
   - Provided key: header `x-api-key` first, else body `apiKey` (back-compat with documented curl example).
   - Compare with `crypto.timingSafeEqual` on SHA-256 digests of both strings (equal length).
2. Both routes call the helper BEFORE any other validation or DB access; 401 body `{ error: 'Unauthorized' }`.
3. Remove `details: error.message` from the 500 responses (log server-side only).
4. Labs: validate optional `result.status` against FHIR R4 Observation status codes (registered|preliminary|final|amended|corrected|cancelled|entered-in-error|unknown) -> 400 if invalid; when absent default to `final` in lab-service (Observation.status 1..1).
5. No change to session-authenticated routes, no new deps, no UI change.
Dev (tests, not Codex): e2e workflow 07 + seed send `x-api-key` from git-ignored `e2e/.secrets/poct_key`; box `.env.local` gets a random fake local POCT_API_KEY/PACS_API_KEY (never printed).
Accept: anon POST -> 401 (security test turns green), missing status -> 200 with status final, wrong key -> 401, valid header key -> 200; no regressions.

## Revised after Claude critique (binding)
- Verified: proxy.ts has no auth; the in-route key check is the only gate (comment it in the helper).
- Apply the `final` default in ONE place that runs before both the Observation status and the DiagnosticReport final/partial check (normalise results at the top of receiveLabResults), so DR status stays correct.
- Comment in routes: body `apiKey` is legacy back-compat only; header `x-api-key` is the supported way.
- Clinic isolation (shared key can write into any clinic's ServiceRequest) is OUT of scope now; logged in BACKLOG for POCT phase 2 (per-clinic Device + key, clinic match before write).
