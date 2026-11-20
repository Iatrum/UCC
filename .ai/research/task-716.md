# Task 716 — Dashboard LCP and comparison routes

## Research

- Next.js 16 recommends comparing optimized builds with `next build` and `next start`. [Production checklist](https://nextjs.org/docs/app/guides/production-checklist)
- The LCP API supplies both the timing and DOM element for each candidate. Capture candidates during the hard navigation before any user input. [W3C Largest Contentful Paint](https://www.w3.org/TR/largest-contentful-paint/)
- React 19 Effects start the secondary Dashboard reads. They can overlap browser session restoration on the PR when a server-authenticated queue has arrived. [React useEffect](https://react.dev/reference/react/useEffect#fetching-data-with-effects)
- Medplum serves the clinic-scoped FHIR searches. The dev service at port 8113 runs 5.2.15. [Medplum 5.2.8](https://github.com/medplum/medplum/releases/tag/v5.2.8), [FHIR R4 Search](https://hl7.org/fhir/R4/search.html)
- DICOMweb is outside the measured request paths. [DICOM PS3.18](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/ps3.18.html)

The comparison is between exact `origin/dev` (`b22d32e`) and the draft PR #341 head (`5f5efd0`). Task 707 had already extended the PR with test and documentation changes. The runtime diff is restricted to the Dashboard client.

## Production benchmark

Both revisions were built from source with Next.js 16.4.5 and `build:ci` (webpack), then served with `next start` on `127.0.0.1:3716` with a 3072 MiB heap cap. Only one Next server ran at any time. Playwright 1.59.1 Chromium used a 1440 × 900 viewport, the same authenticated fake-clinic session, and dev Medplum on `127.0.0.1:8113`.

The main comparison used six adjacent build pairs. Pair order alternated dev/PR and PR/dev. Both blocks in a pair used the same screen order, and screen order rotated across pairs. Each block used a fresh browser context. Each screen warmed once, then contributed three hard navigations using the same context and normal HTTP caching. All 18 warm samples per screen and build were retained. Canonical response fingerprints for appointments, billable orders and inventory, plus the visible queue row count, matched within every pair. No navigation interacted with the page or intercepted requests.

Usable time measures the first animation frame with a visible Dashboard queue table, Inventory Overview tab, or Ready for Billing card. Dashboard all-data time additionally waits for both tab response bodies. A buffered `PerformanceObserver` records the last LCP candidate through network idle. Request counts through network idle include the document, assets and prefetches. API counts include same-origin `/api/` requests. Every measured Dashboard navigation made zero browser queue requests.

Timings show median [25th–75th percentile] in milliseconds. Request counts show medians.

| Screen | Usable dev → PR (ms) | LCP dev → PR (ms) | Browser requests dev → PR | API requests dev → PR |
| --- | ---: | ---: | ---: | ---: |
| Dashboard queue | 344.5 [292.4–397.5] → 329.2 [301.8–389.2] | 122 [101–183] → 130 [109–166] | 54 → 54 | 4 → 4 |
| Dashboard all data | 571.6 [520.6–789.2] → 579.7 [507.4–689.4] | Same navigation | Same navigation | Same navigation |
| Inventory | 358.3 [268.4–422.6] → 295.0 [266.8–356.2] | 386 [287–454] → 318 [292–383] | 50 → 51 | 3 → 3 |
| Billing | 317.1 [274.7–430.4] → 299.6 [273.2–321.4] | 346 [290–466] → 328 [287–342] | 58 → 58 | 3 → 3 |

The paired Dashboard LCP differences (PR minus dev) were +140, −48, +36, +40, −64 and −64 ms. The median paired difference was −6 ms. The queue's pooled median fell 15.3 ms, with a +14.4 ms median paired difference. The wide variation across pairs leaves the ordinary loopback usable-time effect uncertain.

Inventory and Billing both ran faster in the pooled sample, reversing the earlier slowdowns. Inventory usable time improved in five of six pairs, and Billing did as well. The only runtime diff is the Dashboard client. The comparison routes show no reproduced PR regression.

## Dashboard LCP follow-up

Six more counterbalanced Dashboard-only pairs added 18 warm navigations per build. The follow-up produced 371.5 [331.9–408.6] → 338.2 [326.3–397.7] ms for usable time and 144 [116–172] → 116 [97–145] ms for LCP.

| Dashboard metric | Dev, 36 warm navigations | PR, 36 warm navigations |
| --- | ---: | ---: |
| Queue usable (ms) | 367.3 [312.0–402.0] | 332.8 [319.6–397.6] |
| All data available (ms) | 582.8 [522.9–755.4] | 569.8 [512.2–731.0] |
| LCP (ms) | 136 [104–181] | 122 [100–157] |
| Browser requests | 54 | 54 |
| API requests | 4 | 4 |

The 12-pair median differences (PR minus dev) were −12.8 ms for queue usable, −29.1 ms for all data and −42 ms for LCP. The exploratory 95% bootstrap intervals, resampling whole pairs, were −58.7 to +25.5 ms, −125.2 to +24.0 ms, and −48 to +26 ms, respectively. The pooled medians favor the PR, with substantial run-to-run spread. Queue usable ranged from 239.7 to 550.5 ms on dev and 254.5 to 589.1 ms on the PR. LCP ranged from 80 to 556 ms and 84 to 464 ms, respectively.

The Dashboard LCP was the same `main p.text-sm.text-muted-foreground` in 36/36 warm samples on each build. Its text is “Live clinic queue, upcoming appointments, and documents ready for billing.” The shared `DashboardHeader` renders it in both the streaming fallback and the hydrated route. All final candidates were text, with the same reported area (8,544 CSS px²). Resource Timing recorded zero font downloads. The follow-up also observed the same cached 107,742-byte stylesheet and 31 cached JavaScript resources on each build, with 107 additional decoded JavaScript bytes on the PR.

LCP preceded the first secondary-tab request in 33/36 samples per build, by a median of 218 ms on dev and 211 ms on the PR. The other three navigations in each build hit the same pairs (2, 5 and 7). In those six cases LCP equaled first contentful paint and arrived before either tab response finished. The PR started a tab request before browser auth completed in 1/36 ordinary runs (dev 0/36). The suspected tab contention cannot explain a systematic shift in the early paint. The most consistent explanation for the earlier aggregate LCP increase is timing noise in the shared-host measurement. Task 716 updates the evidence only. Task 706's controlled trace and the concurrency spec cover the early-tab behavior when auth is still pending.

Raw timing capture and the local sampler are under `/home/dev/ucc-716-evidence` on the benchmark host.

## Verification

- `tsc --noEmit`, repository lint, focused ESLint and the production build passed. The Bun unit suite passed 1,227/1,227.
- `e2e/scripts/check-all.sh task-716` recorded 72 passed, 20 failed and 6 skipped. The comparator found zero new browser failures and zero missing tests against the saved Task 665 local results. The Task 706 dashboard concurrency spec, Dashboard load and retry specs, composer plan tests and four-clinic isolation scenario passed.
- The overall gate exited 1 because the read-only clinic audit still flags one fake Patient with an invalid clinic identifier and one invalid account assignment. Both findings were recorded on exact dev in the Task 706 audit.
- All benchmark and validation Next process groups stopped. Port 3716 was closed after verification.
