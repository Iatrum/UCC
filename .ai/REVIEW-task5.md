# Task 5 — security review and verification

Status: implementation and migration rehearsal verified; corrected full gate, cleanup and publication pending. Self-review only; no independent agent was invoked.

## Design

Keep the clinical project/resource/membership IDs and demote that project to non-superAdmin; create a dedicated operator project/identity. Staff policies plus server-enforced account/write constraints provide the primary boundary. Application clinic checks remain. The app client is a distinct credential with an explicit clinical type list, but remains a trusted project administrator for invitations and account assignment. Medplum injects administrative rights; this is not a sandbox against a compromised app server.

Never copy resources with `$clone` to move clinics: resource IDs and external Firebase/PACS links would change. Migration derives each staff grant from active PractitionerRoles and the unique clinic Organization/HealthcareService pair. Unknown policies, absent clinics, clinic-assigned human admins and staff with another active superAdmin membership cause refusal. The operator must have exactly one membership in its own project.

## Findings fixed

- Staff in a superAdmin project bypassed directory and parts of write containment. Demotion plus explicit policy entries removes those privileges.
- Unrestricted Practitioner reads exposed other clinics' staff. Partition directory profiles by clinic accounts and synchronize invites/reassignments. Clear old directory accounts before reassignment, so a failed synchronization hides the entry.
- Raw Patient create could return 201 with a forged foreign clinic identifier. Staff Patient create is now denied; authenticated app registration already creates/stamps Patients through its server helper. Patient updates preserve metadata and clinic identifiers.
- Migration policy discovery must be project scoped. Clear overriding app-client access[] when assigning its dedicated policy.
- Bind snapshots/manifests to target origin/project. Retain original snapshots; version-condition updates and refuse policy/grant/directory drift during rollback. Planned policy IDs are recorded before creation, preventing same-name replacement confusion.
- A foreign update may return 404 rather than 403 after demotion. The prerequisite test accepts either denial; successful writes remain failures.
- VPS paths differ from the original /workspace environment. Added explicit overrides for gate output, draft screenshots and membership-test backups, retaining previous defaults.

## Safety and evidence provenance

Only API access to dev Medplum at 127.0.0.1:8113 and a read-only inspect of `ucc-dev-medplum` (compose `ucc-medplum-dev`) were used. Actual server is 5.2.15; official tagged 5.2.8 and 5.2.15 source was reviewed. No production containers, /opt/medplum, /root, Supabase, Tradebot or real patients were accessed. Original recovery was local; subsequent milestone pushes and draft PR publication follow the user’s explicit Task 5 authorization. No merge or force-push.

Recovered the prior Task 5 local WIP commits into a new origin/dev worktree. Original worktree and its unrelated image/test changes were left alone. Stopped the prior task's orphan background test and extra :3251 dev server, then used the sole :3210 dev server in this worktree with a 3072 MB heap cap.

Inherited evidence (before 71/110; after 108/108) is not fresh verification. The dev clinical project had already been demoted by that WIP. Refreshed its policy using the hardened script, retaining the original backup directory/dump. The current update has a separate snapshot under `/home/dev/ucc-task5-policy-evidence/current-update-backup` at the explicitly authorized 127.0.0.1 origin; the inherited original snapshot uses localhost and is not overwritten.

Backed up and removed three confirmed synthetic stale test memberships/profiles/roles (two pointed to deleted clinics; one carried a custom disposable test policy). Global Users were retained. Backups are private outside git. Normal seeded staff and clinical resources were not removed.

The first full-gate attempt was interrupted after a fake Playwright cookie was accidentally displayed from an API ECONNRESET error-context artifact. That exact fake Login was revoked via dev API; saved artifacts were redacted, and verification restarted with a fresh session. Do not count that interrupted run as a pass.

## Verification

