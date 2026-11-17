# Task 5 — manual production cutover for Hidayat

All `bun scripts/...` commands below run from the **repository root** of the reviewed checkout (dependencies installed). The `$P`, `$C`, `$TASK5_DIR`, `COMMON` variables must be set in the same shell session.

**Agents must not run these production steps.** Only dev `127.0.0.1:8113`, compose `ucc-medplum-dev`, synthetic data was accessed. Do not deploy this change until the final review and gate evidence below are complete. Never copy dev passwords, project IDs, dump files or test state to production.

## Release hold and what has actually been tested

**Task 404 does not authorize cutover.** Offline fake-response tests cover the session commands (multiple pages, absent/false/true revocation, concurrent edits, access and refresh checks). They do **not** prove server behavior. The live disposable demotion/session/rollback rehearsal needs a newly supplied dev super-admin login and remains **OUTSTANDING by instruction**. Do not retrieve passwords from another run's files or transcripts. The complete current-head browser gate and exact-production-version rehearsal also remain outstanding; historical gate claims are not a release approval.

Before maintenance, Hidayat must have the reviewed commit, a working dedicated operator login in a separate project, the original clinical admin login, the private backup folder and its checksum, and a deployment recovery card tested on an isolated fake-data copy. That card must name the previous app artifact, the person restoring it, the database restore command for the actual deployment, its restore test result, and how writers/new logins are stopped and reopened. If any item is missing, stop before apply. This runbook cannot safely invent production service names or a database restore command.

## Topology and maintenance window

Keep the clinical project's ID, staff membership IDs, clinical resources and Firebase/PACS links. Change that project to `superAdmin=false`; staff receive the clinic policy with parameters derived from active PractitionerRoles. Create a separate dedicated operator project with `superAdmin=true` and a new operator identity. No clinical staff or app client may belong to an operator/super-admin project. Moving existing resources with `$clone` changes IDs and is not an acceptable migration.

The app client remains a **trusted project administrator** because invitations and `$set-accounts` require that capability. Its clinical resource allow-list replaces wildcard clinical access, but Medplum injects administrative grants; a compromised client can edit project policies/memberships. This is not an independent security boundary against the app server. Existing clinic checks in code must remain. The platform admin remains a clinical-project admin; operator credentials must never be used by the application.

Schedule downtime. Stop app/device/PACS writers and new logins using your existing deployment controls; record the maintenance start. Freeze staff/clinic administration until verification or rollback finishes. Reauthenticate all staff after cutover. Do not assume that leaving old sessions open is safe.

## 1. Preconditions and backups

1. Deploy the reviewed application commit (including directory synchronization on invite/reassignment) during maintenance. Keep the prior app artifact for rollback. Firebase Storage stays unchanged.
2. Check the running **production** Medplum version yourself. Dev rehearsal uses **5.2.15**, although the brief specifies 5.2.8. A different patch version requires rehearsal on a separate fake-data instance of that exact version and review of the tagged policy implementation. Do not infer production compatibility from current website documentation.
3. Identify the clinical Project UUID, app ClientApplication UUID and the current admin identity from your deployment configuration/Medplum UI. Inventory every project membership of every staff identity: removing superAdmin from one project is insufficient if staff have another super-admin membership.
4. Ensure every active staff PractitionerRole points at exactly one valid clinic Organization; each Organization has one `identifier(system=clinic)` and one matching HealthcareService account. Resolve orphan roles, duplicate identifiers (including the same clinic identifier on multiple Organizations), and custom staff policies explicitly. The migration refuses unknown policies and missing clinic assignments. Do not bypass these checks.
5. Inventory historical clinical accounts/identifiers with the existing backfill dry-run. Reconcile and stamp missing accounts in a separately reviewed migration; this script does not guess which clinic owns unassigned historical data. Missing stamps cause hidden records after cutover.
6. Take a full consistent PostgreSQL dump, record image/config revisions, and test restoration in an isolated database. Use the production compose/service/database/user names you have independently verified; enter those verified values at the prompts below. These commands are **for Hidayat only**:

