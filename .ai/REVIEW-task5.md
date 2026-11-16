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

Only API access to dev Medplum at 127.0.0.1:8113 and a read-only inspect of `ucc-dev-medplum` (compose `ucc-medplum-dev`) were used. Actual server is 5.2.15; official tagged 5.2.8 and 5.2.15 source was reviewed. No production containers, /opt/medplum, /root, Supabase, Tradebot, real patients, remote git operations, push, PR or merge.

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