- Unit suite: 127 passed, 0 failed (14 files).
- Disposable non-superAdmin topology rehearsal: dry-run, apply, no-op second apply, live pre-cutover token restriction, app-client boundaries, grant-drift refusal, default dry-run rollback, exact grant/policy/directory restoration, cleanup passed. Its black-box verifier passed 110/110 with no fatal error. The final manifest/admin-identity rerun below supersedes this earlier rehearsal.
- First completed full gate (`task5-policy-final`): lint/build/clinic inventory 0; 60/64 tests passed. Time Chit hit a stale synthetic catalog duplicate; checkout captured only “Loading checkout...” after its fixed six-second sleep, filled zero, then failed and skipped serial smoke/summary. Backed up/deleted the one stale fake catalog and replaced the test sleep with UI readiness and a real-total assertion. This run remains FAIL. A corrected full gate is required.
- Corrected final full gate: pending. Baseline explicitly supplied: `/home/dev/ai-logs/int-360/reports/results.json`, an inherited 58/62 run with four previously recorded failures. The comparator alone is insufficient evidence for the requested positive workflows; record their actual results below.
- Final manifest/ownership rehearsal (`rehearsal-verified.log`): PASS, including refusal to promote an unrelated same-name project, policy-ID manifest checks, pre-cutover token restriction, app-client scope, no-op reapply, 110/110 isolation checks, drift refusal, exact rollback and complete cleanup.
- Live clinical-project verification (`isolation-final.json`): 110/110, no fatal error, all 10 probes removed. Pagination was exercised against the larger fake dataset, with localhost canonical links rewritten onto the approved 127.0.0.1 endpoint.
- Admin API smoke: PASS (invite, profile/clinic edit, staff login/read, admin-directory denial, retained-session deactivation, reactivation, deletion).
- A subsequent full-gate attempt was stopped after Feedback generated an ID-like random hex title suffix; the privacy scrubber correctly redacted it, so exact-title lookup failed. Confirmed the stored title contained REDACTED; use an alphabetic random suffix. Backed up/deleted that one synthetic row. This was not a pagination problem; no pagination test change is retained.
- Task gates now use `UCC_NO_TRACE=1` to avoid retaining credential-bearing traces; task-owned old traces/report bundles were removed and text artifacts redacted. Private migration backups remain exact and contain no redaction markers.
- Dev server cleanup: pending.

Production remains a manual Hidayat operation under `.ai/RUNBOOK-task5-production-migration.md`; no production readiness claim until all pending items are resolved and the pinned production version is separately rehearsed.

## Resumed verification (16 November, Codex)
- WIP checkpoint and subsequent milestones normally pushed; draft PR https://github.com/Iatrum/UCC/pull/251 targets dev. New dev Task 330/355 changes cherry-picked, retaining report-ingress authentication; no merge or history rewrite. Shared status notes moved to `progress-task5.md` so the PR has a clean conflict preview.
- Built gate `task5-policy-built`: 41/64, FAIL. Six POCT failures came from the unchanged production-only rejection of simulated Devices; later workflow/X-ray failures followed loss of the built server and auth throttling. Do not relax the production guard or count this gate as a pass.
- Focused development-mode POCT (`resume-poct.log`): **8/8 PASS**, including online/offline ordering, Lab ingestion, disabled-module mutation, subscription notifications/polling/unmount cleanup, and per-device cross-clinic denials.
- Integrated units after newer dev commits (`unit-resumed-integrated.log`): **154/154 PASS**.
- Full gate `task5-policy-resumed-final`: lint/build PASS; browser/clinic results pending. Sole Next server uses development mode with webpack on :3210, 3072 MB cap; orchestration owns and cleans its process group.
- Disposable topology/rollback rehearsal `rehearsal-resumed.log`: **PASS**, including dry-run, no-op apply, fresh-token 110/110 isolation, drift refusal, exact rollback and complete fixture cleanup.
- A saved failed Playwright request exposed a fake session cookie during resumed inspection. Its exact Login was revoked (200), built-run artifacts redacted, and subsequent inspection prints only status/boolean summaries. No credential is committed.

- `task5-policy-resumed-final` was interrupted deliberately when another task started a second dev server on :3218. The sole Task 5 :3210 process group was stopped; the other task was left alone. Retained result: 16 passed, 2 failed (both fixture admin logins hit Medplum 429 because the rehearsal overlapped), 1 interrupted, remaining tests unrun; gate FAIL. Twenty exact synthetic fixtures created during the interrupted membership test were identified by its recorded time window and exact fake names/links, privately backed up, and removed. No historical fixtures or ordinary staff were removed.
- Other task’s server exited. Replacement gate `task5-policy-resumed-clean` runs with no parallel migration/auth rehearsal, preflights both synthetic NRIC patterns, and keeps separate evidence; pending.

