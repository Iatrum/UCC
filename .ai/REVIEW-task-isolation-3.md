# Task 130 self-review

Scope: local-only migration script, regression fixtures, imported plan and shared notes. No app/UI code changes and no sidebar/navigation changes. Review by the builder; no independent reviewer or delegated agent was used.

## Authorization and rollout
- URL allowlist requires a local host on :8113, root URL, no embedded credentials/query/hash; requests reject redirects and cross-origin pagination. Mutation requires explicit --apply and exactly one valid --membership id. No remote or bulk migration path.
- Only non-admin Practitioner memberships in the authenticated admin's selected project are eligible; existing grants are never overwritten. Active roles must have valid Organization references; organization clinic identifiers and exactly one matching HealthcareService/providedBy are required. No-role/ambiguous/unresolved clinics fail closed. Already migrated dry-runs compare exact expected grants.
- Live policy name must be unique, unknown parameters cause refusal, and Task 100 create/update guards are required. Runtime before/after/profile/patient are not treated as membership parameters. Sorted deduplicated clinicWriteAccounts matches the merged helper, including dot escaping.
- Lock excludes concurrent applies. Private 0600 backup precedes write, If-Match pins the membership version, read-back verifies exact grants. Rollback is independent of live policy discovery, restores only original access/accessPolicy, and refuses grant drift.

## Evidence
Corrected disposable CLI regression passed before seeded migration: password logins, four-clinic direct reads/searches/writes for Patient/Encounter/Observation/ServiceRequest, multi-clinic union, forged foreign Patient create denial, exact backup/rollback and rollback drift rejection. Final gate adds no-active-role dry-run/apply refusal coverage. The known fake doctor was migrated only after private database backup and reviewed account-backfill apply. Full-gate result will be recorded in progress/STATE/CHANGELOG.

## Limits and follow-up
Production migration is a manual user step, not done. An unrelated fake membership without a clinic role is deliberately left for operator review, not assigned a guessed clinic. Twenty-three historical orphan Provenance records could not be attributed; they remain inaccessible to scoped staff. Other existing policy-bearing memberships are outside this additive migration's scope. Phase 3 defense in depth, shared device-key controls and the production project boundary remain separate work.

Prior failed fixture logs contained an expired local session token; six saved artifact files were redacted. Cleanup now uses client-credentials admin service calls and raw staff requests do not attach authorization headers to test assertions. The unavoidable earlier tool-output disclosure is recorded in progress; no credential was committed.

---

# Task 131 review (Dev / Grok Bot, 2026-11-14) — PR #232

Reviewer: Dev (took over 131 from Claude; a separate read-only Claude second review is written to `/workspace/ai-logs/claude-review-isolation-3.md`). Scope: `git diff origin/dev...ai/task-isolation-3` at 4ac167e, against OWASP A01, FHIR R4 and the installed Medplum SDK 5.1.13 / server 5.2.15 behaviour recorded in `.ai/research/`.

## Verdict: APPROVE (draft), conditional on the rollout order in the PR body.