```bash
umask 077
TASK5_DIR="$HOME/ucc-task5-production-backup"
mkdir -p "$TASK5_DIR"
(
set -e
test ! -e "$TASK5_DIR/pre-task5.dump"
read -r -p 'Verified production compose file: ' TASK5_COMPOSE
read -r -p 'Verified PostgreSQL service name: ' TASK5_DB_SERVICE
read -r -p 'Verified database user: ' TASK5_DB_USER
read -r -p 'Verified database name: ' TASK5_DB_NAME
docker compose -f "$TASK5_COMPOSE" exec -T "$TASK5_DB_SERVICE" \
  pg_dump -U "$TASK5_DB_USER" -Fc "$TASK5_DB_NAME" > "$TASK5_DIR/pre-task5.dump"
pg_restore --list "$TASK5_DIR/pre-task5.dump" > "$TASK5_DIR/dump-toc.txt"
sha256sum "$TASK5_DIR/pre-task5.dump" > "$TASK5_DIR/pre-task5.dump.sha256"
)
```

Require exit 0 from that block. It refuses to overwrite an existing dump and stops if backup creation or inspection fails. Store an encrypted off-host copy and verify its checksum. A nonempty dump is only an acknowledgement to the script, not proof of a usable backup. Keep logs/backups private: real snapshots contain sensitive identity and clinic metadata. Never commit them.

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

Before writes, the script saves a mode-0600 snapshot of the clinical Project, policy definitions, membership grants, planned staff grants and directory account changes. It never overwrites the snapshot. Keep the adjacent `task5-written-<project>.json` manifest too: it records policy identities before creation so rollback can reject replacement resources with the same name. It creates/verifies a dedicated operator login **before** demoting the clinical project. The generated operator password is stored mode 0600 in `operator-<email-hash>.pw` inside the backup directory; transfer it into your password manager without displaying it in shared logs. Keep it available securely through verification and rollback. Future reruns can use a securely supplied `OPERATOR_PASSWORD` if the file is removed.

**If apply stops:** keep maintenance active. Do not improvise resource deletion, change operator email, or restart Medplum. Use section 4's decision table. An `Operator email already exists` error may mean a partially created identity, but it can also mean a genuine existing account. Neither the manifest nor timestamps alone prove that deleting it is safe. Orphan-operator deletion/re-invitation is not a tested recovery path: stop and ask the migration maintainer to inspect the private snapshot/manifest and account memberships. Do not delete the User or Practitioner. If there is no working operator and the clinical project has already been demoted, proceed only through the pretested deployment recovery card with its named operator.

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
- Confirm old staff tokens lose administrative/cross-clinic access. Use section 3a for session revocation and the separate fake-session verification. Confirm the app client cannot read another project's clinical resource and the dedicated operator can still sign in.

Remove the fake users and verify probe cleanup. Resume writers only after every required check passes. Retain the old application artifact, snapshots and dump through the agreed retention window. Record version, commit, operator, timestamp, totals and backup checksum without patient data or credentials.

## 3a. End old staff sessions (operator only)

This signs the selected **User out of every project**, not just one clinic. Keep new logins blocked. Work through the staff inventory one User at a time; never select the recovery operator. In the trusted Medplum admin resource viewer, open that staff member's `ProjectMembership`, read `user.reference` (`User/…`), and copy only the ID after `/`. Do not copy a Practitioner or membership ID. Obtain the separate operator Project ID from the operator's Project resource. If you cannot identify either confidently, stop and ask the maintainer.

1. Stay in the reviewed repository root. Copy the whole block below into the trusted Bash terminal. Enter **your authorized operator credentials** at the hidden password prompt. This block runs in a subshell, so the clinical admin settings used for rollback stay intact. Replace no code. When asked for an origin, enter `http://127.0.0.1:8113` for the future authorized dev rehearsal; production is a manual Hidayat operation after release approval.

```bash
(
set +x
export NODE_OPTIONS=--max-old-space-size=3072
read -r -p 'Approved Medplum origin (no trailing path): ' MEDPLUM_BASE_URL
read -r -p 'Dedicated operator email: ' MEDPLUM_ADMIN_EMAIL
read -rs -p 'Dedicated operator password: ' MEDPLUM_ADMIN_PASSWORD; echo
export MEDPLUM_BASE_URL MEDPLUM_ADMIN_EMAIL MEDPLUM_ADMIN_PASSWORD
read -r -p 'Operator Project ID: ' TASK5_OPS_PROJECT
read -r -p 'Staff User ID (without User/): ' TASK5_STAFF_USER
SESSION_ARGS=(--operator-project "$TASK5_OPS_PROJECT" --user "$TASK5_STAFF_USER"
  --allow-remote "$MEDPLUM_BASE_URL")
bun scripts/access-policy/revoke-staff-sessions.mjs "${SESSION_ARGS[@]}" || exit
read -r -p 'Preview correct? Type REVOKE to sign this User out: ' TASK5_CONFIRM
[ "$TASK5_CONFIRM" = REVOKE ] || exit
bun scripts/access-policy/revoke-staff-sessions.mjs "${SESSION_ARGS[@]}" --apply || exit
bun scripts/access-policy/revoke-staff-sessions.mjs "${SESSION_ARGS[@]}" || exit
)
```