- Clean monolithic gate `task5-policy-resumed-clean`: **55/65, FAIL**. Every POCT and X-ray test passed, along with CLI membership migration and composer persistence/retry suites. Time Chit reached its baseline-failing admin module-save step (line173); Next hit its 80% dev heap restart during workflow check-in (`ERR_CONNECTION_REFUSED`), skipping the serial remainder. Do not count skipped workflow tests as passed. The server group was cleaned up.
- Added opt-in `UCC_E2E_BATCHED=1` foreground driver so the complete gate can reclaim Next compiler memory between sequential groups. Every discovered spec runs once, without retries; missing/fatal reports fail the gate. Individual reports are retained and all suites feed the normal baseline comparator. Final batched gate pending.

- First batched gate `task5-policy-batched-final`: **55/65 FAIL**, no retries. API/membership 19/19, composer/Lab-state16/16, POCT/X-ray18/18. Time Chit remains failing at admin module save; workflow check-in exposed the unchanged 200-Encounter queue page cap after repeated synthetic runs. A real doctor token reads the new own-clinic Patient/Encounter, but the first queue page omits it; 222 Encounters match. This is not an isolation denial.
- Synthetic hygiene: privately backed up and removed 1347 clinical resources owned by this task's logged Fake Patient creation ledger (234 Patients/135 Encounters), two old unscoped disposable migration identities (8 resources), and two exact Time Chit fake identities whose clinic had been deleted (8 resources). No seeded/other-task patients, production or Firebase Storage were changed. Fresh main-project topology dry-run: PASS, no parameter/directory refresh. Live verifier and corrected batched gate pending.

- Post-hygiene main-project verifier (`isolation-resumed-final.json`): **112/112 PASS**, zero fatal error; all10 probes deleted. Two extra checks exercise the explicit foreign-operator-project resource. Read-only live audit: clinical project non-superAdmin; all11 active staff memberships have only clinic policy access entries, zero unscoped staff.
- Final complete rerun `task5-policy-batched-accepted` is in progress. Batch1:18/19; legacy membership CLI dry-run invocation returned1 (same test fails in supplied baseline; earlier fresh runs on this branch passed). The new topology migration rehearsal is a separate PASS. Preserve the failure; no assertion or retry change. Batch2 is passing; workflow still pending.

- **Final gate (`task5-policy-batched-accepted`, 2026-11-16):** lint 0, build 0, 5 batches covering every spec, no retries. POCT/X-ray batch 18/18 (the earlier 401-vs-403, disabled POCT add button and subscription-poll failures did not recur), workflow 02-10 pass, drafts/lab-state/save-state 16/16. Remaining failures, all also failing on the baseline: legacy `staff-membership` CLI test, Time Chit toggle, workflow 11 known-bug summary. No new failures.

## Task 352 — independent review (16 November 2026)

Reviewed PR #251 at eecea53 independently in `/home/dev/ucc-task352-review`, created from origin/dev and stacked on the PR head. This section reviews the original builder’s work; earlier self-review entries are inherited. **Original verdict: CHANGES REQUIRED (MAJOR).** Fixes are on `ai/task-352-independent-review`, draft PR https://github.com/Iatrum/UCC/pull/258, based on `ai/task5-clinic-policy`.

Findings and changes:
- Rollback preview returned before drift checks. Preview and apply now execute the same safety preflight and fail on blockers.
- Restoring `superAdmin` could elevate a membership added after the snapshot. Rollback now rejects added/missing memberships and changes to membership identity/status, plus unexpected project name/links.
- Missing backed-up policies were silently skipped. Recovery now refuses before writes rather than claiming a complete restoration.
- Duplicate clinic identifiers on Organizations could map separate Organizations onto the same account compartment. Migration rejects ambiguous Organization/account identifiers before writes.
- Several directory isolation assertions accepted HTTP errors as empty results, and successful authentication was not bound to the expected identity. The verifier now validates Bundle contents, successful HTTP status for empty-search outcomes, and exact staff project/membership/profile with no admin/superAdmin privilege.
- Negative CLI probes accepted any exit 2, including unrelated authentication failure. Every negative case now requires its exact static refusal reason and expected status. Thus an auth failure fails the rehearsal instead of proving safety.

The manual runbook now specifies the preview blockers and duplicate clinic identifier restriction. Its maintenance freeze, tested database restore, stable resource IDs, separate dedicated operator, retained recovery credentials, synthetic-only verification and old-token checks are appropriate. The app client remains a trusted project administrator; its policy is not a sandbox against server compromise. Production cutover remains a manual operator operation and requires rehearsal against the actual production version.

