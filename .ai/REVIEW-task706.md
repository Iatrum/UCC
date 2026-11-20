# Task 707 — Independent review of Task 706

Reviewed draft PR #341 at `407860b` against `origin/dev` at `b22d32e`. Both dashboard tab endpoints still authenticate and check clinic assignment independently. The dashboard queue fallback and polling retain their browser-auth gate. The review updates tests and documentation. [Draft PR #341](https://github.com/Iatrum/UCC/pull/341)

The concurrency spec previously checked HTTP success as soon as response headers arrived. It now reads both JSON bodies and checks the collections before releasing the held auth request, matching the dashboard data-availability claim.

The full unit suite exposed a scheduling assertion that also failed on exact dev. Task 645 changed the foreign-schedule error to `ForbiddenError`. The test now checks that error type and still verifies zero writes.

## Independent production benchmark

Next.js 16.4.5 webpack production builds ran with `next start` on loopback port 3277 in a fresh worktree. One Next process group ran at a time with a 3072 MiB heap cap. Chromium used a 1440 × 900 viewport and the same authenticated fake clinic and dev Medplum at 8113. In each block, a fresh browser context warmed Dashboard, Inventory and Billing once, then navigated to each screen four more times. The sequence alternated dev and PR. The first pair was dropped when the shared queue and inventory changed between blocks. The table uses the remaining four pairs and 16 warm samples per build per screen.

Usable time is navigation start to the first animation-frame check that sees the queue table, Inventory Overview tab, or Ready for Billing card. Dashboard all-data time is the later of the queue becoming visible and both tab response bodies completing. LCP comes from a buffered Chromium performance observer. Network counts include the document, assets and prefetches through network idle, before queue polling.

| Screen | Median usable, dev → PR (ms) | Median LCP, dev → PR (ms) | Median browser requests, dev → PR | Median API requests, dev → PR |
| --- | ---: | ---: | ---: | ---: |
| Dashboard queue | 314.9 → 333.4 | 110 → 154 | 56 → 56 | 4 → 4 |
| Dashboard all data available | 582.5 → 598.4 | Same navigation | Same navigation | Same navigation |
| Inventory | 312.9 → 325.4 | 342 → 344 | 48 → 49 | 3 → 3 |
| Billing | 333.8 → 324.1 | 370 → 358 | 62 → 63.5 | 3 → 3 |

Dashboard all-data block medians were 721.0, 645.1, 511.2 and 530.4 ms on dev and 814.4, 590.4, 598.4 and 509.8 ms on the PR. Individual runs spanned 476.8–1126.7 ms on dev and 448.9–1133.7 ms on the PR. The ordinary loopback sample did not establish a latency improvement. A tab request began before the last auth response in one PR run and zero dev runs. All retained dashboard navigations made four API requests, with zero browser queue GETs.

## API parity and clinic isolation

Status and canonical JSON matched at each retained block boundary for `GET /api/queue` (3 patients), `GET /api/appointments` (16 appointments), `GET /api/orders/billable` (4 consultations) and `GET /api/inventory` (32 medications). The comparison sorted JSON object keys and preserved array order. The three dashboard APIs returned 401 without a session and 403 when the fake doctor's clinic cookie was changed to the unassigned fake clinic `clinicb`. The API handlers and services are identical across the measured revisions.

The read-only clinic audit found the same pre-existing fixture issues reported by Task 706 before the browser gate ran. It flagged one Patient with an invalid clinic identifier and one invalid account assignment.

## Verification

- `tsc --noEmit` and repository lint passed.
- `bun run test:unit` passed all 1,227 tests after the scheduling assertion correction.
- The strengthened dashboard concurrency spec and the four-clinic Playwright isolation scenario passed in the full gate. The isolation scenario uses disposable fake resources and verifies both direct FHIR reads and searches across clinic assignments.
- All five `composer-plan.spec.ts` tests passed. The full gate also passed the existing dashboard error and retry specs, the staff membership isolation and rollback scenario, and the Lab results visibility check in the composer.
- The first gate attempt hit a build exception with the prior benchmark build directory in place. A clean gate build passed.
- `e2e/scripts/check-all.sh task-707` recorded 72 passed, 20 failed and 6 skipped. The comparator found zero new failures or missing tests against the saved Task 665 baseline. The overall gate exited 1 because the fixture audit still flags the same invalid Patient clinic identifier and account assignment found before the run.

## Task 717 — Independent verification of Task 716

Reviewed PR #341 at `b141693` against `origin/dev` at `b22d32e`. Recalculating Task 716's saved samples reproduced the PR body's historical table. The independent rerun used the same warm navigation method, with 12 counterbalanced production build pairs and 36 Dashboard samples per build. Six pairs also covered Inventory and Billing, with 18 samples per build per screen. Canonical tab response fingerprints and visible queue row counts matched within every pair. [Research and protocol](research/task-717.md)

| Screen or milestone | Warm samples per build | Usable dev → PR (ms) | LCP dev → PR (ms) | Browser requests dev → PR | API requests dev → PR |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dashboard queue | 36 | 336.0 [310.0–375.2] → 337.2 [303.0–365.3] | 116 [103–136] → 112 [91–153] | 55 → 54 | 4 → 4 |
| Dashboard all data | 36 | 552.7 [523.1–601.2] → 540.7 [508.9–595.5] | Same navigation | Same navigation | Same navigation |
| Inventory | 18 | 298.8 [277.6–329.3] → 289.5 [267.5–307.4] | 324 [312–355] → 312 [287–332] | 51 → 50 | 3 → 3 |
| Billing | 18 | 320.4 [280.0–360.0] → 286.5 [268.4–307.2] | 346 [301–392] → 310 [289–328] | 58 → 58 | 3 → 3 |

Timings are median [25th–75th percentile]. Request counts are medians. The median paired PR-minus-dev differences were −2.8 ms for Dashboard usability, −2 ms for LCP and −31.7 ms for all data. Their exploratory pair-bootstrap 95% intervals were −24.6 to +26.8 ms, −16 to +24 ms and −63.5 to +22.2 ms. The ordinary loopback measurements leave the size and direction of the Dashboard timing effect uncertain. The Task 716 LCP candidate was reproduced in every run. It painted before either tab request in 34/36 dev and 35/36 PR navigations. Both builds made zero browser queue GETs.

The three Dashboard tabs rendered matching element structure, classes and headings on the same fake clinic data. The application diff changes only the scheduling of the background reads. The handlers for `GET /api/appointments` and `GET /api/orders/billable` still call `requireClinicAuth` before the scoped reads. In both builds, both routes returned 200 with their expected collections for the assigned clinic, 401 with only the clinic cookie and 403 with a valid session for an unassigned clinic.

The first attempt at pair 12 stopped after the standalone API checker omitted Secure cookies on HTTP loopback. The checker then sent the fake session cookies explicitly, and both sides of pair 12 were rerun. Only the complete replacement pair contributed to the table.

`tsc --noEmit`, repository lint, focused ESLint and the production build passed. All 1,227 unit tests passed. The full `e2e/scripts/check-all.sh task-717` run recorded 72 passed, 20 failed and 6 skipped, with zero new browser failures or missing tests against the saved Task 665 baseline. The Task 706 concurrency spec, Dashboard retry tests, composer plan and Lab visibility tests, and both clinic isolation scenarios passed. The gate exited 1 on the same two fake-fixture audit findings as Task 716, one Patient clinic identifier and one account assignment. All benchmark and gate Next process groups exited, and port 3717 closed.
