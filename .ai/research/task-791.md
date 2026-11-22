# Task 791 - per-screen load times (production build)

## Method
`next build --webpack` + `next start -p 3791` of origin/dev (239510c), one server, dev Medplum :8113, fake demo clinic
(100 fake patients, 1 fake consultation). Playwright (headless Chromium, 1440x900) logs in once, then per screen:
`goto(waitUntil: commit)` -> marker visible AND no `.animate-pulse`/`aria-busy` skeleton left. First load per screen is
discarded as warm-up (and reported as "first"); 5 warm runs, median. Script: `e2e/scripts/perf-screens.mjs`.
Host is shared with production on 2 vCPU, so run-to-run noise is roughly +-50 ms; differences under ~10% are noise.

## Research
- Next.js 16 App Router: layouts/pages render per request when they read cookies; streaming via Suspense (analytics already does this).
- Medplum search: `_count`, `_elements`, `_summary=count` already used by patient list/stats routes (server side ~60 ms per call, measured with curl).
- Task 537/706 already parallelised the layout, tenant resolution and dashboard reads.

## Findings
- No screen exceeds ~600 ms warm; server time per route is 20-120 ms. Remaining time is hydration + client fetches.
- Patients list was the slowest steady screen. Both its reads (`/api/patients?stats=1`, `?page=`) waited for the
  browser auth round-trip (`/api/auth/me`, ~100 ms) although the API authenticates by session cookie. Dashboard got
  the same fix in Task 706; patients list did not. Trace: request start 442 ms -> 240 ms.
- Analytics: first (uncached) summary ~1.5-1.9 s; warm hits use the 7d TTL cache and stream behind the heading. Not changed.
- Patient profile / consultation: composer-adjacent client code; deliberately untouched.

## Fix
`app/(routes)/patients/page.tsx`: drop the `authLoading` gate on both reads (start on mount). No API/behaviour change.

## Results (median ms to meaningful content, 5 warm runs)
See PR body table. Only the patients list changed; the other rows are the same code measured twice and show the noise floor.
