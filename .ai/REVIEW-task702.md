# Review: Task 702 (PR #340) — Task 703

Reviewer ran in a fresh worktree on the PR head (3ba1626), fake data only, dev Medplum :8113, production build (`build:ci`) on a unique port, killed afterwards.

## Verdict: approve. No blocking problem; one test added, one residual documented.

## Checks
- **tsc + lint** (`bun run lint`): clean. **Unit** (`bun test tests/unit`): 1247 pass / 1 fail. The one failure (`generateSlotsForSchedule > refuses a schedule that belongs to another clinic`) is pre-existing and is also named in the Task 702 notes; unrelated to this diff.
- **Queue invalid-status 400**: with the same Playwright probe, origin/dev (b22d32e build) answers `PATCH /api/queue {status:"bogus"}` with **200** and persists `finalQueueStatus:"bogus"`. The PR build returns **400** for `"bogus"`, `42`, `{}`, `"ARRIVED"`, and 200 for `waiting` and `null`. The allow-list matches `QueueStatus` and every status the app sends (`in_consultation`, `completed`, and `Exclude<QueueStatus,null>` from the profile workspace).
- **Duplicate lookup scoping** (live Medplum search semantics, not just the mock):
  - same-clinic tagged patient -> 409;
  - foreign-clinic patient with the same NRIC (tag + foreign managingOrganization) does NOT block registration and is not returned by the search (every query is AND-ed with a clinic scope);
  - legacy patient with no `clinic` tag, `managingOrganization = Organization/<clinicId>`, `ic` system -> 409 (still dedupes);
  - legacy patient owned by a different organization -> registration allowed.
- **Registration + check-in UI** (production build): register -> check-in with vitals -> queue row visible; passes.

## Residual (not fixed, documented)
A legacy patient with no `clinic` tag whose only link is `meta.account` pointing at a *non-existent* resource (e.g. `HealthcareService/demo`) is accepted by `matchesClinic` but unreachable by search: Medplum 5.2.8 has no `_account` search parameter (verified: "Unknown search parameter: _account") and `_compartment` only indexes existing resources. Real tenant accounts resolve and are in the compartment, so only dangling accounts are affected, and the result is a missed duplicate warning, never a cross-clinic read. Accepted.

## Change from this review
- Added `e2e/tests/task703-registration-queue.spec.ts` covering the above (cleans up its fake patients). It needs `e2e/.secrets/pw` as the other specs do; no secrets were committed.
