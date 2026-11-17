# Review of Task 498 (draft PR #284, head a043be4) — Task 499

**Verdict: APPROVE**

## Root cause is proven, not guessed
- Pre-fix policy snapshot (`staff-policy-before.json`, outside the repo) has 58 rules and a single `Patient` rule with `create,read,update,delete,search,history,vread`. The repo definition (`clinicCompartmentRules('Patient')`) grants only read/update/delete.
- 58 - 2 unexpected + 5 missing = 61 expected rules (arithmetic consistent).
- Applying the repo definition (`medplum:setup-access`) and re-running the spec flipped 201 to 403. That is a before/after on the same code.
- I re-ran `e2e/tests/staff-membership.spec.ts` against dev Medplum (127.0.0.1:8113): **PASS 1/1 (4.1 min)**. The new drift precondition passes, so the live dev policy is in sync. The "Not found" lines at cleanup are the documented benign rollback noise.

## Clinic separation
No server or policy behaviour changed. The diff is test and doc only, plus the pure `clinicStaffPolicyDrift()` helper. Foreign create => 403 and own clinic OK are still exercised by the spec. Staff cannot create a Patient directly (unit-pinned). Registration stays on the server route that assigns the clinic account.

## Safety
Only dev Medplum `127.0.0.1:8113` was used, with fake data. No `medplum-*` or `root-traefik-1` containers, `/opt/medplum` or `/root` were touched. No secrets were committed. `.env.local` and `e2e/.secrets` were copied into the worktree only and are excluded.

## BACKLOG wording
The Task 400+474 and Task 398 entries now say 404 for foreign/untagged/conflicting ids, with 403 only for a foreign or dangling stored patient reference or a missing caller clinic. This matches the Task 482 entry (BACKLOG line 13).

## Checks (worktree at a043be4)
- `bun test tests/unit`: 557 pass, 0 fail.
- `bun run lint` (tsc + clinic-admin check): exit 0.
- `eslint .`: 8 errors / 5 warnings, all in files this PR does not touch (login page, lab-results-view, order-composer, use-consultation-draft, scripts). They are pre-existing and out of scope.
- The spec's global-setup needs an app login. To respect the RAM limit I reused the dev server already on :3496 (another task's) for the login only, and started none. The spec itself only calls Medplum.

## Notes (non-blocking)
- The drift precondition fails on *any* extra or missing rule, not only Patient `create`. This is intended (the message says to run `bun run medplum:setup-access`), but a legitimate hand-added dev rule would fail the spec. It is acceptable for the shared dev project.
- The shared dev policy can regress again whenever another branch applies an older snapshot. The fix is the documented one-liner. Production needs the same step at or before the Task 358 deploy.

No code changes were needed in this review.
