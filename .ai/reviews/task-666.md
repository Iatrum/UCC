# Task 666 review of Task 665

GitHub recorded [PR #317](https://github.com/Iatrum/UCC/pull/317) as merged on 19 Nov 2026 at 00:19 UTC, with head `fe3c0ad` and merge commit `603a49b`. Task 665 is the subsequent `e072e57` commit on `claude/perf-591`. GitHub reports `mergeable: UNKNOWN` for the merged PR. The branch already includes the fetched `origin/dev` at `fbdc693`.

## Code and scope

- When the Treatment composer mounts, it schedules its catalog request for browser idle. The inputs stay editable and the existing request latch still retries on reopen after a failed request. Task 666 puts the successful catalog render in a React transition so urgent search input can take precedence as results arrive. A Playwright test holds back the inventory response, types in the search, and checks the text and results after release.
- The dashboard queue is seeded by the same clinic-scoped triage loader used by the API. The server call follows `requireClinicPageAuth`, the initial FHIR search includes the clinic identifier and the service still checks the tenant and included patients. The client keeps manual refresh, polling and failure handling. The profile Appointment search now matches both the patient and clinic and discards nonmatching results.
- Sidebar/navigation, standalone Billing, Checkout, Inventory and Analytics entry points, Lab and POCT result placement, POCT availability guards and Firebase Storage have no source changes in the follow-up diff. The rich text editor now loads with the Consult drawer. The dashboard queue still formats arrival times in the browser's timezone.

Both changelog entries were retained when the follow-up branch locally merged `dev` at `12df445` (`aa9e519`). The original benchmark triplet stays pinned. The final build includes upstream #326 and #328.

## Benchmark

All three pinned versions completed the recovered benchmark on the same fresh fake visit. The branch measured 598 ms for dashboard and queue against 753 ms on the pinned dev, with a 414 ms minimum. Treatment took 1,166 ms end to end against 800 ms on pinned dev, even as profile reached 442 ms against 650 ms. Billing, Checkout, Inventory and Analytics measured 811, 1,181, 551 and 1,388 ms against 503, 1,003, 380 and 1,091 ms on pinned dev.

The final build measured 726 ms for dashboard and queue, above the 342 ms target. The older build measured 1,053 ms in this rerun, so the 342 ms reference was not reproduced under the recovered method. Profile and end-to-end Treatment improved to 527 ms and 609 ms against 650 ms and 800 ms on pinned dev. Treatment click to editable search was 192 ms against 267 ms. The browser observed all five catalog requests after Treatment opened.

Billing and analytics kept gains against the earlier 19 Nov before column. Checkout and inventory were slower than that column. All four were slower than pinned dev in the same rerun. [Full benchmark, readiness criteria and interpretation](../research/task-666.md)

## Checks

- `tsc --noEmit` and ESLint on changed files passed. The production build passed.
- `bun test tests/unit` had 1,035 passes and two failures. Current dev had 1,034 passes and the same two failures, on foreign-clinic invoice void/delete and foreign-clinic slot generation. The appointment lookup scope and queue/composer unit tests passed.
- The new Playwright test passed with the inventory request held while keys were typed. The composer retained the query and showed matching results after the gate released the request. The phase 1 clinic-isolation browser test passed.
- `e2e/scripts/check-all.sh task-666` reported 66 passed, 19 failed and 12 skipped. The clinic audit passed. Dashboard loading/retry, queue confirmations, on-demand catalogs, composer persistence, Lab/composer separation and Time Chit checks passed. The full run timed out at serial-workflow login. In a separate run, workflow steps 01–06 passed and step 07 reproduced Task 665's Lab-ingest failure. Steps 08–11 were skipped in both prior and isolated workflow results.
- The staff-membership CLI test failed on its apply step in the full gate and passed on its own. Compared with the earlier Task 665 gate, the two newly failing tests passed in isolation. The full gate remains red.

## Verdict

**REQUEST CHANGES.** The dashboard target and the earlier checkout and inventory gains remain unverified on the final branch despite the improved profile and Treatment timings. GitHub already merged #317, so this verdict applies to the post-merge follow-up branch. Current dev is an ancestor of the follow-up and GitHub cannot supply an open PR mergeability result for #317.
