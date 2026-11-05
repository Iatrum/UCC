# Task 11 — Subscription live updates
Branch: `ai/task-11`, worktree `/workspace/ucc-pr-11`, based on fixed Task 10 (draft #227 dependency). Target dev.
Done: resumed saved plan (poct-plan-canvas: DiagnosticReport WebSocket + 30s fallback), inspected pinned SDK implementation, wrote gated patient+clinic subscription binding route and Lab-only update lifecycle. No sidebar changes.
Remaining: lint, race/cleanup review, meaningful subscription browser coverage, relevant e2e, foreground full check-all.sh 11, docs and draft PR. Never mark ready without gate.
Failing tests: not run yet. Task 10 full gate still running in its worktree; only one :3210 dev server remains there until complete.
Decision: use existing authenticated server Medplum client for short-lived in-memory Subscriptions; send restricted binding token only. No new broad browser Medplum access token, no project/config changes. Polling also rechecks toggle every30s; disabled subscription endpoint returns403. New API validates clinic/patient/encounter.

Milestone: implementation lint passes, committed d1bca22 and normal-pushed. Added browser regression coverage (real FHIR ingestion/reads, controlled WS transport, polling, off-state, scope and auth). Awaiting Task 10 full gate before switching the one shared dev server.
