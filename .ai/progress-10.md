# Task 10 review fixes
Branch: `ai/task-10` in `/workspace/ucc-pr-10`. Existing draft PR #227.

Done: read saved progress-task10.md and REVIEW-task10.md; reviewed official FHIR/React/Next docs and existing clinic/toggle APIs. Added toggle gate to ingestion (including Bot entrypoint), scoped/gated pending query and authenticated results target, clinic identifiers on new results, completed-order retransmission guard.
Remaining: regression coverage, lint/unit/relevant POCT e2e, foreground full gate, final docs and normal push. Then Task 11.
Failing tests: not run for these changes yet. Previously documented dev-vs-ai-work receiver/inventory baseline gaps remain.
User explicitly authorizes normal pushes/draft PRs, overriding AGENTS.md remote prohibition for this task. No sidebar changes.
