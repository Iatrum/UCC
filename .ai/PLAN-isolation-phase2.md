# PLAN — Clinic isolation Phase 2 (migrate existing staff onto the AccessPolicy membership model)

Status: **Task 130 implementation and LOCAL fake-data validation in progress.** Plan/script commits from `ai/plan-isolation-phase2` are imported. Evidence and resume instructions: `.ai/progress-isolation-phase2.md`; version-specific sources: `.ai/research/task-isolation-3.md` and `isolation-prereqs.md`.

## 0. Prerequisites after Task 100 merged

PR #230 (Phase 0/1) and PR #231 (Task 100 write containment and receive-account propagation) are merged into `dev` at `9d781c5`. The original dependency decision (D38 here; originally numbered D37 on the planning branch) remains valid; its unmerged-WIP description is historical.

Task 100's original full gate failed during a local backend outage; its recovery evidence was composite, not a clean gate. Task 130 ran ONE fresh postmerge baseline `dev-postmerge-231`: lint/build/clinic inventory pass, Playwright 31/38. The subscription test assumed PACS off when disabling POCT; the shared subscription correctly stays enabled for PACS. The composer test counted search results before debounce and caused serial skips. Fix the fixtures and validate again, without changing shared Lab behavior.

Before migration: back up the LOCAL fake database; refresh only the local clinic policy from the merged rules (backing up its previous definition); dry-run/review the account backfill before applying it to the seeded fake clinics. Then exercise the migration on disposable identities before the seeded fake staff. The script refuses remote origins and older policies without Task 100 write guards, recognizes repository runtime `%before`/`%after` separately from membership parameters, and mirrors the merged `clinicWriteAccounts` union exactly. It does not deploy policies or backfill data itself.

No production action is authorized or performed. Production migration remains a separate manual user step after reviewing local evidence, backups and the production project boundary.

## 1. Scope

Migrate every existing non-admin `ProjectMembership` that currently has **no** `accessPolicy` and
**no** `access[]` (confirmed by `.ai/research/clinic-isolation.md`: 2 of 10 local memberships
today, including `doctor@ucc.local`) onto the real `UCC Clinic Staff Policy`, with one `access[]`
entry per clinic the corresponding `Practitioner` has an active `PractitionerRole` for. This is
exactly `.ai/PLAN-clinic-isolation.md`'s Phase 2, refined with: an explicit ordering gate against
Task 100 (§0), a parameter-discovery step that doesn't hardcode today's two-parameter shape (§3),
and the concrete script (§4) the earlier plan only specified in prose.

Out of scope, unchanged by this task: the write-side containment fix and extended-read fix
themselves (Task 100's job), production/Hostinger (D20, user's call), the shared-device-key gap
(BACKLOG), and any app/UI code.

## 2. Exact migration steps

### Step 0 — Preconditions (all must be true before `--apply` is ever used)

1. Task 100 (§0) is merged to `dev`; review the actual postmerge baseline and final Task 130 gate evidence rather than claiming its earlier interrupted full gate passed.
2. Phase 0's disposable-identity verdict (D36: "proceed to Phase 1") still holds — it does, nothing
   in Phase 1 or this plan revisits it, but re-run
   `scripts/access-policy/test-clinic-policy-superadmin.mjs` once against the *post*-Task-100
   policy if Task 100 changed read-path criteria at all (it currently only changes write-side
   rules, so this is a cheap confirmation, not a full re-investigation).
