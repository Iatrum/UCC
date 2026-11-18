# Task 627 - verify PR #318 security headers against the app

Sources: MDN CSP (`frame-src`, `child-src`, `worker-src`, `object-src`, `base-uri`, srcdoc iframes inherit the embedder's CSP),
Next.js 16 `headers()` config docs, Medplum client (REST + websocket subscriptions).

## Header state (next.config.js)
- CSP is **enforcing** (`Content-Security-Policy`), NOT report-only. Recommendation: keep enforcing; do not flip anything.
- XFO DENY + `frame-ancestors 'none'`: no page of ours is framed. In-app iframes are all `srcDoc` (MC, Time Chit, referral,
  checkout/referral-MC-section document preview, template editor, hidden print iframe), i.e. child frames of our own page.
- OHIF/Orthanc viewer (X-ray toggle) opens via `window.open(..., '_blank')` / launch route redirect = top-level navigation in a new
  tab. Our CSP does not govern it and the viewer is not embedded, so `frame-src` needs no viewer origin. If the viewer is ever
  embedded, add its exact origin to `frame-src` (and the viewer must allow our origin in its own frame-ancestors).
- Firebase Storage / Google images: `img-src https:` and `connect-src https:` cover them. Fonts: none external (no next/font CDN,
  no Google Fonts); `font-src 'self' data:` plus Vercel Live on previews. Analytics: only vercel va script (allowed).
- Permissions-Policy `camera=(self)` is required by the patient ID scan pages; microphone/geolocation unused.

## Smoke (dev Medplum :8113, fake data, own dev server :3627, headless Chromium, `securitypolicyviolation` listener + console)
login -> dashboard queue -> patient page -> consult composer (Treatment) -> MC preview iframe (rendered) -> checkout ->
Documents tab Preview iframe (rendered) -> Print document (hidden srcdoc iframe): **0 CSP violations, 0 "Refused" console messages**.
Other console noise was unrelated: 401 on the unauthenticated /login probe, 404 `/api/billing` for a consultation without invoice.
Not exercised: real X-ray viewer launch (needs Orthanc), Firebase uploads, scan page camera.

## Follow-up recommendations (not applied, no violation observed)
- `script-src 'unsafe-inline' 'unsafe-eval'`: needed by Next today; nonce-based CSP via proxy.ts would be the tightening path.
- `connect-src https: wss:` and `img-src https:` are broad; narrow to explicit Firebase/Medplum/viewer hosts once the prod host list is fixed.
- `http://localhost:8103` in connect-src is dev-only noise in prod.
