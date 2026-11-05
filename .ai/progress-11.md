# Task 11 — Subscription live updates
Branch: `ai/task-11`, worktree `/workspace/ucc-pr-11`, based on fixed Task 10 (draft #227 dependency). Target dev.
Done: resumed saved plan (poct-plan-canvas: DiagnosticReport WebSocket + 30s fallback), inspected pinned SDK implementation, wrote gated patient+clinic subscription binding route and Lab-only update lifecycle. No sidebar changes.
Remaining: lint, race/cleanup review, meaningful subscription browser coverage, relevant e2e, foreground full check-all.sh 11, docs and draft PR. Never mark ready without gate.
Failing tests: not run yet. Task 10 full gate still running in its worktree; only one :3210 dev server remains there until complete.
Decision: use existing authenticated server Medplum client for renewable in-memory Subscriptions; send restricted binding token only. No new broad browser Medplum access token, no project/config changes. Polling also rechecks toggle every30s; disabled subscription endpoint returns403. New API validates clinic/patient/encounter.

Milestone: implementation lint passes, committed d1bca22 and normal-pushed. Added browser regression coverage (real FHIR ingestion/reads, controlled WS transport, polling, off-state, scope and auth). Awaiting Task 10 full gate before switching the one shared dev server.

Review: verified actual running Medplum source-map binding flow, including 1h server token TTL (90s response deadline is client renewal). Corrected comments and stale unauthorized-fetch teardown guard.

Current blocker to browser/full checks: independent Claude process1635347 is running Task10 gates and restarting3210 from ucc-pr-10. Our10-review Playwright was terminated143 and report directory collided with other gates. Do not treat its copied report as own evidence. Use unique UCC_REPORTS for all next runs. User asked whether competing run can be stopped. Implementation/testing commits d1bca22, ed5a764 are pushed; small review edits on disk pass lint.

Static review found CSP allowed wss but blocked local ws/8113, so added only the configured public Medplum HTTP and WS origins to connect-src. Existing low-memory dev flag UCC_LOW_MEMORY_DEV=1 is available in Next config and should be used for final local gates. Existing draft PR confirmed: https://github.com/Iatrum/UCC/pull/228 (dev target).

Coverage review: replaced full navigation cleanup check with React Lab-panel unmount while socket active, plus31s no-request assertion. This actually detects leaked30s intervals instead of relying on browser JS destruction. Next run relevant POCT spec after Task10 gate.

Long-test harness: the two new live tests obtain their own fresh local fake-staff session and copy cookies to their browser, avoiding reused rotating refresh cookies after the full suite has spent several minutes in earlier tests. Secret-bearing requests remain untraced.