3. Phase 1 is already merged (PR #230) — Provenance policy entry, provenance stamping, triage
   update-path stamping, `access[]` re-derive on reassignment. Confirmed already true.
4. `APPLY=true bun scripts/access-policy/backfill-clinic-accounts.mjs` (Phase 1.4's script) has been run
   **once, successfully, with its own dry-run reviewed first** — so newly-restricted staff don't
   lose access to pre-existing resources that predate `meta.accounts` stamping. Per
   `.ai/PLAN-clinic-isolation.md` Phase 2 step 2, this runs *before* any membership is touched.
5. A fresh Medplum backup exists (same caution as Task 2's seed script and the Phase 0 test) —
   this migration is a direct-FHIR write to real `ProjectMembership` resources in whatever
   environment it's pointed at.

### Step 1 — Dry run (default, no flags beyond identifying the environment)

```
bun scripts/access-policy/migrate-staff-membership.mjs
```

Logs, for every non-admin `ProjectMembership` with no `accessPolicy` and no `access[]`:
`ProjectMembership`/`Practitioner` reference (for operator review — `REVIEW-task-isolation-1.md` finding 3: never migrate a
no-policy membership blind, it might be an intentional break-glass account, not just a test/seed
leftover), the clinic `Organization`/`HealthcareService` pairs its `PractitionerRole[]` resolve to,
and the exact `access[]` it *would* write. Makes no writes. Exits 0 on a clean dry run, non-zero if
any membership's clinic set can't be resolved (fail closed, never guess a clinic).

### Step 2 — Parameter discovery check (new to this plan, see §3)

The same dry run also reads the live `UCC Clinic Staff Policy` document and reports every `%name`
token its `criteria`/`writeConstraint` expressions reference. If it finds a token the script has no
builder for, it refuses outright (dry run exits non-zero with the unknown token named) rather than
writing an `access[]` entry silently missing a parameter a newer policy depends on. This is the
concrete mechanism that makes the script safe to point at a post-Task-100 policy without this plan
document needing to be rewritten first.

### Step 3 — Operator review

Read the dry-run output. Confirm every listed `ProjectMembership`/`Practitioner` reference is actually a
test/seed/legitimate-staff account expected to get clinic-scoped access (not a break-glass admin
left deliberately unpolicied for a documented reason). This is a manual gate, not automatable —
matches `REVIEW-task-isolation-1.md` finding 3's explicit ask.

### Step 4 — Apply, one membership at a time

```
MEDPLUM_ADMIN_EMAIL=... MEDPLUM_ADMIN_PASSWORD=... \
  bun scripts/access-policy/migrate-staff-membership.mjs --apply --membership <ProjectMembership/id>
```

Per `.ai/PLAN-clinic-isolation.md`'s own phase 2 design: back up the membership's exact current
`accessPolicy`/`access` to a private, outside-repo, `0600`-mode file before any write (same path
pattern as `apply-local-staff-policy.mjs`'s `/workspace/ai-logs/task5/backup/`, here
`/workspace/ai-logs/task-isolation-phase2/backup/`), take an exclusive lock file for the duration of
the write, verify the membership is non-admin and has no existing grants (refuses to touch anything
that already has a policy — this script only *adds* the clinic policy to currently-unpoliced
memberships, matching the earlier plan's explicit non-goal of overwriting a hand-set custom
policy), then write.

### Step 5 — Verify that one membership before moving to the next

Re-run the dry run; the just-migrated membership should now report "already has the expected
policy" and drop out of the no-policy list. Separately (outside this script, by hand or via the
existing e2e pattern): log in as that account, confirm it can still see its own clinic's
patients/encounters/orders and cannot see another clinic's directly (`404` per D36's finding —
`_compartment` denial on direct read is `404`, not `403`, in this Medplum version; search simply
omits the row). Roll back only that membership on failure:

```
MEDPLUM_ADMIN_EMAIL=... MEDPLUM_ADMIN_PASSWORD=... \
  bun scripts/access-policy/migrate-staff-membership.mjs --apply --rollback --membership <id>
```

### Step 6 — Repeat for every remaining non-admin no-policy membership

Across all 4 seeded clinics (`demo`/`clinicb`/`clinicc`/`clinicd`), one membership (one
`--apply --membership <id>` invocation) at a time — never a batch `--apply` over every membership
in one run, so a single bad case is cheap to isolate and revert without touching the rest. (The
draft script in §4 does not even offer a "migrate everything" flag, by design.)

## 3. How each existing ProjectMembership/Practitioner gets its clinic access

This mirrors `lib/fhir/admin-service.ts`'s existing invite-time logic (`getClinicPolicyParameters`,
`withClinicMembershipAccess`, called from `invitePractitionerToMedplum` and
`updatePractitionerInMedplum`) rather than inventing a second code path, per
`.ai/PLAN-clinic-isolation.md`'s original instruction to reuse one source of truth. Concretely, for
each eligible membership:

1. Resolve its `profile` reference (`Practitioner/<id>`).
2. Search `PractitionerRole?practitioner=Practitioner/<id>&active=true` (paginated, every page —
   same care `updatePractitionerInMedplum` already takes) → set of `Organization` ids.
3. For each `Organization` id: resolve its `clinic|<slug>` identifier, then its `HealthcareService`
   account (`identifier: clinic|<slug>`) — same two-step resolution
   `getClinicPolicyParameters` already does, duplicated in the script rather than imported (see
   below for why).
