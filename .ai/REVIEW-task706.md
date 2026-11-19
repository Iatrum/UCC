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
