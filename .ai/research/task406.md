# Task 406: the 11 "NEW FAIL" cases in the Task 352 accepted-gate report (PR #251)

Sources: Playwright test docs (https://playwright.dev/docs/test-assertions), Next.js CLI (https://nextjs.org/docs/app/api-reference/cli/next), Medplum rate limits (https://www.medplum.com/docs/self-hosting/server-config).

Evidence: `/home/dev/ucc-task352-evidence/accepted-gate/reports/` (51/65, batches 1-5), baseline `/home/dev/ai-logs/int-360/reports/results.json` (16 POCT/X-ray tests, all passed there).

## Finding
All 11 failures are in batch 3 (poct + xray + xray-phase2). Timeline from results.json:
- 13:46:58 `Per-device keys` (poct.spec.ts:514) failed after 43 s with `toBeVisible` timeout.
- 13:47:42 onward: the next 10 tests each fail within 0-2 s with `connect ECONNREFUSED ::1:3210`, then Medplum `429 Too Many Requests` (login limit 5 after the retry storm).
- `server.log` for batch 3 ends abruptly mid-request (last line a 200 GET) with no error, heap message or stack: the owned Next dev process was killed from outside, not by an app exception. The gate had no OVERALL verdict (lint/build only), so it was an incomplete run.

## Verification on the current PR head (dcabad1, Task 404/405)
Fresh worktree, ONE dev server (webpack, :3406, `--max-old-space-size=3072`), fake data, dev Medplum :8113:
`playwright test --workers=1 poct.spec.ts xray.spec.ts xray-phase2.spec.ts` -> **18/18 passed** (5.5 min), including all 11 flagged tests. Server group stopped afterwards.
Earlier `task5-policy-batched-accepted` also had POCT/X-ray 18/18 on this branch; Task 341f (PR #266, clean low-memory gate on dev) passes the same specs.

## Verdict
None of the 11 is caused by #251: infrastructure (dev server killed mid-batch, cascade ECONNREFUSED then 429). The comparator labels them NEW only because they passed in the baseline. No application, e2e or composer change is needed or made. The 3 other failures in that report (Time Chit toggle, legacy staff-membership CLI test, workflow "11 known-bug probes") are also failing in the baseline.
Remaining open item (unchanged from Task 388): a complete full-gate OVERALL verdict at the final head plus the live super-admin demotion rehearsal.
