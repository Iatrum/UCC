# Task 737 review of Task 736

**Verdict.** The dev fixture cleanup is supported by the evidence. The audit and clinic-isolation checks retain their existing enforcement, and the C4 release hold remains open.

## Root cause

The Task 736 audit reports show one Patient clinic-identifier failure and one invalid account before cleanup, then zero of both after the Patient total fell from 3,518 to 3,517. The count of missing accounts stayed at 735. Task 722 recorded the same failing record. Its reported synthetic marker, fixture-client ownership, single history version and unresolved `HealthcareService` account support the orphaned-fixture diagnosis. A direct probe write is the likely origin. The original command and what happened to its account are unknown. The review used aggregate audit reports, the recorded metadata observations and a fresh read-only audit. [Task 722 evidence](research/task-722.md) · [Task 736 evidence](research/task-736.md)

The review corrected the FHIR reference to describe the instance DELETE `If-Match` precondition and clarified the scope of Patient `$everything`. [Task 737 research](research/task-737.md)

## Audit, isolation and coverage

- The branch diff against `origin/dev` is Markdown-only. The clinic audit, gate runner, access policy and isolation specs match the base. The audit still rejects invalid Patient clinic identifiers and unresolved or mismatched accounts. Its existing phase-1 mode inventories missing accounts. Strict mode still fails for missing accounts.
- The original before-and-after run exercises the audit's rejection and recovery for this fixture. Both Task 736 full runs passed the audit, `clinic-isolation.spec.ts` and `staff-membership.spec.ts`. These specs cover staff access across single and multiple clinic assignments, denied reads and writes, and membership rollback. They provide authorization coverage alongside the audit's data-integrity coverage.
- The independent read-only audit on dev Medplum 5.2.15 passed over 13 clinics and 3,689 Patients, with zero audit findings and zero invalid accounts. It inventoried 759 missing accounts in phase-1 mode.
- `tsc --noEmit`, `bun run test:unit` (1,318 passed, zero failed), and `git diff --check` passed.

## Full gate

`e2e/scripts/check-all.sh task-737` passed lint, the production build and the clinic audit against loopback dev. The final audit covered 13 clinics and 3,738 Patients, with zero invalid accounts and 767 missing accounts in phase-1 inventory. Playwright reported 96 passed, one failed and two skipped. Both clinic-isolation specs and the consultation workflow passed. The Task 722 comparison flagged the admin audit as the sole new failure. The full run recorded HTTP 429 during its deactivated-user login check and a timeout during its reactivation check. The two skipped scenarios were also skipped in the baseline.

A timeout-wrapped admin-only rerun on the same build passed. The isolated pass supports an intermittent failure. The full-run baseline comparison still failed. Both Next.js process groups exited and ports 3238 and 3239 closed.
