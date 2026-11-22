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

## Task 802 follow-up: next-slowest screens (no code change)
Method as above: `next build --webpack` + `next start -p 3802` of the PR branch merged with origin/dev, one server, dev Medplum :8113,
fake data, `e2e/scripts/perf-screens.mjs` with 3 warm runs (median visible ms; server killed afterwards).

| Screen | Visible (ms) | Settled (ms) |
|---|---|---|
| Dashboard | 224 | 413 |
| Patients list | 394 | 515 |
| Patient profile | 366 | 418 |
| Consultation open | 283 | 449 |
| Lab tab | 368 | 487 |
| Billing/orders | 288 | 342 |
| Checkout | 170 | 383 |
| Inventory | 237 | 242 |
| Appointments | 343 | 284 |
| Analytics (warm) | 386 | 448 |

Candidates beyond the patients list: lab tab, patient profile, appointments, inventory. Checked each with a request trace
(start/end per fetch, 2nd load) and `curl` timings of the backing routes:
- **Lab tab** (`/patients/[id]/labs-imaging`): catalog and results fetches already start in parallel on mount, not gated on
  `/api/auth/me`; the server module lookup depends on clinicId so cannot be parallelised. `/api/labs/results` 28 ms, `/api/catalogs` 16 ms.
- **Patient profile**: the server page already `Promise.all`s patient, consultations, triage, appointments and modules;
  the encounter search is filtered by clinic + patient identifier and paged (Task 591). Document total ~90 ms.
- **Appointments list**: single ungated `/api/appointments` (25 ms). The new-appointment form and slots pilot gate on `authLoading`
  but are not in the table and live in files touched by open PRs (#354, #362), so left alone.
- **Inventory**: one ungated `/api/inventory` (17 ms, ~10 KB). The route maps full Medication resources, so `_elements` would change behaviour.
- Every backing route is 12-85 ms; the first client fetch starts ~190-240 ms after navigation (JS download + hydration),
  which is bundle/hydration cost, not sequential Medplum calls, over-fetching or a waterfall.

Result: no safe root-cause fix found. No app code changed in Task 802; the PR #370 table stays as is. A larger win would need
bundle/hydration work (e.g. server-prefetching list data), out of scope for a no-risk change.
