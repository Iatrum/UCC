# Self-review — Task 190 (poct-spec)
- Finding: the reported failure does not reproduce on current origin/dev; it was already fixed by a815000. poct.spec 7/7 x3 (isolation).
- Change is test-only and strictly stricter. No assertion weakened; POCT/PACS toggles untouched. Composer untouched.
- Caveat: transport status (200 vs 503) depends on the local Medplum websocket-subscriptions capability. Here it is environment-fixed, so comparing statuses within one test is stable.
- Not verified: a clean full gate. The full suite on :3216 hit my shell time limit after 47 tests. Failures seen there: clinic-isolation, staff-membership (12ms and 10ms, so likely missing prerequisites), draft-retention #1, save-state x5, time-chit, workflow 09, xray #1, and poct #4 (4.4m timeout in-suite, passes alone). Not diagnosed. They sit in specs this change doesn't touch, and I have no baseline to compare. Reviewer should run the gate on a quiet server.

## Independent review — Task 191
- origin/dev already merged (up to date, 7c42a6d). Diff is test-only (poct.spec.ts) plus docs.
- Root cause: author shows failure was a fixture bug already fixed on dev (a815000); route `api/labs/subscription` matches the shared design (403 only when POCT and PACS are both off; PACS-only keeps channel open). Verified in route source.
- Test is strictly stricter: PACS-only must return the same transport status as POCT-on; 503 body asserted. Nothing skipped or weakened. Composer, Lab-tab-only results, nav: untouched. No secrets.
- Re-ran `e2e/tests/poct.spec.ts` on :3216: 7/7 passed (3.6m).
- Minor: author's full-suite failures in other specs remain undiagnosed (not touched by this PR; no baseline).
- Verdict: **APPROVE** (no MAJOR, no MINOR requiring change).
