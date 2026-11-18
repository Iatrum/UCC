# Task 632 — review of Task 631 (nonce CSP, PR #318, head fd61cc0)

Verdict: **approve** (one doc-only addition pushed).

Checked
- Hosts: browser-side network use = Medplum (REST + ws, from NEXT_PUBLIC_MEDPLUM_BASE_URL; POCT live WebSocket uses the Medplum ws URL), Firebase client (lib/firebase.ts: auth/firestore/storage) -> googleapis hosts + authDomain in connect-src; Firebase Storage uploads are server-side (admin SDK, signed storage.googleapis.com URLs, in img/connect). Twilio/OpenRouter/Vision/GitHub are server-only. next/image goes through 'self'. No hardcoded external `src`/`fetch` URLs in components.
- Medplum Binary: staging/self-hosted storageBaseUrl is on the Medplum origin (infra/staging/up.sh), so covered; an S3/CDN redirect host needs `CSP_EXTRA_HOSTS` (supported, now documented in .env.staging.example).
- Production excludes localhost: `http://localhost:8103` and `unsafe-eval` only when NODE_ENV!=production; unit tests assert it. A localhost Medplum explicitly configured via env is still allowed (intended).
- Dynamic rendering: app/layout.tsx already awaits headers() (host/x-pathname), so every page was already dynamic; nonce adds no render-mode change. next.config headers() are static.
- Inline scripts: only next-themes needed a nonce (passed). No next/script, no script dangerouslySetInnerHTML (HTML injections are rich-text divs). iframes are srcDoc/blob (frame-src/child-src keep blob:/data:). react-pdf yoga uses 'wasm-unsafe-eval'.
- Secrets: header contains only public origins/nonce; nonce random per request (UUID, base64).
- Tests: bun test tests/unit 745 pass; tsc --noEmit clean (node_modules borrowed from main checkout). No browser/prod build run here (RAM).

Residual risks (not blocking)
- style-src 'unsafe-inline' remains (documented). Images/PDF from a new storage host will break until added to CSP_EXTRA_HOSTS: watch console for CSP errors on first staging deploy.
- Real Orthanc viewer and Firebase client flows not exercised by the author either.
- Earlier today I posted a PR comment from an outdated head (7a354c6, pre-631); this review supersedes it.
