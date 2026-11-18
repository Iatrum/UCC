# Task 631 - nonce CSP + host narrowing (PR #318)

Source: https://nextjs.org/docs/app/guides/content-security-policy (Next.js 16, updated 2026-03-20).
- Nonce CSP is set in proxy.ts (CSP on request + response headers, `x-nonce`); Next stamps framework/page scripts. Requires
  dynamic rendering for every page; docs warn of slower loads/no CDN cache/PPR incompatible. Dev needs `'unsafe-eval'`, prod does not.
- SRI (experimental) is the static alternative; not used.

## Decision: SHIP nonce
`app/layout.tsx` already calls `headers()` (host + x-pathname), so every page is already dynamically rendered. The nonce adds
no render-mode change, so no load-time cost. CSP builder moved out of next.config.js into `lib/security/csp.ts` (pure, tested),
applied by proxy.ts per request. Other static security headers stay in next.config.js.

## Changes
- script-src: `'self' 'nonce-…' 'wasm-unsafe-eval'` + Vercel hosts; `'unsafe-eval'` only when NODE_ENV!=production;
  no `'unsafe-inline'`. Deliberately NO `'strict-dynamic'` (it would ignore host allowlist and block Vercel Live, which is injected
  on previews without a nonce).
- next-themes inline init script needed the nonce: layout passes `nonce` from `x-nonce` (was the only un-nonced inline script).
- style-src keeps `'unsafe-inline'` (React style attributes/tiptap can't carry nonces; low risk vs scripts).
- connect-src/img-src: blanket `https:`/`wss:` removed. Explicit: Medplum origin (+ws) from NEXT_PUBLIC_MEDPLUM_BASE_URL,
  Firebase (storage, firestore, identitytoolkit, securetoken, googleapis, authDomain from env), googleusercontent (img), Vercel live/va.
  `http://localhost:8103` only when not production. Optional `CSP_EXTRA_HOSTS` (space/comma origins) for e.g. a CDN/S3 host that
  Medplum Binary downloads redirect to; ADD IT in staging/prod if images/PDFs fail to load (watch for CSP console errors).

## Verification (one dev server :3631 --webpack, dev Medplum :8113, fake data)
Temp Playwright specs (not committed) with securitypolicyviolation listener: UI login, dashboard, patient page with PACS module
off (X-ray toggle-off path), composer, checkout, MC/Time Chit preview + print iframes -> 0 violations. First run found the
next-themes violation, fixed. The Time Chit spec later fails at a PATCH /api/consultations 409 (API, unrelated to CSP; no app/api change).
Not run: production build (RAM); prod header content covered by unit tests. Not exercised: real Orthanc viewer, Firebase uploads.
