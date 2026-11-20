# Task 720 — CSRF audit of state-changing API routes / server actions

Sources: OWASP CSRF Prevention Cheat Sheet (verify Origin/Referer, Fetch Metadata, SameSite as defence in depth);
Next.js 16 docs "Data security" (Server Actions compare `Origin` to `Host`/`X-Forwarded-Host`; `serverActions.allowedOrigins`;
Route Handlers get NO built-in CSRF protection); MDN SameSite (Lax = cookies withheld on cross-SITE subrequests, sent on top-level GET
navigations; same-SITE = same registrable domain, so sibling subdomains are NOT protected).

## Findings
- **Server actions:** the only `'use server'` file is `lib/module-registry.ts` (server helpers, not form-bound actions). Next's built-in
  Origin check applies; no `allowedOrigins` configured (none needed). No gap.
- **Cookie auth:** `getMedplumForRequest` takes `Authorization: Bearer` first, else the `medplum-session` cookie. ~60 route files
  (all `requireClinicAuth` / `requirePlatformAdmin` / `getMedplumForRequest` routes) rely on it.
- **Cookie flags** (login route, `lib/server/medplum-auth.ts`, `medplum-session` route): `medplum-session` / `medplum-refresh` =
  `HttpOnly`, `SameSite=Lax`, `Secure` in production, path `/`, optional `Domain=COOKIE_DOMAIN` (shared across subdomains).
  `medplum-clinic` is non-HttpOnly (Lax, Secure in prod).
- **Own auth, not cookie (left untouched):** device key `/api/labs/receive[/message]`, `/api/imaging/receive[/message]`, `/api/imaging/report`,
  `/api/pacs/orthanc/study`; Twilio signature `/api/follow-up/twilio/status`; bearer secret `/api/export-to-medplum`.
  PACS viewer routes use a study-scoped viewer cookie on a separate origin, GET read-only.

## Gaps (real)
1. **No Origin check on any cookie-authenticated mutating route.** Handlers parse `req.json()` / `formData()` regardless of Content-Type, so
   `text/plain` or multipart "simple" cross-origin requests need no preflight. SameSite=Lax blocks these from foreign *sites*, but clinics
   are sibling subdomains (same-site) and `COOKIE_DOMAIN` shares the cookie, so a page on one clinic subdomain (or any subdomain an attacker
   controls) can drive another's API with the victim's cookie. Also the unauthenticated `POST /api/auth/medplum-session` (sets session cookie
   from a posted token) is exposed to login-CSRF / session fixation the same way.
2. **GET with side effects:** `GET /api/fhir/register-extensions` aliased POST (platform-admin write). Lax cookies ride top-level GET
   navigations, so a link could trigger it. Other GET handlers were scanned (heuristic grep) for create/update/delete/patch/batch calls: none.

## Fix (smallest safe)
- `lib/security/csrf.ts` `checkCsrf` (pure) called from `proxy.ts` for non-GET/HEAD/OPTIONS `/api/*`: allow when `Origin` host == request host
  (`x-forwarded-host` first) or is in optional `CSRF_ALLOWED_ORIGINS` (comma-separated origins); reject otherwise (403, no header echo).
  No Origin -> Sec-Fetch-Site must be `same-origin`/`none`/absent; non-browser callers (no headers) pass. Exempt: the device/Twilio/bulk-export
  prefixes above (exact segment match). No login-flow, UI or nav change.
- `register-extensions` GET now returns 405 (POST only).
- Tests: `tests/unit/task720-csrf.test.ts` (allowed/rejected/exempt/look-alike), `task645-api-audit.test.ts` updated for GET 405.

## Verification
- tsc + `check-clinic-admin-medplum` lint pass; eslint on touched files clean; unit 1237 pass / 1 fail (`task639-scheduling-slots`
  "refuses a schedule that belongs to another clinic" — fails identically without these changes).
- Live dev server (:3720): `POST /api/auth/medplum-session` text/plain with `Origin: https://evil.test` -> 403; same Origin -> 200; no Origin -> 200;
  `POST /api/labs/receive` with evil Origin reaches its own device-key auth (401).
- e2e `workflow.spec.ts` 01 login .. 04 start consultation + Sign: 4/4 pass. Server killed afterwards.
- Not run: full `check-all.sh` gate (only the one requested e2e).
- Deploy note: if the app is served from an origin that differs from the Host it receives (non-forwarding proxy), set `CSRF_ALLOWED_ORIGINS`.
