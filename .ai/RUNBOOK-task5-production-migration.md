# Task 5 — manual production cutover for Hidayat

**Agents must not run these production steps.** Only dev `127.0.0.1:8113`, compose `ucc-medplum-dev`, synthetic data was accessed. Do not deploy this change until the final review and gate evidence below are complete. Never copy dev passwords, project IDs, dump files or test state to production.

## Topology and maintenance window

Keep the clinical project's ID, staff membership IDs, clinical resources and Firebase/PACS links. Change that project to `superAdmin=false`; staff receive the clinic policy with parameters derived from active PractitionerRoles. Create a separate dedicated operator project with `superAdmin=true` and a new operator identity. No clinical staff or app client may belong to an operator/super-admin project. Moving existing resources with `$clone` changes IDs and is not an acceptable migration.

The app client remains a **trusted project administrator** because invitations and `$set-accounts` require that capability. Its clinical resource allow-list replaces wildcard clinical access, but Medplum injects administrative grants; a compromised client can edit project policies/memberships. This is not an independent security boundary against the app server. Existing clinic checks in code must remain. The platform admin remains a clinical-project admin; operator credentials must never be used by the application.

Schedule downtime. Stop app/device/PACS writers and new logins using your existing deployment controls; record the maintenance start. Freeze staff/clinic administration until verification or rollback finishes. Reauthenticate all staff after cutover. Do not assume that leaving old sessions open is safe.

## 1. Preconditions and backups

1. Deploy the reviewed application commit (including directory synchronization on invite/reassignment) during maintenance. Keep the prior app artifact for rollback. Firebase Storage stays unchanged.
2. Check the running **production** Medplum version yourself. Dev rehearsal uses **5.2.15**, although the brief specifies 5.2.8. A different patch version requires rehearsal on a separate fake-data instance of that exact version and review of the tagged policy implementation. Do not infer production compatibility from current website documentation.
3. Identify the clinical Project UUID, app ClientApplication UUID and the current admin identity from your deployment configuration/Medplum UI. Inventory every project membership of every staff identity: removing superAdmin from one project is insufficient if staff have another super-admin membership.
4. Ensure every active staff PractitionerRole points at exactly one valid clinic Organization; each Organization has one `identifier(system=clinic)` and one matching HealthcareService account. Resolve orphan roles, duplicate identifiers and custom staff policies explicitly. The migration refuses unknown policies and missing clinic assignments. Do not bypass these checks.
5. Inventory historical clinical accounts/identifiers with the existing backfill dry-run. Reconcile and stamp missing accounts in a separately reviewed migration; this script does not guess which clinic owns unassigned historical data. Missing stamps cause hidden records after cutover.
6. Take a full consistent PostgreSQL dump, record image/config revisions, and test restoration in an isolated database. Use the production compose/service/database/user names you have independently verified; placeholders below must be replaced before use. These commands are **for Hidayat only**:

```bash
umask 077
TASK5_DIR="$HOME/ucc-task5-production-backup"
mkdir -p "$TASK5_DIR"
docker compose -f <verified-production-compose-file> exec -T <postgres-service> \
  pg_dump -U <database-user> -Fc <database-name> > "$TASK5_DIR/pre-task5.dump"
pg_restore --list "$TASK5_DIR/pre-task5.dump" > "$TASK5_DIR/dump-toc.txt"
sha256sum "$TASK5_DIR/pre-task5.dump" > "$TASK5_DIR/pre-task5.dump.sha256"
```

Store an encrypted off-host copy and verify its checksum. A nonempty dump is only an acknowledgement to the script, not proof of a usable backup. Keep logs/backups private: real snapshots contain sensitive identity and clinic metadata. Never commit them.

## 2. Configure and review the dry-run

Use a trusted terminal; disable shell tracing. Passwords must be entered without echo, not placed in command arguments or shell history. Use a **new, dedicated operator email**, never a clinic staff or existing platform-admin address.

```bash
set +x
export MEDPLUM_BASE_URL='https://<verified-medplum-host>'
export MEDPLUM_ADMIN_EMAIL='<current-clinical-project-admin>'
read -rs -p 'Current admin password: ' MEDPLUM_ADMIN_PASSWORD; echo
export MEDPLUM_ADMIN_PASSWORD
P='<clinical-project-uuid>'
C='<app-client-uuid>'
OPS_EMAIL='<new-dedicated-operator-email>'
COMMON=(--project "$P" --app-client "$C" --operator-email "$OPS_EMAIL"
  --allow-remote "$MEDPLUM_BASE_URL" --backup-dir "$TASK5_DIR")
bun scripts/access-policy/task5-topology.mjs "${COMMON[@]}"
```

Default is dry-run: no migration resources or snapshot are written. Authentication does create a server Login. Expect no blockers. Review staff counts, planned grants, directory stamps, app membership and operator creation. Project/policy searches are explicitly scoped to the clinical project; existing custom policies cause refusal.