Verification evidence is private under `/home/dev/ucc-task352-evidence`. Initial/mid-edit rehearsals are diagnostic only; the final exact-reason run and full gate below determine the patched verdict. Units passed 154/154. Dev `/fhir/R4/metadata` independently reports `5.2.15-4d86215`; neither this test nor inherited evidence establishes 5.2.8 runtime compatibility. Official-source research is in `.ai/research/task352-independent-review.md`.

Only http://127.0.0.1:8113 was accessed at runtime. No production containers, /opt/medplum, /root, Supabase, Tradebot, real patients, Firebase Storage or application/composer/navigation code was changed. All topology mutations use disposable fake projects. Publication was explicitly authorized by the Task 352 user request, overriding AGENTS' general no-push/no-PR rule; no merge or force-push.

Final disposable rehearsal at code commit `8c486d3`: **PASS, exit 0**; 42 top-level assertions, black-box clinic isolation **110/110**, no fatal error, all probes and fixtures cleaned up. Preview/apply negative cases require exact refusal reasons for duplicate clinic identifiers, unowned operator-project promotion, grant drift, added membership, project rename and missing backed-up policy. Verified private snapshot/manifest permissions, no-op reapply, pre-cutover token restriction, app-client scope, and exact policy/grant/directory rollback. Evidence: `final-rehearsal.log`, `rehearsal-summary.json`, plus its private disposable snapshot directory.

First full gate (`task352-independent-review`): lint/build/clinic inventory0, API/membership19/19, composer/Lab-state16/16, POCT/X-ray18/18. Overall **FAIL,58/65**: Time Chit hit its baseline admin-save failure; workflow06 checked persisted orders after a fixed15-second sleep while cold compilation made POST/api/labs/order take15.9seconds, skipping serial07–11. This is retained as failed evidence. Replaced only the fixed sleep with a90-second bounded poll requiring the same medication plus two ServiceRequests before the existing assertions; no application/composer change. A fresh complete gate is required. The driver cleaned its server groups; a subsequent3210 listener belongs to `/home/dev/ucc-task357`, left untouched.

Replacement gate (`task352-independent-review-final`): **FAIL,55/65**, retained separately. All first53 tests passed; workflow03 could not find the new fake patient in queue, skipping later serial steps. Direct dev API diagnosis returned200 Encounter entries plus a next page; the owned patient had an Encounter but was outside that page. This is the existing queue cap (`getTriageQueueForToday(200)`), not evidence of policy denial. Privately backed up and removed only this task’s82 logged fake Patients and their clinical children:534 resources, including57 Encounters. Provenance was selected only when every target was task-owned. The first cleanup hit the trusted app client’s FHIR quota; resumed exact backed-up IDs with the dedicated dev operator, with no quota/config changes. After cleanup,165 matching demo Encounters remained.

For the next complete gate, opt-in `UCC_E2E_WORKFLOW_FIRST=1` runs the full patient workflow before other suites add fixtures, then every remaining group exactly once. No assertions, specs or retries are removed; the queue cap remains an explicit pre-existing limitation. No application/queue/composer code is changed.

## Task 387 — Codex review 353 follow-up (16 November 2026, Claude)

- Merged `origin/dev` into the Task 5 branch (merge commit, no rebase). Five e2e conflicts: `check-all.sh` keeps BOTH gate modes (`UCC_E2E_BATCHED` and `UCC_LOW_MEMORY_GATE`); the four spec guards take dev's version (accepts localhost/127.0.0.1 and any app port, Medplum pinned to :8113).
- `verify-clinic-isolation.mjs`: the foreign-Practitioner leak check now fails when the foreign-only set is empty, with a separate explicit non-vacuity check; admin role listing checks status and uses `_count=100` (the `http()` helper already follows every `next` link, so paging is exercised rather than truncated).
- Runbook: repo-root note, manual recovery for orphan operator User, concrete (but unverified) session revocation via `Login.revoked`.
- **Live demotion rehearsal NOT run.** The only dev credential in the env files (e2e admin) logs in to project "UCC Clinics", which is already `superAdmin=false`, so the rehearsal cannot create fixture projects. A super-admin operator credential is needed (`DEV_OPERATOR_EMAIL`/`DEV_OPERATOR_PASSWORD`). I did not use passwords from other runs' backup directories or agent transcripts. Nothing on dev was changed; the failed attempts cleaned up their fixtures.