4. Look up the real `UCC Clinic Staff Policy` `AccessPolicy` by name (never hardcode an id — same
   rule `apply-local-staff-policy.mjs` already follows for its own policy).
5. Read that policy's `resource[]` and collect every `%tokenName` referenced in any `criteria` or
   `writeConstraint.expression`. For each token the script recognizes
   (`clinicAccount` → `HealthcareService/<id>`, `clinicOrganization` → `Organization/<id>`,
   `clinicWriteAccounts` → anchored regex union (dots escaped as `[.]`, matching the merged helper) of every clinic's `HealthcareService` reference
   across *all* of this membership's clinic `access[]` entries, matching `withClinicMembershipAccess`'s own
   union logic implemented in merged Task 100), build the parameter. Runtime variables `%before`, `%after`, `%profile`, `%patient` are supplied by Medplum and are not membership parameters. For any other token it does not
   recognize, **fail closed** (§2's discovery check) rather than write an incomplete entry.
6. Build one `access[].parameter` list per clinic, all sharing `policy: {reference: AccessPolicy/<realPolicyId>}`.
7. Write `access: [...one entry per clinic]`, clearing any (absent, by precondition) `accessPolicy`.

**Why the script does not `import` `lib/fhir/admin-service.ts` directly, even though
`scripts/backfill-clinic-identifiers.ts` shows bun scripts in this repo *can* resolve the `@/`
path alias:** every other script in `scripts/access-policy/` that performs a real write against a
`ProjectMembership` (`apply-local-staff-policy.mjs`) is deliberately self-contained — raw
`fetch`-based login, no application-code import — so the script's full write-path behavior can be
read and audited in one file without also auditing whatever `lib/fhir/*` happens to contain at
HEAD (which, per §0, is actively changing underneath this plan). This script follows that existing
house convention. The cost (duplicating small, stable lookups: clinic identifier → HealthcareService,
PractitionerRole → Organization) is small; the benefit (this file's behavior cannot drift because
someone changed an unrelated helper in `admin-service.ts`) matters more for a script whose whole
job is a one-time, hard-to-reverse write to login-determining resources.

## 4. Rollout / rollback (safety rails, matches the existing script family's pattern)

- **Dry-run is the default with no flags.** `--apply` alone still does not write — it also requires
  `--membership <id>` (explicit, one at a time, never "all") and a `MEDPLUM_BASE_URL` that passes
  the same localhost-only guard `apply-local-staff-policy.mjs`/`backfill-clinic-accounts.mjs`
  already enforce (`http(s)://localhost:8113`/`127.0.0.1`/`[::1]`, no path/query/credentials in the
  URL). No production target is reachable through this script at all, by construction, not by
  convention — this matches AGENTS.md ("agents never touch production") stronger than a doc
  instruction would.
- **Per-membership JSON backup** written before any write, outside the repo
  (`/workspace/ai-logs/task-isolation-phase2/backup/<projectId>-<membershipId>.json`, `0600`),
  exactly the shape `apply-local-staff-policy.mjs` already uses (`{projectId, memberId, policyId,
  membership}`) so `--rollback --apply` can restore the exact original `accessPolicy`/`access`
  fields, verified byte-for-byte (`isDeepStrictEqual`) before restoring, same drift protection the
  existing script has.
- **Exclusive lock file** for the duration of any `--apply` run (`apply.lock` in the same backup
  directory) so two concurrent invocations can't race on the same or different memberships.
- **Refuses to touch** a membership that already has any non-empty `accessPolicy`/`access` —
  this script only *adds* the real policy to currently-unpoliced memberships; it is explicitly not
  a general-purpose access-policy editor and does not attempt to reconcile a membership someone
  already configured by hand.
- **One membership per invocation.** No "migrate every membership now" mode exists in the script —
  removing that temptation entirely, rather than just discouraging it in a comment, is the whole
  point of Step 6's manual loop.
- If Step 2's parameter-discovery check ever reports an unknown `%token`, **stop** — this means the
  live policy now depends on a parameter this plan's author didn't know about when writing this
  document (e.g. a different Task 100 shape than what the WIP checkpoint showed), and the script
  must be extended (new parameter builder, reviewed) before any further `--apply`.
- If Phase 0's verdict (D36) is ever found not to hold against whatever policy document is live at
  migration time (e.g. Task 100 changed read-path criteria, not just write-side) — **stop**, same
  escalation `.ai/PLAN-clinic-isolation.md` already specifies for a negative Phase 0 result.

## 5. e2e verification list

To run after each individual `--apply`, not written as new automated tests in this plan-only task
— Task 100 and any Phase 2 build task should add these to `e2e/tests/clinic-isolation.spec.ts`
using the same four-disposable-clinic fixture pattern already there:

1. The migrated account can still log in (no regression from the write).
2. The migrated account can read/search its own clinic's Patient/Encounter/Observation/
   ServiceRequest/DiagnosticReport/Invoice/Task (full list = `setup-access-policies.ts`'s resource
   list, imported not hand-copied, per `REVIEW-task-isolation-1.md`-adjacent
   `PLAN-clinic-isolation.md` self-critique minor #4).
3. The migrated account gets `404` on a direct read of another (of the 3 other seeded) clinic's
   resource of each of those types, and that resource never appears in a `_count`-high search.
4. The migrated account can still complete the full consultation flow: create/check-in a patient,
   run a consultation, sign, order a lab/POCT test, read the result back — the existing positive-
   path regression the original plan called for, now doubly important because Task 100's
   writeConstraint change is exactly the kind of policy edit that could silently break order
   creation (its own WIP notes already recorded one such regression: same-clinic `createLabOrder`
   wrongly returning `403`).
5. Provenance creation still succeeds for the migrated account (no silent audit-trail loss —
   Phase 1's fix, must survive Phase 2's membership change too).
6. If the migrated `Practitioner` has `PractitionerRole` in more than one clinic: the account sees
   **all** of those clinics' data and still not a third/fourth — exercises the multi-entry
   `access[]` union end to end, not just per-entry.
7. `--rollback --apply` on a freshly-migrated (not-yet-verified-broken) membership restores the
   exact original (absent) `accessPolicy`/`access`, and the account reverts to Medplum's pre-
   migration legacy-fallback behavior (full access) — confirms rollback is real, not just "no
   error thrown".
8. Re-run `e2e/scripts/clinic-check.ts` after each `--apply` — `accountSummary.invalid` must stay
   `0`; `accountSummary.missing` should trend toward `0` as Phase 1.4's backfill + Phase 2's
   migration together close the historical gap (433 missing as of the last recorded inventory run,
   `.ai/progress-isolation-prereqs.md`/`progress-clinic-isolation.md`).

## 6. Ordering summary

Phase 0/1 (merged #230) → Task 100 (merged #231) → Task 130 fresh postmerge baseline and fixture corrections → local database/policy backups → local merged-policy refresh → local account-backfill dry-run/review/apply → disposable migration CLI tests and rollback → individually reviewed seeded fake memberships → own-clinic composer/Lab/POCT/X-ray/billing regression → ONE final `check-all.sh task-isolation-3` → normal push and draft PR to `dev`.

Phase 3 admin-client defense-in-depth remains separate. Production migration is a manual user step, not done. No script in this task can target a nonlocal Medplum endpoint.

## 7. Risk list

1. **Deployment drift.** Merged code does not automatically refresh the live Medplum policy or historical accounts. Migration must refuse a pre-Task-100 policy; back up and refresh the local definition before testing. A merged PR alone does not prove positive-path workflows pass after membership migration.
2. **Parameter-shape drift.** Task 100's `clinicWriteAccounts` parameter (or any future addition)
   must be mirrored exactly by whatever builds `access[]` at migration time. §3's discovery check
   converts "silently writes an incomplete entry" into "refuses to run", but someone still has to
   update the script's builder map when a genuinely new parameter ships — not automatic.
3. **Backup/rollback correctness must be exercised against disposable fixtures in Task 130.** The script in §8 must first be exercised against a disposable fake membership before any seeded fake staff account, same caution Task 090's Phase 0 used for the read-side mechanism.
4. **Break-glass accounts.** Per `REVIEW-task-isolation-1.md` finding 3, a no-policy membership
   might be intentional (not just a stale test account). Step 3's manual review is the only control
   for this — the script deliberately does not auto-apply to every eligible membership in one run.
5. **Historical `meta.accounts` gaps (433 resources at last count) must be backfilled before
   Phase 2**, or newly-restricted staff lose access to real pre-existing data the moment they're
   migrated (fail-closed, not a leak, but a real regression a clinic would notice immediately).
   Step 0.4 makes this an explicit precondition, not an afterthought.
6. **Out of this task's scope, do not let its existence imply it's handled:** Phase 3's admin-client
   defense-in-depth filters, the shared-device-key write gap, and the production/superAdmin
   boundary question (D20) — all unchanged by this plan, all still open.