## 3. Apply once, then verify while maintenance remains active

```bash
bun scripts/access-policy/task5-topology.mjs "${COMMON[@]}" \
  --backup-confirmed "$TASK5_DIR/pre-task5.dump" --apply
```

Before writes, the script saves a mode-0600 snapshot of the clinical Project, policy definitions, membership grants, planned staff grants and directory account changes. It never overwrites the snapshot. It creates/verifies a dedicated operator login **before** demoting the clinical project. The generated operator password is stored mode 0600 in `operator-<email-hash>.pw` inside the backup directory; transfer it into your password manager without displaying it in shared logs. Keep it available securely through verification and rollback. Future reruns can use a securely supplied `OPERATOR_PASSWORD` if the file is removed.

If a step fails, keep maintenance active, inspect status-only output and dry-run again. Do not delete the lock file until the owning process is confirmed absent. Do not delete/replace the pre-change snapshot. Reapplying converges; policies and membership versions remain unchanged when already correct. Separate changes made after the snapshot may cause rollback to refuse rather than overwrite grants.

Verify all of the following with fresh staff sessions and **synthetic patients only**:

- Same-clinic Patient/Encounter/ServiceRequest/ImagingStudy read and normal write paths work.
- A clinic-A staff token gets 403/404 for clinic-B direct reads/updates/deletes; search omits B, and foreign-subject or forged-account creates fail. Repeat B → A. Administrative identity tables are inaccessible; staff search lists only authorized clinics.
- Use two deliberately created fake staff identities in different clinics, a common temporary password entered securely, and the correct clinical project:

```bash
read -rs -p 'Synthetic staff password: ' UCC_STAFF_PASSWORD; echo
export UCC_STAFF_PASSWORD
bun scripts/access-policy/verify-clinic-isolation.mjs --project "$P" \
  --staff '<fake-clinic-A-email>' --staff '<fake-clinic-B-email>' \
  --label production-manual --allow-remote "$MEDPLUM_BASE_URL" \
  --out "$TASK5_DIR/manual-isolation.json"
unset UCC_STAFF_PASSWORD
```

The verifier creates/deletes tagged synthetic probes and exits nonzero for denial failures, malformed/paging failures or incomplete cleanup. Inspect its exit code and totals. No test may use real patients.

- Complete a fake patient's registration → check-in → consultation → autosave/reload/sign → treatment → Lab → checkout, and test admin invite, clinic reassignment, deactivation and deletion. Reassignment must remove visibility from former colleagues.
- POCT orders require an online analyser. Send a synthetic device result using your existing device test setup; results appear only in Lab. Repeat the X-ray workflow. No manual result entry, composer critical warning, nav change or Firebase replacement is part of this migration.
- Confirm old staff tokens also lose administrative and cross-clinic access; revoke old sessions through the existing session administration procedure if any retain access. Confirm the app client cannot read another project's clinical resource. Confirm dedicated operator recovery login works.

Remove the fake users and verify probe cleanup. Resume writers only after every required check passes. Retain the old application artifact, snapshots and dump through the agreed retention window. Record version, commit, operator, timestamp, totals and backup checksum without patient data or credentials.

## 4. Rollback

Keep all writers stopped. Ensure the operator password file or securely supplied `OPERATOR_PASSWORD` is available. The old admin is no longer a super-admin; the script switches to the dedicated operator for recovery.

```bash
bun scripts/access-policy/task5-topology.mjs "${COMMON[@]}" --rollback
bun scripts/access-policy/task5-topology.mjs "${COMMON[@]}" --rollback \
  --backup-confirmed "$TASK5_DIR/pre-task5.dump" --apply
```

Rollback checks target identity and grant/policy/directory drift before restoring. It restores backed-up membership grants, policies, directory accounts and the project's original name/links/superAdmin flag; policies created by the migration are removed. The dedicated operator is intentionally retained as a recovery identity. After original admin login is verified, Hidayat can remove that operator membership/profile/user/project manually in Medplum, after checking there are no other memberships or resources. Do not remove the last working super-admin identity.

If drift checks refuse, compare the private snapshot with live state during maintenance; reconcile the independently changed grants intentionally, then retry. Do not weaken the checks to force a restore. If the server cannot be recovered through the API, restore the tested dump using your existing database recovery procedure with app/device writers stopped. Database restore loses writes since the snapshot. Roll back the app artifact as needed, verify fake normal workflows and then reopen.

## Dev evidence and release status

See `.ai/REVIEW-task5.md` for exact results and limitations. No production migration, push, remote change, PR or merge is performed by this worktree. The root AGENTS.md explicitly prohibits pushes and PR creation; a local draft PR description is supplied for manual publication.
