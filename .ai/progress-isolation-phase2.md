# Progress — Task 120 / isolation-phase2 (plan + draft script only)

Status: plan and draft migration script written; **nothing run against any server, no --apply,
no real ProjectMembership touched.** Branch `ai/plan-isolation-phase2`, from `origin/dev` (already
includes merged PR #230, Phase 0+1).

## Checklist
- [x] Read `.ai/PLAN-clinic-isolation.md`, DECISIONS D33-D36, `.ai/research/clinic-isolation.md`,
      `.ai/REVIEW-task-isolation-1.md`.
- [x] Found a material, out-of-plan fact while reading shared notes: a concurrent WIP checkpoint
      on `ai-work` (commit `666bb21`, not merged, not on `dev`) is attempting to fix the exact two
      MAJOR findings `REVIEW-task-isolation-1.md` deferred (write-side cross-clinic create
      containment via a new `clinicWriteAccounts` access-policy parameter + order-service ownership
      checks; extended-mode `meta.accounts` reads). As read via `git show` only (did not check out
      or touch that worktree): fix (a) is not yet passing a focused regression (same-clinic
      `createLabOrder` wrongly returns 403), fix (b) is still pending, no gate run, no review, no
      PR. This changes this plan's ordering section materially — see `.ai/PLAN-isolation-phase2.md`
      section 0 and 6.
- [x] `.ai/PLAN-isolation-phase2.md` written: exact migration steps, dry-run-first, rollback, how
      each existing ProjectMembership/Practitioner gets its clinic access (reusing
      `admin-service.ts`'s existing invite-time logic's *shape*, not its code — see plan section 3
      for why the script stays import-free), ordering vs. the still-unfinished Task 100 fixes, e2e
      verification list, risk list. Committed `e5921a0`.
- [x] `scripts/access-policy/migrate-staff-membership.mjs` drafted: defaults to dry-run (no flags);
      `--apply` requires an explicit `--membership <id>` (no bulk mode) and refuses any
      `MEDPLUM_BASE_URL` that isn't `localhost:8113`; per-membership JSON backup (0600, outside the
      repo, `/workspace/ai-logs/task-isolation-phase2/backup/`) before any write; `--rollback`
      verifies grant drift before restoring; exclusive lock file during `--apply`; refuses to touch
      a membership that already has any `accessPolicy`/`access`; discovers the live policy's
      `%token` set and fails closed on any parameter it doesn't know how to build (the mechanism
      that lets this script stay correct even if Task 100's exact parameter shape changes again
      before it lands). `node --check` syntax-validated only — never executed, no server reachable
      from this plan-only task.
- [x] This progress file.
- [x] `.ai/DECISIONS.md` D37 recording the Task-100-dependency finding.
- [x] `.ai/STATE.md` round-log line.
- [x] `.ai/CHANGELOG.md`: no entry added, matching precedent — Task 080 (the earlier plan-only
      isolation task) also added no CHANGELOG entry, since nothing user-facing changed; Task 090
      (the implementation) got one. This task is plan+draft-script only, same category as 080.
- [ ] Final commit + push to `origin/ai/plan-isolation-phase2` (no PR, no merge, per task brief).

## Notes
- No app/lib code was changed. No scratch files were created or left in the tree. No Medplum
  server was reached by this task (plan-only; the draft script was only `node --check`ed for
  syntax, never run).
- Did not touch `ai-work`, `/workspace/iatrum-ucc`, or `/workspace/ucc-plan-timechit`, per the task
  brief — the Task 100 finding above came entirely from `git show <commit>` against local refs
  already fetched into this same repository's object store, not from checking out or editing that
  worktree.
