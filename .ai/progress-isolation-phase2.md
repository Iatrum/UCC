# Task 130 — clinic isolation Phase 2

Worktree: `/workspace/ucc-pr-isolation-3`; branch: `ai/task-isolation-3`; base: `9d781c5`.

- Local only; no production actions. User explicitly authorizes milestone pushes and a draft PR, overriding the older AGENTS remote restriction for this task.
- Created requested worktree (none existed). Reused ignored local environment/dependencies/test credentials without displaying values.
- Medplum :8113 health 200; one foreground Next webpack server :3210, NODE_OPTIONS cap 3072.
- ONE postmerge baseline started: `check-all.sh dev-postmerge-231`, session 5705, reports `/workspace/ai-logs/dev-postmerge-231*`. Original module settings retained so the suspected PACS/POCT precondition failure is observable.
- Research: read merged policy/invite/receive code, prior versioned SDK/server research and draft migration script. Official Medplum access policies, FHIR R4 security, OWASP A01 consulted. Detailed research being recorded before edits.

Pending: baseline diagnosis; cherry-pick plan/script; harden migration; local per-membership apply/rollback and real-login regression; final gate once; shared notes; push and draft PR.

## Postmerge baseline (complete, exactly one invocation)
`dev-postmerge-231`: lint 0, build 0, clinics 0, Playwright 31/38. Subscription expected 403/got 503 with PACS on; fixture mismatch, no #231 application regression. Composer test counted results before debounce (para/full-blood counts 0), then five serial skips. No backend crash. Fixing fixture module isolation and waiting for seeded search matches; focused replay before commit. Original baseline retained. Local database dump saved privately outside repo (90 MB).

Plan/script commits e5921a0, 2a6ed05, 2b4cf89 imported. Preserved Task 130 progress and current shared history during cherry-pick conflicts; planning decision renumbered D38 because merged Task 100 already uses D37.

Milestone 1: fixture WIP a815000 pushed. Focused POCT 7/7 PASS; workflow now passes catalog selection but hit Unauthorized at post-sign FHIR verification (previous task also noted session expiry). Workflow-only replay running, no second full gate. Imported plan commits preserving shared history (planning D38 vs merged Task 100 D37). Script adaptation in progress; no membership writes yet.
