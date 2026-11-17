# Task 401 review of Task 400 — PR #267

2026-11-16. Reviewed b6b8254 against dev e6c8278; Task 398 comparison head
7552f43. Verdict: **APPROVE for the scoped update-by-ID review after the fix below**.
This is not a full browser-gate or deployment approval.

## Finding fixed directly

**Twilio settings could cross clinic boundaries through a conflicting extension.**
`sendFollowUpWithTwilio` correctly checked the stored `clinic` identifier, then
selected Organization settings with `followUp.clinicId`, derived from a redundant
extension. With identifier clinic-a and extension clinic-b, it read clinic-b's
settings; without the extension, it silently used global defaults. Changed that
lookup to the authorized caller clinic. No change to appointment helpers.

Added regression cases for matching, conflicting and absent extensions. Before
the fix, matching passed and the other two failed: Organization reads were
`['clinic-b']` and `[]` instead of `['clinic-a']`. All three pass after the fix.

## Containment and own-clinic behavior

- Document, billing status, referral, communication status/open/send all check
  stored clinic identifiers before mutation. Missing caller clinic, absent clinic
  identifier and mixed identifiers reject with ForbiddenError/403 and zero writes.
  Referral without clinicId is directly exercised, including direct helper calls.
- Billing checks ownership before its same-status no-op return. Own-clinic no-op
  remains a no-op; own-clinic status/title/reason/open edits preserve identifiers
  and extended account metadata. No resource is relabelled across clinics.
- Route callers forward authenticated clinic context; automatic create/send and
  process-due callers forward their input/authenticated clinic. Settings now use
  that same authorized context for Twilio sends.
- Strengthened Twilio rejection tests with valid synthetic phone values, missing
  caller/untagged/mixed cases, a fetch trap, zero-write and single-read assertions.
  This prevents unrelated phone/config failures from masquerading as containment.
  Own-clinic sends use a fake transport and a realistic synthetic Organization;
  assertions cover queueing, ownership, account preservation and settings lookup.

## Task 398 compatibility and scope

Task 398 application changes are confined to appointment service/routes, with a
separate regression suite. Task 400 changes none of those files. Combined overlay
validation used exactly Task 398's two application files and test file, restoring
the worktree's original bytes afterward; nothing from Task 398 is committed here.

The initial in-memory merge simulation found only an EOF append conflict in
`.ai/BACKLOG.md`. Moved the unchanged Task 400 entry before `Later` so it no longer
competes with Task 398's appended entry. Both application changes remain separate.

Reviewed the complete diff: no sidebar/navigation, consultation composer,
Lab/POCT, PACS/DICOM, Firebase Storage, infrastructure or dependency changes.
Only fake fixtures/config are added. No .env.local, e2e/.secrets, tokens, passwords
or patient data are included. No live Medplum/Twilio/Storage requests were needed.

## Verification and limits

- Task 400 branch plus review fix: `bun test tests/unit` — **258 pass, 0 fail**,
  23 files; 23 Task 400 test cases, up from 18.
- Standalone `NODE_OPTIONS=--max-old-space-size=3072 tsc --noEmit` — **PASS**.
- Repository `bun run lint` (lint typecheck and admin-client policy check) — **PASS**.
- Temporary combined Task 398 + Task 400 application/test overlay: **312 pass,
  0 fail**, 24 files; standalone tsc — **PASS**.
- `git diff --check` — **PASS**.
- Full `e2e/scripts/check-all.sh` was inspected but not run. This review used the
  requested unit/type checks; no browser/server was started, no secrets copied,
  and no live clinic fixtures invoked. The standing full-gate completion condition
  is therefore not claimed satisfied. Live UI workflows were not exercised.
- The SID-search Twilio callback and existing create/read/delete helpers are
  outside this update-by-ID review. This is not an audit of all clinic access or
  a validation of previously inconsistent account metadata.

Official references, setup and red-test evidence: [task-401 research](../research/task-401.md).
Publication/live mergeability is recorded in the PR conversation after the push.
