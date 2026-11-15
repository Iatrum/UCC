# Self-review — Task 190 (poct-spec)
- Finding: the reported failure does not reproduce on current origin/dev; it was already fixed by a815000. poct.spec 7/7 x3 (isolation).
- Change is test-only and strictly stricter. No assertion weakened; POCT/PACS toggles untouched. Composer untouched.
- Caveat: transport status (200 vs 503) depends on the local Medplum websocket-subscriptions capability. Here it is environment-fixed, so comparing statuses within one test is stable.
- Not verified: a clean full gate. The full suite on :3216 hit my shell time limit after 47 tests. Failures seen there: clinic-isolation, staff-membership (12ms and 10ms, so likely missing prerequisites), draft-retention #1, save-state x5, time-chit, workflow 09, xray #1, and poct #4 (4.4m timeout in-suite, passes alone). Not diagnosed. They sit in specs this change doesn't touch, and I have no baseline to compare. Reviewer should run the gate on a quiet server.
