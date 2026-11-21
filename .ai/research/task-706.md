# Task 706 — Dashboard request waterfall

## Sources

- Next.js 16 documents parallel starts for independent reads and streamed route segments. [Fetching Data](https://nextjs.org/docs/app/getting-started/fetching-data#sequential-and-parallel-data-fetching)
- React 19 documents how Effects that start data reads can create request waterfalls. [Fetching data with Effects](https://react.dev/reference/react/useEffect#fetching-data-with-effects)
- The requested Medplum 5.2.8 reference and the FHIR R4 HTTP specification describe FHIR searches and the batch interaction. Dev port 8113 reported Medplum 5.2.15, and the lockfile pins the SDK at 5.1.13. [Medplum 5.2.8](https://github.com/medplum/medplum/releases/tag/v5.2.8), [FHIR R4 RESTful API](https://hl7.org/fhir/R4/http.html)
- DICOM PS3.18 specifies the imaging web service. Dashboard queue, appointment and billable-list reads do not use it. [DICOM PS3.18](https://dicom.nema.org/medical/dicom/current/output/chtml/part18/ps3.18.html)

## Code and browser trace

Baseline is origin/dev `b22d32e`. The dashboard's initial queue already arrives in the streamed document through `requireClinicPageAuth` and `getTriageQueueForToday`. Healthy loads issue zero browser `/api/queue` requests. The queue service starts its clinic-ownership lookup and clinic-filtered Encounter search in parallel, using `_include=Encounter:subject`, and still handles pagination and missing patient includes.

The shared auth provider starts `/api/auth/medplum-session` and `/api/auth/me` together. On dev, the dashboard waits for that effect to finish before starting `/api/appointments` and `/api/orders/billable` together. The latter two routes authorize independently via the existing session cookie. The dashboard now starts those two reads as soon as it mounts with a server-provided queue, including an empty queue. Queue fallback, periodic refresh, and the no-server-data path still wait for browser session readiness. The existing tab loaders and retry callbacks retain their endpoints and error behavior.

Inventory loads one inventory API read. Billing renders its list from the server and also refreshes it from `/api/orders/billable` after hydration. Those pages serve as comparison screens.

## Warm browser measurements

Playwright Chromium 1440 × 900, Next.js 16.4.5 webpack production build and `next start` on loopback port 3706, same authenticated fake clinic and dev Medplum at 8113 on the same host. One Next process group at a time with a 3072 MiB heap cap. Order was dev → PR → dev → PR → dev → PR. Each block warmed each screen once, then measured four full document navigations in the same browser context for 12 warm samples per build per screen. Each run waited for network idle before the next. LCP comes from a buffered `PerformanceObserver`. Request counts include the document, assets and RSC prefetches through network idle, before the queue poll.

Usable time is the first visible queue table on Dashboard, the overview tab on Inventory, and the billing list card/table on Billing. The all-data milestone is the later of visible queue and both dashboard tab response bodies finishing, measured in the same run before any tab clicks. That milestone measures data availability for the secondary tabs.

| Screen | Usable, dev → PR (ms) | LCP, dev → PR (ms) | Browser requests, dev → PR | API requests, dev → PR |
| --- | ---: | ---: | ---: | ---: |
| Dashboard queue | 366.5 → 347.5 | 140 → 172 | 54 → 54 | 4 → 4 |
| Dashboard all data available | 586.5 → 563 | Same navigation | Same navigation | Same navigation |
| Inventory | 317 → 360 | 344 → 404 | 48.5 → 48 | 3 → 3 |
| Billing | 331 → 357.5 | 362 → 382 | 53.5 → 53 | 3 → 3 |

Block medians for usable time were 398.5 / 378 / 327.5 ms on dev and 557.5 / 323 / 307 ms on the PR for the queue. For dashboard all data they were 687 / 617 / 552 ms and 1099.5 / 563 / 529.5 ms. The first PR block also slowed both comparison pages, which have the same source code in both builds. The ordinary loopback medians show a small improvement in dashboard usable time and a higher LCP, with enough variation between blocks to leave the effect size uncertain. This benchmark measures the shared VPS and loopback Medplum.

Browser waterfall medians below show individual request start → response end from navigation start, in ms. The dev queue was visible with the first dashboard data and made zero browser queue GETs in all 12 dev runs and all 12 PR runs.

| Request | dev start → end | PR start → end |
| --- | ---: | ---: |
| Dashboard document | 0 → 112.5 | 0 → 108.5 |
| `/api/auth/medplum-session` | 254 → 275.5 | 234 → 250 |
| `/api/auth/me` | 254.5 → 318 | 235 → 303 |
| `/api/appointments` | 367 → 505.5 | 348 → 480 |
| `/api/orders/billable` | 367 → 586.5 | 348 → 563 |

On ordinary dev runs both tab requests started at least 29 ms after the last auth response. The PR began them as early as 47 ms before the last auth response. When dashboard hydration takes longer than auth restoration, both builds can start the tab reads after auth has finished.

### Controlled slow-auth trace

The same interleaved production builds ran 12 more warm dashboard navigations each. Playwright held the real `/api/auth/me` response for 300 ms before delivering it to Chromium. Request interception disables the browser HTTP cache, so this is a dependency test with its own comparison.

| Screen | Usable, dev → PR (ms) | LCP, dev → PR (ms) | Browser requests, dev → PR | API requests, dev → PR |
| --- | ---: | ---: | ---: | ---: |
| Dashboard queue, delayed auth | 320 → 163 | 186 → 184 | 56 → 56 | 4 → 4 |
| Dashboard all data available, delayed auth | 918.5 → 705.5 | Same navigation | Same navigation | Same navigation |

Dev started the first tab read a median 14.5 ms after auth completed (range 13–28 ms). The PR started it 345 ms before auth completed (range 268–379 ms before). The 213 ms improvement in all-data availability is specific to the imposed delay and loopback setup.

## Coverage

The Playwright regression test holds the browser auth request open and requires both tab requests to return successfully before releasing it. The existing dashboard error and retry specs exercise the same endpoints. The PR touches none of the files listed in open PRs #334, #338 or #339.

`tsc --noEmit` passed. The dashboard queue, queue pagination, and auth memo unit suites passed 24/24. The existing dashboard error and retry spec and the new concurrency spec passed 6/6 against the PR production build.
