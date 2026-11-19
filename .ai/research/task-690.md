# Task 690 - public / device-key API route hardening audit

Base: origin/dev @ 12df445. Method: static read of every anonymous or device-key route and the helper it reaches; unit tests only
(no dev server, no Playwright, fake data). Not redone (already fixed): Task 180 per-device keys, Task 355 `/api/imaging/report`
fail-closed auth, Task 541 Twilio signature, Task 645 audit (register-extensions, audit-log, clinic-id validation, G1-G11).
Task 619 has no research note in the repo; nothing of it was re-done. Twilio status callback is owned by open PR #332: not touched.

References: Next.js 16 route handlers https://nextjs.org/docs/app/api-reference/file-conventions/route ;
Fetch `ReadableStream` body reader https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultReader ;
OWASP API4 (unrestricted resource consumption) https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/

## Routes in scope
| Route | Auth | Gaps found (before) | Status |
|---|---|---|---|
| `labs/receive`, `labs/receive/message` | device key | no body cap, no rate limit; `message`: `request.json()` before auth so `null`/non-JSON -> TypeError -> 400 with `details: error.message`; 500 echoed `details: error.message` | FIXED |
| `imaging/receive`, `imaging/receive/message`, `imaging/report` | device key | same; `receive`: `body` `null` -> TypeError before auth; `study.series` missing -> 500 with message; free-text unbounded and not type-checked | FIXED |
| `pacs/orthanc/study` | device key | no rate limit/body cap; unknown errors via `handleRouteError` echoed `error.message` | FIXED |
| `auth/login` | credentials (Medplum throttles) | unexpected-error branch echoed `error.message` (can name internal host:port) | FIXED |
| `auth/medplum-session` POST | none (cookie setter) | `req.json()` throw -> 500; non-string/unbounded `accessToken` | FIXED (400, 8 KB cap) |
| `feedback` | CA + module flag + rate limit | no request-size cap before buffering; `parseScreenshot` ran regex/decode on unbounded string | FIXED (1.6 MB Content-Length cap, pre-decode length guard). Flow to GitHub unchanged |
| `health`, `health/deep` | none | env presence only (Task 645 G11) | OK |
| `follow-up/twilio/status` | HMAC signature | - | PR #332, skipped |

Fail-closed on missing env: device routes need no env key (key hash lives on the Device); no key / unknown / revoked / wrong-type =>
401, module off => 403 (Task 180, re-verified by tests). `orthanc/study` additionally 503s when PACS config is missing.
Authentication still runs before body validation (401 before 400) and the new size/rate checks run before any Medplum call.

## Changes
- `lib/server/device-ingress-http.ts` (new): `guardIngressRequest` (per-IP 120/min, Content-Length cap 256 KB, 4 KB for orthanc),
  `readJsonBody` (streamed byte cap, so a missing/lying Content-Length cannot bypass it; invalid JSON -> `null`),
  `ingressErrorResponse` (known classes -> 401/403/404/409/413; anything else -> fixed generic message, detail only in server log),
  `validateStudyPayload`, `validateReportText`.
- `lib/rate-limit.ts`: bounded bucket map (sweep expired, clear at 10k) so forged `X-Forwarded-For` values cannot grow memory forever.
- Message routes keep their old status (400) for unprocessable messages, but with a fixed message instead of the raw error text.
- Tests: `tests/unit/task690-public-route-hardening.test.ts` (8). Full `bun test tests/unit`: 1042 pass, 2 fail - both pre-existing on
  origin/dev and unrelated (`clinic scoping ... void/delete`, `generateSlotsForSchedule ... another clinic`). `tsc --noEmit` clean.

## Open / not changed (decisions needed)
1. `handleRouteError` still returns `error.message` for unhandled 500s on ~60 authenticated routes, and `soap-rewrite`,
   `referral-letter`, `smart-text/summary` return `error.message`. Not anonymous; the UI may show some of these messages, so a global
   switch to a generic message needs a UX pass. Recommend a follow-up task.
2. Rate limiting is in-memory and per instance (fine for the single-VPS deployment, weak on serverless/multi-instance). It keys on
   `X-Forwarded-For`, which is only trustworthy if the reverse proxy overwrites it. Device keys are 256-bit random, so brute force is
   infeasible; the limit is for cost/DoS control.
3. `auth/login` has no app-level limiter; it relies on Medplum's own token throttle (429 + Retry-After is passed through, tested in `auth-login-route.test.ts`).
4. `auth/medplum-session` POST stays unauthenticated by design (Task 645 G9).
