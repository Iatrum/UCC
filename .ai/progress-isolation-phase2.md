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

## Resume — 2026-11-14
Continued existing worktree/branch at `2f6e05e`, retaining the single completed baseline. Local Medplum healthy; restarted the sole real :3210 webpack dev server in a foreground tool session, capped at 3072 MB. Live local policy already matches merged rules (57 entries); previous private policy/database backups retained.

Migration regression was untracked on takeover. Found Fetch `Response.ok` used as a method and cleanup using an expired password-admin cookie; switched fixtures/cleanup to the existing client-credentials admin helpers, kept actual password logins for migrated staff, added bounded raw requests. The initial resumed replay used the old fixture because an edit ran from the wrong directory; its failed cleanup is not migration evidence. Corrected replay `migration-resume-r2` now running. Hardened dry-run to exit nonzero for unresolved clinics and reject malformed active role organization references. No second full gate has run; seeded staff migration remains pending.

## Milestone 2 — local membership validation
- Corrected CLI regression PASS 1/1 (3.6 min), `/workspace/ai-logs/task-isolation-3/migration-resume-r2.log`: single-clinic and two-clinic memberships, real staff password logins, four-clinic read/search/update/delete/create probes for Patient/Encounter/Observation/ServiceRequest, backup mode 0600, exact expected grants, already-migrated dry-run, rollback drift refusal, exact grant restoration and legacy-login behavior. Disposable identities cleaned up. Added no-active-role refusal coverage for the final gate.
- Fresh private database backup `/workspace/ai-logs/task-isolation-3/private/before-seeded-migration.sql`. Old failed-run disposable migration identities removed using the existing admin helper; no unrelated identities removed.
- Reviewed account-backfill dry-run, then LOCAL apply exit 0: checked 4642, already stamped 4148, updated 471, unresolved 23 (orphan Provenance only, no clinic inferred; remain inaccessible to staff).
- Individually reviewed known fake doctor membership `45c1d4c5-cbd2-4929-a795-dbacda550137` (demo), dry-run exit 0, apply exit 0, post-apply dry-run confirms exact expected policy. Per-membership backup outside repo. Other clinic staff already had grants; no policy-bearing memberships overwritten.
- Unrelated no-role fake membership `c7ade68a-f2a8-4b4c-963e-ba735d03e5c4` deliberately NOT assigned a guessed clinic; needs operator review. CLI now exits nonzero on unresolved dry-run assignments.
- Old failed Playwright request log exposed an expired local token when inspected; JWT strings redacted in six saved failure artifact files, and new fixture cleanup no longer uses request-context calls. No credentials committed.
- Final full gate next, exactly once under label `task-isolation-3`. No production actions.