2. First output must show `mode:"PREVIEW"`, `found`, `pages` and `toRevoke`. Compare the chosen User against the staff inventory before typing `REVOKE`. Preview changes no Login records, although authenticating creates an operator Login. The helper refuses the operator's own User and a non-super-admin session. A zero count on an account known to have a session is a stop condition, not evidence of success. An operator requiring interactive MFA needs a separately reviewed login flow; stop and ask the maintainer rather than disabling MFA.
3. Apply must exit 0 and show `mode:"APPLIED"`. The final preview must show `toRevoke:0`. No credentials or response bodies are printed. If any command exits nonzero or displays `ERROR`, keep maintenance active. The helper stops on invalid pages, foreign users, concurrent changes (HTTP 412), or unsuccessful writes. Some earlier sessions might already have been revoked; preview and apply may be repeated after the cause is understood. Repeated apply skips already revoked records.
4. Do this for every staff User from the reviewed inventory. Session revocation cannot be rolled back: leave `revoked:true` and have staff sign in afresh after verification. Restoring project policies does not revive revoked sessions.

The actual API sequence is `GET /fhir/R4/Login?user=User%2F<ID>&_count=100`, follow every `next` link, validate each record belongs to that User, and filter `revoked !== true` **in memory**. Each selected record is updated with `PUT /fhir/R4/Login/<ID>` containing the original fields plus `revoked:true` and `If-Match: W/"<meta.versionId>"`. A second paginated search must find no unrevoked records. Medplum 5.2.8 defines only `user`, `code`, and `cookie` Login search parameters; `revoked` is a resource field, not a search parameter. Tagged [Login definition](https://github.com/medplum/medplum/blob/v5.2.8/packages/docs/static/data/medplumDefinitions/login.json), [access-token check](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/oauth/utils.ts), [refresh check](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/oauth/token.ts).

### Fake-session proof required before release — OUTSTANDING live

Do not run this with a real staff account. In a future explicitly authorized rehearsal, create a disposable fake staff User in the fake clinical project and deliberately give it sessions on at least two pages (more than 100 Logins). Supply the new authorized dev operator credential; never recover one from historical artifacts. Use the same prompts/subshell as above, but **before** the helper invocation enter these additional values:

```bash
read -r -p 'Disposable fake staff email: ' UCC_PROBE_EMAIL
read -rs -p 'Disposable fake staff password: ' UCC_PROBE_PASSWORD; echo
read -r -p 'Disposable fake clinical Project ID: ' UCC_PROBE_PROJECT
export UCC_PROBE_EMAIL UCC_PROBE_PASSWORD UCC_PROBE_PROJECT
bun scripts/access-policy/revoke-staff-sessions.mjs "${SESSION_ARGS[@]}" \
  --apply --verify-fake-session
```

The fake User ID must equal `TASK5_STAFF_USER`. This command first obtains and checks a staff access token and successfully refreshes it, retaining the rotated tokens only in memory. After revoking, both previously issued access tokens must receive **401** from `GET /auth/me`, and the rotated refresh token must receive **400** with OAuth `invalid_grant` from `POST /oauth2/token`. Any other response fails. Require `fakeSessionVerified:true` and `pages>1`; then prove a new fake staff sign-in works with the correct clinic restrictions. Retain counts/statuses/version/commit only, and clean up the disposable fixtures using the rehearsal's tracked fixture list. Also run the topology rehearsal with nonempty foreign-clinic fixtures and actual multi-page isolation coverage. None of these live steps was run in Task 404.

If old access or refresh still works, keep maintenance active and escalate with statuses/version/commit only. There is **no tested delete/re-invite, restart, or token-expiry fallback** in this runbook.

## 4. Recovery and rollback, one step at a time

Do not reopen writers or new logins during recovery. Do not delete the snapshot or manifest, edit their JSON, bypass a refusal, or remove the last working operator. Never run two migration commands together.

| What happened | Next action |
| --- | --- |
| Apply returned success but verification failed | Follow the rollback preview and apply steps below. |
| Command stopped part way through | Keep backups; run rollback preview below. Only a successful preview permits rollback apply. |
| `task5.lock` exists | Ask the maintainer to confirm the PID in that private lock file is absent and no migration runs elsewhere. Only then may the maintainer remove the stale lock and retry preview. Do not blindly delete the lock. |
| `Operator email already exists`, missing operator login, or missing snapshot/manifest | Stop. Have the maintainer inspect the saved state. Do not delete/re-invite an identity or select another email. |
| Any drift, missing policy/member, or target mismatch refusal | Stop. Give the maintainer the status-only error and private evidence location. They must reconcile the change intentionally; no force option is safe. |
| API unavailable or no authorized recovery identity | Use the previously tested deployment recovery card with its named database operator. If no tested card exists, remain in maintenance and escalate. |

1. Return to the **same Bash session** used for migration, in the reviewed repository root. If the terminal was closed, repeat section 2 using the same origin, clinical admin, clinical Project, app client, operator email and original backup directory; **do not run apply**. The migration CLI needs the clinical admin credentials even when it later switches to the operator. Do not replace `MEDPLUM_ADMIN_EMAIL` with `OPS_EMAIL` (the CLI rejects identical identities).
2. Confirm the original files exist without printing their contents, and check the database dump checksum. A missing/empty file or checksum mismatch means stop; never create a replacement snapshot.

```bash
test -s "$TASK5_DIR/task5-pre-$P.json" && \
  test -s "$TASK5_DIR/task5-written-$P.json" && \
  test -s "$TASK5_DIR/pre-task5.dump" && \
  sha256sum -c "$TASK5_DIR/pre-task5.dump.sha256"
```

3. If the dedicated operator password file remains in this migration's backup directory, the CLI loads it privately. Otherwise enter the password from **your password manager** (not another run's files). Keep the clinical admin variables from section 2.

