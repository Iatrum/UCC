# Task 498 - staff-membership.spec "forged foreign Patient create" returned 201 on dev

Follow-up to the Task 484 gate (PR #284). Dev Medplum `127.0.0.1:8113` only, fake data, one Next dev server on `:3498` (killed afterwards).

## Verdict: stale dev AccessPolicy, NOT a code defect
Task 484 guessed this without checking. Verified here:

| step | result |
|---|---|
| Deployed dev "UCC Clinic Staff Policy" vs `clinicStaffPolicyResources()` | **58 rules deployed, 61 expected; 5 missing, 2 unexpected.** The single `Patient` rule was `create,read,update,delete,search,history,vread`, so staff could `POST /Patient` directly with forged `identifier`/`meta.accounts`. |
| Applied current definition: `bun run medplum:setup-access` (= `scripts/setup-access-policies.ts`, idempotent upsert by name) | Deployed policy now byte-identical to the repo definition (61 rules, Patient rules = read / update / delete, no `create`). |
| Re-run `e2e/tests/staff-membership.spec.ts` (one server, `timeout 560`, `UCC_MEMBERSHIP_BACKUP_DIR` set) | **PASS, 1/1, 4.1 min.** The forged foreign Patient create returns 403. |

So no server-side create-containment or policy-criteria bug exists in the current code: the policy generated from the repo
(`lib/fhir/clinic-access-policy.ts`: Patient has no `create` grant; registration goes through the authenticated server route
that assigns the clinic account) already denies it. It also matches the earlier finding in `.ai/REVIEW-task5.md`
(shared dev policy rewritten back to the pre-#251 definition by another branch's run).
The pre-change policy was backed up to `/home/dev/ai-logs/task498/staff-policy-before.json` (not committed).
Benign log noise at cleanup: `[deletePractitioner] could not delete User ... Not found` (the rollback already removed it); the test still passes.

## Why it recurs
The dev project is shared by every worktree. Any branch/review that restores an older policy snapshot, or a Medplum DB restore,
brings back the stale definition. The policy is not applied automatically by deploys.

## Fix steps (stale policy)
1. Confirm `MEDPLUM_BASE_URL` is the dev server (`http://localhost:8113`), never production.
2. `bun run medplum:setup-access` (needs `MEDPLUM_CLIENT_ID/SECRET` of that project). Idempotent; also upserts the platform-admin and patient-portal policies.
3. Re-run the spec. Note: the same step is required on **each** Medplum instance, including production at/before Task 358 deploy (MedicationDispense access).

## Changes in this task (test/doc only, no behaviour change)
- `clinicStaffPolicyDrift()` (`lib/fhir/clinic-access-policy.ts`): pure comparison of a deployed policy with the repo definition.
- `staff-membership.spec.ts` now asserts that precondition up front (fails in seconds with "run `bun run medplum:setup-access`" instead of after ~4 min with an opaque 201).
- `tests/unit/clinic-staff-policy-drift.test.ts`: Patient never grants `create`; MedicationDispense present; legacy policy is flagged; in-sync policy is clean.
- `.ai/BACKLOG.md`: "Task 400 + 474" and "Task 398" entries said appointment helpers return 403; Task 482 aligned foreign/untagged/conflicting ids to 404
  (`assertStoredResourceInClinic`; only a foreign/dangling stored patient reference or missing caller clinic stays 403). Entries corrected.
