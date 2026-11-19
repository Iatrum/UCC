# Task 721 — security review of Task 720 (CSRF guard)

## Verified
- **Inventory:** 61 route files export POST/PUT/PATCH/DELETE. 51 use cookie-capable auth helpers (`requireClinicAuth`/`requirePlatformAdmin`/`getMedplumForRequest`) and are covered by the proxy guard (matcher covers all `/api/*`).
  The 10 without helpers: `labs/receive[/message]`, `imaging/receive[/message]`, `imaging/report`, `pacs/orthanc/study` (all `authenticateDeviceKey`, no cookie fallback), `follow-up/twilio/status` (Twilio signature), `export-to-medplum` (bearer secret) — correctly exempt; `auth/login`, `auth/medplum-session` (pre-auth, correctly guarded: login-CSRF/fixation).
  `pacs/viewer/link`, `pacs/unmatched` use cookie auth and are guarded.
- **Exempt matching** is exact-segment (`/api/labs/receiver-x` is not exempt). Device/Twilio unit tests (task691, task680, twilio-status-signature) pass.
- **Origin bypass attempts:** missing Origin -> Sec-Fetch-Site decides (cross-site/same-site blocked; absent = non-browser or ancient browser; browsers always send Origin on cross-origin POST). `Origin: null` -> 403. Malformed -> 403. Referer deliberately unused (Origin is always sent on cross-origin mutating requests; a Referer fallback adds only spoofable surface). Scheme is not compared (host only); acceptable under HSTS.
- **X-Forwarded-Host:** attacker pages cannot set it (non-safelisted header => preflight, no CORS handlers). Vercel/Traefik overwrite client-supplied forwarded headers. Preview URLs: Host == Origin host, allowed (test added).
- **Same-origin legit calls** unaffected.

## Found + fixed
- **Duplicate-slash path bypass:** `startsWith("/api/")` missed `//api/...`, which may still route. Path is now slash-collapsed before the prefix/exempt tests; tests added.

## Residual
- GET side-effect scan is heuristic (as in Task 720); `register-extensions` GET is now 405.
- Set `CSRF_ALLOWED_ORIGINS` behind a non-forwarding proxy.