```bash
read -rs -p 'Dedicated operator password from your password manager: ' OPERATOR_PASSWORD; echo
export OPERATOR_PASSWORD
bun scripts/access-policy/task5-topology.mjs "${COMMON[@]}" --rollback
```

4. Preview must exit **0**, end with `DRY-RUN complete. Drift checks passed; nothing was written.`, and list the intended original project/grants/policies/directory restoration. Any `ERROR`, nonzero exit, unexpected target or missing file means **stop** and follow the table. Preview validates the same drift conditions as apply. Do not infer success from the first few printed lines.
5. Only after a successful preview, copy this rollback command. It uses the unchanged original snapshot/manifest and dump acknowledgement:

```bash
bun scripts/access-policy/task5-topology.mjs "${COMMON[@]}" --rollback \
  --backup-confirmed "$TASK5_DIR/pre-task5.dump" --apply
```

6. Require exit **0** and the final `ROLLBACK complete.` line. If it stops, keep maintenance active; some changes may already be restored. Retain all evidence and run preview again after the maintainer has identified the failure. Preview/apply are designed to accept fields already restored while rejecting independent drift.
7. In a new browser session, sign in as the original clinical admin. Confirm the clinical Project ID is unchanged and its name, links and `superAdmin` value match the private pre-change snapshot. Confirm the original staff grant/directory behavior using fake users in both clinics. The operator remains available intentionally. Run section 3a's session checks as appropriate; never reset a revoked session to false. Rollback restores the earlier security posture, so keep maintenance active until the owner accepts it or the boundary is repaired.
8. Have the named deployment operator restore the recorded prior app artifact if required, using the pretested recovery card. Verify a fake patient's full normal workflow and both clinic boundaries. Hidayat may reopen only after those checks and the security decision are recorded. Keep the dedicated operator through the recovery window; its deletion is a separate reviewed task.
9. Clear terminal credentials when finished:

```bash
unset MEDPLUM_ADMIN_PASSWORD OPERATOR_PASSWORD UCC_PROBE_PASSWORD UCC_STAFF_PASSWORD
```

The earlier Task 352 disposable rehearsal exercised rollback preview/apply, exact restoration and drift refusal; see `.ai/REVIEW-task5.md`. Task 404 did not repeat it. Database restoration is deployment-specific and has **not** been tested here; the pretested recovery card is mandatory before cutover. A database restore loses writes since the dump. No instruction here authorizes an agent to operate production.

## Dev evidence and release status

See `.ai/REVIEW-task5.md` for exact results and limitations. No production migration is performed by this worktree. The user explicitly authorized milestone branch pushes and a draft PR into dev for Task 5, overriding the general AGENTS publication restriction. Never merge or force-push. Production cutover remains Hidayat’s manual responsibility.