## Findings
1. **MAJOR — fixed in this PR (D40).** The clinic staff AccessPolicy has no Device rule. With the fake demo doctor migrated, the single final gate showed `/api/poct/analysers`, `/api/pacs/devices` and the sign-time `requireOnlineAnalyser`/`requireOnlineXrayDevice` checks returning 403, so every policy-bearing staff member loses POCT and X-ray. This also affects staff who were already invited with the policy, so it is a latent production bug, not only a migration problem. Fix: Device lookups use the server directory client, are always filtered by `identifier=clinic|<clinicId from requireClinicAuth>` (plus `_id` for the online check), are re-checked by `deviceForClinic`, and return only a safe projection. The client cannot choose clinicId. deviceId can only match a Device carrying the caller's clinic identifier, and only admins/bridges write Devices. `poct.spec` "offline analyser" and the X-ray equivalent assert that a foreign-clinic Device is not listed: both pass. Evidence: `fix-poct-xray.log` 11/12, `fix-poct-r2.log` 1/1.
2. **MAJOR — rollout order (documented, not code).** Do not migrate any production membership before the D40 app change is deployed. Otherwise POCT/X-ray break for that user. This is step 1 of the PR's manual steps.
3. **MINOR — test fixtures.** Admin-created POCT ServiceRequests that carry their own `meta` do not inherit the Patient's account. Two fixtures now stamp `meta.accounts` explicitly. The app's own order path (D37 wrapper) is unaffected. No assertion was weakened, and the workflow `pick()` change is stricter (it now waits for and requires the match).
4. **MINOR — subscription test accepts `[200, 503]` with PACS-only.** 503 is the local "subscription transport unavailable" path. This is acceptable because the 403-when-both-modules-off assertions stay strict, but a future test should stub the transport and assert 200.
5. **MINOR — script operability.** `BACKUP_ROOT` is hard-coded to `/workspace/ai-logs/...`. A successful rollback leaves the backup file, so a later re-apply refuses until an operator archives it (fail-closed, but undocumented). A crash can leave `apply.lock` (fail-closed). The e2e spec leaves disposable-membership backup files locally. Suggest a `BACKUP_ROOT` env override and a note in the plan. None of these is a security problem.
6. **MINOR — grants are a point-in-time snapshot.** If a PractitionerRole is later deactivated outside the app's admin UI, the migrated access[] is not revoked automatically. The app's reassignment path (Phase 1) re-derives access. Direct FHIR role edits do not. Track this for Phase 3.
7. **NIT.** Dry-run does not check `membership.admin` on `auth/me` (it is read-only, and a non-admin gets 403 on ProjectMembership search anyway).

## Script safety checks (all OK)
Dry-run is the default. The base URL must be localhost:8113 (no credentials, path, query or hash), redirects are refused, and cross-origin pagination is refused. `--apply` requires exactly one valid `--membership`, and there is no bulk mode. Only non-admin Practitioner memberships in the admin's selected project are eligible. Existing grants are never overwritten. The script refuses: no active role, a non-Organization role reference, a missing clinic identifier, anything other than exactly one HealthcareService with a matching `providedBy`, unknown `%tokens`, and missing Task 100 create/update guards. Parameters match `withClinicMembershipAccess` exactly (clinicAccount, clinicOrganization, then sorted, deduplicated, dot-escaped anchored clinicWriteAccounts union; IDs are restricted to `[A-Za-z0-9.-]`, so no other regex metacharacters are possible). Writes are version-pinned with If-Match and read back. The 0600 backup is written before the write. Rollback is independent of the live policy and refuses on drift. No secrets are logged.

## Post-merge close-out of PR #231 (Task 101 stopped before a verdict)
- Cross-clinic create MAJOR: **closed on dev.** Policy `writeConstraint` and `readonlyFields: ['meta']` are on dev (`lib/fhir/clinic-access-policy.ts`). In the gate, `staff-membership.spec` confirms with a real migrated login that a foreign-clinic Encounter/Observation/ServiceRequest create returns 403, a forged foreign Patient create returns 403, and foreign update/delete returns 403/404. `clinic-isolation.spec` passes.
- Receive-account MAJOR: **closed on dev.** Extended/no-cache reads in lab-service, imaging-service, fhir-helpers and provenance-service are on dev. With the migrated doctor, HL7 and ASTM POCT results and X-ray studies show up on the Lab tab (they are only visible if the account propagated), and the receive spec passes.
- Verdict for #231: **APPROVE (post-merge)**. No further action is needed beyond D40 in this PR.

## Independent Claude second review (read-only, 2026-11-14 02:52 MYT)
Full text: `/workspace/ai-logs/claude-review-isolation-3.md`. Verdict **APPROVE (draft)**, no new MAJOR. MINORs:
- Add a clinicId allowlist where it is produced (`lib/server/clinic.ts`) as defense in depth. Today `deviceForClinic`'s exact-match recheck already blocks any widening.
- The PR body wrongly said `setup-access-policies.ts` refuses without guards. It is the migration script that refuses. PR body corrected.
- `BACKUP_ROOT` has no env override. PR body corrected; adding an override is a follow-up.
It also re-verified that the test changes do not weaken any assertion, that the parameters match exactly, and that clinicId cannot be set from the request.
