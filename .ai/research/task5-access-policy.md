# Task 5 — local staff directory leak (research only)

Date: 2026-10-31. No application code, policies, memberships, credentials, or local FHIR data changed. No authenticated probes or e2e flows were executed: login/audit and clinical e2e writes would violate this task's data-freeze instruction. Reproduction below is the user's verified observation, not a new measurement. Proposed JSON and script below are for a subsequent implementation task.

## Recommendation

Use **C: an explicit resource allowlist on each non-admin staff ProjectMembership**, with read-only Practitioner/PractitionerRole and hidden telecom fields. No wildcard, clinical account backfill, route migration, or Project setting change is needed for this narrow containment. Preserve the user-token clinical operations listed below. Start with doctor, verify, then apply to every non-admin staff membership; securing one doctor does not secure the others.

There is a material unresolved runtime discrepancy: upstream **v5.2.8 already rejects wildcard access to ProjectMembership/User for non-admins**, including the no-policy fallback. The reported ProjectMembership success therefore cannot be explained solely by missing accessPolicy on that upstream version. Confirm the running image/version, effective project and membership, superAdmin project status, and request authentication before calling any policy a verified fix. Do not dismiss the observed leak. The explicit allowlist avoids relying on wildcard exclusions, but deployment is conditional on actual local negative tests passing.

This is containment of the reported directory/email paths, **not complete clinic isolation**. Broad clinical grants retain the present direct-FHIR cross-clinic risk. A separately reviewed tenant policy migration remains necessary for that broader objective.

## Sources and version caveat

Read official docs and the following GitHub files with `?ref=v5.2.8` through the read-only GitHub connector (shell network DNS was unavailable). Links pin the release rather than moving `main`:

- [v5.2.8 core access matching](https://github.com/medplum/medplum/blob/v5.2.8/packages/core/src/access.ts): `protectedResourceTypes`, `projectAdminResourceTypes`, `shallowMatchesResourcePolicy`, `satisfiedAccessPolicy`.
- [v5.2.8 policy assembly](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/fhir/accesspolicy.ts): `buildAccessPolicy`, parameter substitution, admin policy transformation, default reconciliation.
- [v5.2.8 repository](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/fhir/repo.ts): `supportsInteraction`, `canPerformInteraction`, `removeHiddenFields`, `restoreReadonlyFields`.
- [v5.2.8 policy integration tests](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/fhir/accesspolicy.test.ts): wildcard restrictions, non-admin policy reads, hidden fields, admin behavior.
- [v5.2.8 invite implementation](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/admin/invite.ts): profile-specific defaults used when inviting.
- [Official access policy guide](https://www.medplum.com/docs/access/access-policies), [release-pinned guide](https://github.com/medplum/medplum/blob/v5.2.8/packages/docs/docs/access/access-policies.md), [project settings](https://www.medplum.com/docs/access/projects), [multi-tenant guide](https://www.medplum.com/docs/access/multi-tenant-access-policy), [$set-accounts](https://www.medplum.com/docs/api/fhir/operations/set-accounts).
- [FHIR R4 Practitioner](https://hl7.org/fhir/R4/practitioner.html) defines telecom as contact details and PractitionerRole as organizational role information. [FHIR R4 compartments](https://hl7.org/fhir/R4/compartmentdefinition-patient.html) do not by themselves implement UCC clinics.

Local evidence: `/workspace/ucc-medplum/docker-compose.yml:12` specifies `medplum/medplum-server:latest`, not a pinned 5.2.8 image. Docker socket inspection was denied by the sandbox. The seed tooling's installed `@medplum/core` reports 5.1.13; that is a client dependency, not proof of server version. AGENTS.md's 5.2.8 is an intended version, not runtime attestation. No Docker configuration/environment dump was used.

## What the policy engine actually does

1. Policies are grants; an unlisted resource type has no grant. There is no general negative/deny rule that overrides other grants. `readonly:true` still grants read/search/history/vread; it does not hide a resource. `interaction:[]` grants nothing, but another matching grant can still permit access.
2. `*` is supported for ordinary resources. In v5.2.8 its matcher explicitly excludes project-admin types: **AccessPolicy, Cron, Package, PackageRelease, PackageInstallation, Project, ProjectMembership, User, UserSecurityRequest**. Thus omission with a wildcard denies these special types, but does not deny arbitrary ordinary types. A wildcard plus an omitted Practitioner still permits Practitioner.
3. Protected types are **DomainConfiguration, Enterprise, JsonWebKey, Login**. Repository rejects them for non-superadmins independently of the policy.
4. Membership without `accessPolicy` and without nonempty `access` gets a legacy wildcard grant during policy assembly. Non-admin transformation removes explicit project-admin grants, then preserves AccessPolicy reads derived from policy/wildcard rules. Project.superAdmin changes behavior and must be checked; membership.admin is not the only relevant flag.
5. For matching resource and interaction, the first satisfied rule supplies hidden/readonly fields. Rules are not a stack of denials. Put specialized Practitioner rules before any wildcard. A read-only specialized rule plus a later writable wildcard can still permit writes through the wildcard: omit the wildcard if those writes must be denied.
6. `hiddenFields:["telecom"]` removes the whole top-level telecom field, including phones, rather than selecting email entries. The repository also restores hidden fields from the prior resource on updates; masking is not a substitute for preventing staff-directory writes. Add `text` to avoid a generated narrative repeating telecom. Hidden fields do not establish row isolation or prevent email search/count inference. Verify history, includes and alternate APIs too.
7. `%profile` and `%profile.id` are built in. Custom variables use `ProjectMembership.access[].parameter` with valueReference/valueString. Multiple policies/access entries are combined grants; adding a narrow policy alongside an old broad grant does not narrow access. Replace the effective grant set, retaining an exact rollback snapshot.
8. Assign a concrete `ProjectMembership.accessPolicy.reference` for the nonparameterized proposal. Parameterized per-clinic policies use `access[].policy` and clinic parameters. **Project.defaultAccessPolicy (singular) is not the mechanism.** v5.2.8 uses `Project.defaultAccessPolicies[]` keyed by profileType during invitations, plus legacy `defaultPatientAccessPolicy`. Merely changing invitation defaults does not remediate existing no-policy memberships. Login reconciliation handles recognized Admin/Practitioner default swaps, not an arbitrary migration of all missing policies.
9. `meta.accounts` is Medplum metadata, not the app's `identifier:clinic|slug`. Tenant rules use `_compartment=HealthcareService/<id>` (or the chosen tenant resource) backed by accounts. Automatic Patient compartment membership is not clinic authorization. Backfill must cover existing resources, future writes, shared resources and multi-clinic staff. The old guide contains singular `meta.account` examples; do not copy those instead of the modern accounts API. Top-level AccessPolicy.compartment is legacy; explicit per-resource criteria are preferable.

## Reproduction and discrepancy investigation (no secrets)

Supplied verified baseline: local `http://localhost:8113`, signed-in `doctor@ucc.local`, non-admin clinic staff membership without accessPolicy; `GET /fhir/R4/ProjectMembership` and `GET /fhir/R4/Practitioner` return other clinics' staff/email information. Record this as an authorization failure even if the UI hides those endpoints.

For a later reproduction, use the same doctor bearer token **in memory**, never a token literal in shell history, URL, screenshot, stdout or committed file. Make read-only requests directly to :8113, not the Next proxy/admin client. Check `auth/me` in memory for active project, membership.admin, profile, accessPolicy, access entries and project.superAdmin; emit only boolean assertions. Compare to the intended doctor's project membership. Check the running server's installed version/image digest with an authorized local operator; Compose `latest` is insufficient. Look for impersonation/on-behalf-of/client credentials or an unexpected project, without printing headers or JWTs.

Repeat the two GETs and emit only HTTP status and boolean `containsOtherStaffEmail`/resource counts. Do not print response bodies or actual other staff addresses. Upstream v5.2.8 should already deny ProjectMembership with that effective non-admin context; if it does not, keep the finding open and investigate the actual server build/auth context. Do not claim that adding a wildcard policy has fixed this discrepancy.

## App access traced in this checkout

`lib/server/medplum-auth.ts:getMedplumForRequest` installs the request bearer/session token. `requireClinicAuth` returns that client after `auth/me`, Organization identifier lookup and PractitionerRole assignment checks. `requireClinicPageAuth` has the same directory dependencies. Local auth-disabled mode returns an admin client and must be OFF for all authorization verification.

| User-token path | FHIR resources / operations that must remain available |
| --- | --- |
| Login, clinic layout and every clinic API guard | Organization read/search; PractitionerRole read/search; own profile/auth/me |
| `/api/practitioners` → `lib/fhir/admin-service.ts:getPractitionersFromMedplum(medplum)` | Practitioner, PractitionerRole, Organization search. It currently searches project-wide and maps Practitioner.telecom to email. No ProjectMembership lookup here. |
| `/api/patients` writes/details and shared patient service with supplied client | Patient read/search/create/update/delete; AllergyIntolerance, Condition, MedicationStatement read/search/create; Encounter read/search. List and some helpers use admin fallback, so route auth alone does not identify the actual FHIR principal. |
| `/api/consultations`, `/api/orders`, billable orders → consultation service | Patient, Encounter, Observation, Condition, Procedure, MedicationRequest read/search/write; Provenance create through provenance helper |
| `/api/triage`, queue/check-in | Encounter and Observation read/search/write; Patient lookups; Provenance create |
| `/api/appointments`, `/api/scheduling/*` | Appointment, Schedule, Slot read/search/write; Patient and Practitioner reads; Organization/clinic context |
| `/api/billing`, `/api/tasks`, `/api/tasks/[id]` | Invoice and Task read/search/write; supporting patient/encounter reads |
| `/api/referrals`, `/api/documents` | ServiceRequest and DocumentReference read/search/write; supporting Patient/Encounter reads. File storage remains Firebase. |
| `/api/diagnoses` | ChargeItemDefinition search through catalog service with supplied user client |
| Shared lab/imaging helpers when passed a user client | ServiceRequest, Observation, DiagnosticReport, ImagingStudy read/search/write. Receive/admin fallback paths also exist; this research does not change them. |

Evidence files: `app/api/{patients,consultations,orders,triage,queue,check-in,appointments,billing,referrals,documents,diagnoses,practitioners}/route.ts`, `app/api/scheduling/*/route.ts`, `lib/fhir/{patient,consultation,triage,appointment,scheduling,billing,billing-task,referral,document,catalog,lab,imaging,provenance}-service.ts`, `lib/fhir/clinic-tenancy.ts`. This is a static call-chain inventory, not measured execution coverage.

Admin-client paths remain: catalogs, document-templates, inventory, procedures, purchases, suppliers, settings/follow-up, settings/insurers, follow-up and process-due; organization/admin services; export-to-medplum; intake questionnaire persistence; consultation-plan persistence through its helpers; several optional-client fallbacks. `lib/server/medplum-admin.ts` uses process client credentials. A doctor's policy does not constrain these clients. `/api/admin/users` uses admin credentials after its admin guard; admin invitation uses the requesting admin client. Keep both administrator and service-client policies untouched.

## Options

| Option | Result / cost |
| --- | --- |
| A: `*` plus omitted ProjectMembership/User and Practitioner mask before wildcard | Valid for upstream special-type omission; tiny and preserves ordinary resource access. It cannot explain/remediate a runtime already violating those exclusions, permits all other ordinary types, and a later wildcard can allow Practitioner writes. Not the conservative choice for this local mismatch. |
| B: port `98038d3` in full | 16 files, 1497 insertions/83 deletions; 1328-line policy, account-write wrapper, route migrations and backfill. Much larger clinical regression surface. Crucially its Practitioner grant is project-wide read/search/history/vread **without hiddenFields**, so it does not by itself close the staff telecom leak. |
| C: explicit compatibility allowlist, masked read-only staff directory | Recommended narrow containment. Denies administrative/identity types by omission without relying on wildcard matching. Requires per-membership assignment and regression verification; retains broad clinical access pending tenant migration. |

B also needs repairs/review before reuse: backfill only fetches up to 1000 resources per query, catches search errors and continues, may retain wrong extra accounts, and its `%after.meta.accounts.all(...)` constraint accepts an empty collection (vacuous truth). Require existence as well as allowed accounts. Its script has no localhost refusal. Review existing tenant helpers before duplicating stamping logic. Do not run or blindly cherry-pick it for Task 5.

## Exact proposed policy JSON

Save as `scripts/access-policy/ucc-local-staff-containment.json` in a later implementation task. This deliberately preserves clinical writes and some compatibility types; it is not a least-privilege role model. The directory names/IDs remain available for appointments and attribution; email/phone/narrative fields are masked.

```json
{
  "resourceType": "AccessPolicy",
  "name": "UCC Local Staff Containment v1",
  "resource": [
    { "resourceType": "Practitioner", "readonly": true, "hiddenFields": ["telecom", "text"] },
    { "resourceType": "PractitionerRole", "readonly": true, "hiddenFields": ["telecom", "text"] },
    { "resourceType": "Organization", "readonly": true },
    { "resourceType": "HealthcareService", "readonly": true },
    { "resourceType": "Location", "readonly": true },
    { "resourceType": "Patient" },
    { "resourceType": "Encounter" },
    { "resourceType": "Observation" },
    { "resourceType": "Condition" },
    { "resourceType": "AllergyIntolerance" },
    { "resourceType": "MedicationStatement" },
    { "resourceType": "MedicationRequest" },
    { "resourceType": "Medication", "readonly": true },
    { "resourceType": "Procedure" },
    { "resourceType": "ServiceRequest" },
    { "resourceType": "DiagnosticReport" },
    { "resourceType": "ImagingStudy" },
    { "resourceType": "Appointment" },
    { "resourceType": "Schedule" },
    { "resourceType": "Slot" },
    { "resourceType": "Invoice" },
    { "resourceType": "Task" },
    { "resourceType": "DocumentReference" },
    { "resourceType": "Provenance", "interaction": ["create", "read", "search"] },
    { "resourceType": "AuditEvent", "interaction": ["create"] },
    { "resourceType": "ChargeItemDefinition", "readonly": true },
    { "resourceType": "Basic", "readonly": true },
    { "resourceType": "Communication" },
    { "resourceType": "Questionnaire", "readonly": true },
    { "resourceType": "QuestionnaireResponse" },
    { "resourceType": "StructureDefinition", "readonly": true },
    { "resourceType": "SearchParameter", "readonly": true },
    { "resourceType": "ValueSet", "readonly": true },
    { "resourceType": "CodeSystem", "readonly": true }
  ]
}
```

No ProjectMembership, User, Project, AccessPolicy, ClientApplication, Bot, Subscription, Login or wildcard grant. Binary is intentionally omitted because app documents use Firebase; if a real e2e flow needs Medplum Binary, review securityContext rather than blindly adding a grant. Staff identifiers/extensions/reference display values can also contain emails in arbitrary data: verify the fake fixtures and response scans, and add targeted masks or sanitize the directory model if those copies exist. This JSON addresses the known standard telecom paths; it is not a guarantee that arbitrary free text never contains an address.

## Proposed local apply script (not created or executed)

Save this as `scripts/access-policy/apply-local-staff-containment.mjs` alongside the JSON. Use explicit membership and project IDs resolved by an administrator, not an email search returning many identities. The operator supplies a local admin bearer token via a secret loader/environment, never a command-line literal. Dry-run is the default. Localhost is checked before credentials or network access; redirects are rejected. No Next server is needed.

```js
import fs from 'node:fs';
import path from 'node:path';
const base = new URL(process.env.MEDPLUM_BASE_URL || 'http://localhost:8113');
if (!['http:', 'https:'].includes(base.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
    base.port !== '8113' || base.username || base.password ||
    base.pathname !== '/' || base.search || base.hash) {
  throw new Error('Only localhost Medplum on port 8113 is allowed');
}
const projectId = process.env.TASK5_PROJECT_ID;
const memberId = process.env.TASK5_MEMBERSHIP_ID;
const validId = x => typeof x === 'string' && /^[A-Za-z0-9.-]{1,64}$/.test(x);
if (!validId(projectId) || !validId(memberId)) throw new Error('Explicit IDs required');
const token = process.env.TASK5_LOCAL_ADMIN_TOKEN;
if (!token) throw new Error('Admin credential required');
const apply = process.argv.includes('--apply');
const desired = JSON.parse(fs.readFileSync(new URL('./ucc-local-staff-containment.json', import.meta.url)));
async function request(relative, method = 'GET', body, extra = {}) {
  const res = await fetch(new URL(relative, base), {
    method, redirect: 'error',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/fhir+json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`FHIR request failed (${res.status})`);
  return res.json(); // Never log returned resources/errors containing bodies.
}
try {
  const me = await request('auth/me');
  if (!me.membership?.admin || me.project?.id !== projectId || me.project?.superAdmin)
    throw new Error('Expected local project admin in a non-superadmin project');
  const member = await request(`fhir/R4/ProjectMembership/${memberId}`);
  if (member.admin || member.project?.reference !== `Project/${projectId}` ||
      !member.profile?.reference?.startsWith('Practitioner/'))
    throw new Error('Expected non-admin staff membership in selected project');
  const backupFile = path.resolve('e2e/.secrets', `task5-${projectId}-${memberId}.json`);
  // Avoid weakening an existing tenant/custom policy: review it separately.
  if (!fs.existsSync(backupFile) && (member.accessPolicy || member.access?.length))
    throw new Error('Existing access grants require separate review');
  if (!apply) { console.log('Dry-run: eligible local membership; no writes'); process.exit(0); }
  fs.mkdirSync(path.dirname(backupFile), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(backupFile)) {
    fs.writeFileSync(backupFile, JSON.stringify({
      projectId, memberId, accessPolicy: member.accessPolicy ?? null,
      access: member.access ?? null
    }), { flag: 'wx', mode: 0o600 });
  }
  const query = new URLSearchParams({ name: desired.name, _count: '2' });
  const found = await request(`fhir/R4/AccessPolicy?${query}`);
  const matches = (found.entry || []).map(x => x.resource)
    .filter(x => x?.resourceType === 'AccessPolicy');
  if (found.link?.some(x => x.relation === 'next') || matches.length > 1)
    throw new Error('Ambiguous policy name');
  let policy = matches[0];
  if (!policy) policy = await request('fhir/R4/AccessPolicy', 'POST', desired,
    { 'If-None-Exist': query.toString() });
  if (policy.resourceType !== 'AccessPolicy' || !validId(policy.id) ||
      policy.name !== desired.name || JSON.stringify(policy.resource) !== JSON.stringify(desired.resource))
    throw new Error('Existing policy differs; use a new reviewed policy version');
  const reference = `AccessPolicy/${policy.id}`;
  if (member.accessPolicy?.reference === reference && !member.access?.length) {
    console.log('Already applied'); process.exit(0);
  }
  if (member.accessPolicy || member.access?.length) throw new Error('Membership grants changed; stop');
  const next = { ...member, accessPolicy: { reference } };
  delete next.access;
  if (!member.meta?.versionId) throw new Error('Membership version required');
  await request(`fhir/R4/ProjectMembership/${memberId}`, 'PUT', next,
    { 'If-Match': `W/"${member.meta.versionId}"` });
  console.log('Applied local staff containment');
} catch {
  console.error('Stopped; inspect locally without printing credentials or response bodies');
  process.exitCode = 1;
}
```

Execution in the later task: set `MEDPLUM_BASE_URL=http://localhost:8113`, IDs and `TASK5_LOCAL_ADMIN_TOKEN` using the existing secret-loading mechanism, then `NODE_OPTIONS=--max-old-space-size=3072 node scripts/access-policy/apply-local-staff-containment.mjs` (dry-run); repeat with `--apply`. No credential values in command examples. Verify `e2e/.secrets/` is ignored before use. The script only assigns memberships with no preexisting grants; already-scoped users require reviewed migration. Re-run sequentially per eligible staff membership. Do not change Project defaults as part of the immediate experiment. Follow up on the existing invite path in `lib/fhir/admin-service.ts`, which looks up a differently named clinic policy and preserves other access entries: future staff must not silently bypass containment.

The script is a reviewable proposal, not runtime-tested code. Conditional create plus exact policy comparison makes reruns idempotent and refuses drift. A partial failure may leave an unused policy; membership assignment is version checked. Failure output intentionally omits server bodies and error objects. Keep the original backup across reruns; never overwrite it with the post-change state.

## Verification plan and acceptance criteria

1. Before applying, record runtime build/version and the effective doctor auth context booleans. Record existing e2e baseline without running writes during this research turn. Preserve a working admin session and original membership grant fields.
2. After applying in the authorized implementation task, sign doctor out/in to avoid stale session state. Ensure auth-disabled mode is off. Use the actual doctor token, never the admin client token, for every negative FHIR test. Verify both an existing session and a fresh session after policy changes; do not assume cache invalidation timing.
3. Doctor ProjectMembership and User searches return denial (normally 403); no entries or identities may be returned. Test known-ID reads, `_history`, vread, `_include`, `_revinclude`, batch/transaction and GraphQL if enabled. A 200 empty Bundle is not proof that type access was denied; investigate the differing behavior. Confirm Project, AccessPolicy, ClientApplication and Bot are inaccessible too.
4. Practitioner/PractitionerRole searches and known-ID reads still return allowed names/IDs, with no telecom or narrative and no other staff email anywhere in serialized responses. Check history/vread and included resources. Test email search/count probing as a separate residual privacy issue. Check own profile/auth/me: own identity email may be expected, other staff identities must not be present. Test `/api/practitioners` explicitly because it currently has no clinic filter.
5. Test forbidden staff-directory mutations using fake resources in a disposable test context: readonly must deny create/update/delete, not merely mask reads. Confirm admin user management and invitation still work with the separate admin identity.
6. Run login/clinic shell, patient search/create/edit, check-in/triage, consultation composer (add, persist, reload, sign), diagnosis lookup, prescriptions/procedures, appointment scheduling, referrals/documents/Firebase download, billing/task completion, Lab results and online-only POCT order flows with fake data. Validate saved resources via the same doctor client. No manual result entry or composer critical-result warnings introduced.
7. Run `NODE_OPTIONS=--max-old-space-size=3072 e2e/scripts/check-all.sh task5-access-policy` only after write authorization, with one Next dev server on :3210 and Medplum :8113, and compare against the current baseline. This script writes logs outside this sandbox's writable roots and e2e changes data; it was deliberately **not run** for research. No claim of a passing gate or proven no-breakage is made here.

## Risks and rollback

- Exact preservation of every optional app workflow is unproven until the regression gate and direct-FHIR tests pass. A missing allowlisted type will fail closed; add only the demonstrated necessary operation. Shared metadata/ref displays and clinical free text may still contain emails. hiddenFields alone does not prevent search inference or guarantee all alternate endpoints mask fields.
- Directory masking removes phone as well as email; auth/me's own email display may change depending on the endpoint's profile loading. Staff names remain project-wide because booking relies on them. Clinic-only directory visibility needs explicit resource scoping/data changes and should be a separate change.
- Broad clinical writes and admin service clients remain. This containment must not be represented as fulfilling the clinic-isolation rule for direct Medplum access. No clinical identifiers/accounts are modified here.
- For rollback, use the same strictly localhost-only admin transport, read the current membership, verify project/admin/profile and current containment policy reference, and PUT it with If-Match using the original `accessPolicy` and `access` fields from the private backup (delete fields whose backup value is null). Preserve every unrelated current membership field. Refuse rollback if someone has since changed the grant set. Reauthenticate doctor and verify restoration. Restoring the original no-policy state also restores the original risk; use only to recover the local experiment.
- Remove the containment AccessPolicy only after an administrator verifies no memberships/access arrays/defaults reference it; leaving an unreferenced policy is safer than deleting a shared one. No backfill means no patient/account rollback is needed. Never restore entire stale membership objects or overwrite unrelated user changes.

Research result: a small explicit membership policy is the appropriate next experiment; full `98038d3` is too broad and still exposes Practitioner telecom. The local ProjectMembership/source contradiction is unresolved and is an explicit deployment verification requirement.

## Discrepancy resolved (Dev, 12:25 MYT)
`GET /auth/me` with the doctor token: membership.admin = none, accessPolicy = none, **project.superAdmin = true**; server version 5.2.9-fa6bada.
So locally UCC runs inside the Medplum *Super Admin* project, which is why the v5.2.8 projectAdminResourceTypes guard does not apply. The leak is real locally; whether production's project is superAdmin must be checked by the user (Hostinger boundary – not touched).
Implication: the allowlist policy must be verified to restrict a non-admin member even inside a superAdmin project (negative tests after applying).

## Build results

2026-10-31, Builder Task 5. **Option C was implemented and tested only on doctor@ucc.local, failed the required administrative-directory containment in the local superAdmin project, and was rolled back. This is not a verified security fix. The original local leak remains.**

Implemented files:

- `scripts/access-policy/ucc-local-staff-containment.json`: exact compatibility allowlist proposed above, including read-only Practitioner/PractitionerRole with telecom/text hidden. The unused AuditEvent-create compatibility grant is retained; it does not enable the application's admin-client audit path.
- `scripts/access-policy/apply-local-staff-policy.mjs`: accepts the local superAdmin project while requiring an administrator membership in the selected project; only loopback port 8113, rejects redirects/nonlocal pagination, request timeouts, explicit project/member IDs, dry-run default, `--apply` for writes, optimistic `If-Match`, refuses preexisting grants/drift. `--rollback` previews restoration; **`--rollback --apply` restores the original grant fields**, preserving all unrelated current membership fields. Repeated apply/rollback are idempotent. The script serializes mutating runs with a private exclusive lock; if interrupted, inspect the saved membership before removing a stale `apply.lock`.
- Each original full membership snapshot is written once, before its membership update, to `/workspace/ai-logs/task5/backup/<projectId>-<memberId>.json`, with file mode 0600 and directory mode 0700. Backups are outside the repository and never printed. The original snapshot remains available after rollback.

### Critique resolutions and source verification

The old proposal's rejection of `project.superAdmin` was removed. The experiment explicitly asserted doctor identity, `membership.admin=false` and `project.superAdmin=true` through the existing doctor's `/auth/me` response. The selected membership came from that response, rather than an ambiguous email directory search. The already confirmed server version is `5.2.9-fa6bada` (Dev's discrepancy finding above).

Read and compared official Medplum source at `v5.2.8`, `v5.2.9`, and the runtime commit `fa6bada`. Copies are outside the repo under `/workspace/ai-logs/task5/source/`. Core `access.ts` is identical between v5.2.8 and fa6bada; repository/policy assembly have changes, but the critical superAdmin grant injection is still present. In [`applyProjectAdminAccessPolicy` at fa6bada](https://github.com/medplum/medplum/blob/fa6bada/packages/server/src/fhir/accesspolicy.ts#L375), a superAdmin project causes every omitted `projectAdminResourceTypes` entry to be appended as a grant, before the alternative branch testing membership.admin. This is why omitting these types cannot deny them here. [`getRepoForLogin`](https://github.com/medplum/medplum/blob/fa6bada/packages/server/src/fhir/accesspolicy.ts#L87) also sets repository superAdmin from the project. [`supportsInteraction` / `canPerformInteraction`](https://github.com/medplum/medplum/blob/fa6bada/packages/server/src/fhir/repo.ts#L2322) still consult the assembled policy: ordinary resource masking/omission can work while injected administrative grants remain accessible. This is more precise than saying every policy restriction is bypassed.

Additional source links: [v5.2.9 policy assembly](https://github.com/medplum/medplum/blob/v5.2.9/packages/server/src/fhir/accesspolicy.ts), [runtime core matcher](https://github.com/medplum/medplum/blob/fa6bada/packages/core/src/access.ts), [official access policy guide](https://www.medplum.com/docs/access/access-policies). This scoped scripts/policy change does not use Next.js or React APIs.

Policy deduplication no longer depends on `AccessPolicy?name=` being supported: the script searches AccessPolicy without a name predicate, follows all pages, and compares exact names locally. It refuses duplicate names or policy drift, checks the complete rule array, and uses the same saved policy ID on reruns. The actual second apply reported `Already applied` and left a single containment policy. This proves the chosen alternate deduplication path for the local run; name-search support itself was not asserted. The local lock serializes this script's own writers; unrelated administrative writers must not create competing same-name policies during execution.

### Execution and direct-FHIR results

Admin credentials were loaded from `e2e/lib/env.ts`'s `MEDPLUM_ADMIN` in an outside-repository harness and supplied through environment variables. The harness authenticated directly to localhost with S256 PKCE and passed the resulting admin token only in process memory/environment (`TASK5_LOCAL_ADMIN_TOKEN`) to reuse the session across script invocations. The script also supports `MEDPLUM_ADMIN_EMAIL` / `MEDPLUM_ADMIN_PASSWORD` directly through its own S256 PKCE login. Credential-handling correction: the initial source inspection displayed the hardcoded local credential defaults in `e2e/lib/env.ts` in tool output; this should have been redacted. Subsequent authentication/probe tooling withheld credential values and tokens, and no tokens were printed or written to evidence files. An initial SDK approach failed on Node 20's missing browser WebSocket; the delivered script uses native fetch/crypto and has no SDK/browser dependency. Initial authentication retries changed no memberships.

All authorization probes below used **the doctor's existing `medplum-session` cookie token read from `e2e/.secrets/state.json`**, directly against `http://localhost:8113/fhir/R4/`, never the admin client. Only statuses, counts and field-presence booleans were emitted. Searches used `_count=100`; counts below are returned-page entries, not inferred totals. No clinical writes were performed.

| Doctor request | Before | After policy assignment | After rollback |
| --- | --- | --- | --- |
| ProjectMembership search | 200, 7 entries | **200, 7 entries — FAIL** | 200, 7 entries |
| User search | 200, 6 entries | **200, 6 entries — FAIL** | 200, 6 entries |
| Project search | 200, 2 entries | **200, 2 entries — FAIL** | 200, 2 entries |
| AccessPolicy search | 200, 1 entry | **200, 2 entries — FAIL** | 200, 2 entries |
| ClientApplication search | 200, 1 entry | 403 | 200, 1 entry |
| Bot search | 200, 0 entries | 403 | 200, 0 entries |
| Practitioner search | 200, 6 entries; telecom present | 200, 6 entries; telecom/text absent | 200, 6 entries; telecom present |
| PractitionerRole search | 200, 5 entries; telecom/text absent | 200, 5 entries; telecom/text absent | 200, 5 entries |
| Patient search | 200, 87 entries | 200, 87 entries | 200, 87 entries |
| Encounter search | 200, 90 entries | 200, 90 entries | 200, 90 entries |
| Organization search | 200, 4 entries | 200, 4 entries | 200, 4 entries |
| Observation search | 200, 100 entries | 200, 100 entries | 200, 100 entries |
| Appointment search | 200, 0 entries | 200, 0 entries | 200, 0 entries |
| ServiceRequest search | 200, 61 entries | 200, 61 entries | 200, 61 entries |
| MedicationRequest search | 200, 25 entries | 200, 25 entries | 200, 25 entries |
| ChargeItemDefinition search | 200, 30 entries | 200, 30 entries | 200, 30 entries |

The admin read-back confirmed policy assignment and absence of other grants before the negative tests. Masking and denial of ClientApplication/Bot demonstrate that the existing doctor session picked up the policy; failure was not merely a completely stale session. No fresh doctor login or wider history/includes/mutation/UI testing was pursued after the decisive negative-test failure; source at the runtime commit independently explains the injected grants. Positive results establish read/search compatibility only, not composer/write-workflow regression coverage.

Rollback preview reported eligible/no writes; rollback with `--apply` restored the original grant fields. A repeated rollback returned `Already restored`. A final independent read-back compared accessPolicy/access to the original private snapshot and returned `finalGrantsRestored=true`; backup file and directory permissions verified 600/700. No other staff membership, project defaults, project superAdmin flag, clinical resources, or client credentials were changed. The now-unused containment policy remains in Medplum; it was not deleted, to avoid an unnecessary shared-resource deletion.

### Review commands and limits

Set `TASK5_PROJECT_ID` and `TASK5_MEMBERSHIP_ID` explicitly and load `MEDPLUM_ADMIN_EMAIL` / `MEDPLUM_ADMIN_PASSWORD` from the existing secret-loading environment (or reuse an administrator token via `TASK5_LOCAL_ADMIN_TOKEN`). Never paste secrets into shell arguments/history. Commands:

```sh
NODE_OPTIONS=--max-old-space-size=3072 node scripts/access-policy/apply-local-staff-policy.mjs
NODE_OPTIONS=--max-old-space-size=3072 node scripts/access-policy/apply-local-staff-policy.mjs --apply
NODE_OPTIONS=--max-old-space-size=3072 node scripts/access-policy/apply-local-staff-policy.mjs --rollback
NODE_OPTIONS=--max-old-space-size=3072 node scripts/access-policy/apply-local-staff-policy.mjs --rollback --apply
```

Do not deploy this as a successful containment or broaden assignment: the doctor has already been restored. Resolving the superAdmin project topology or changing the server's injected-grant behavior requires separate review. Broad clinical clinic isolation remains outside this experiment.

Validation: Node syntax check passed; a nonlocal URL was rejected before credential access/network; actual dry-run, apply, repeat-apply, rollback preview, rollback, repeat-rollback and final restored-state dry-run passed. **No full e2e suite or check-all gate was run**, per the Builder instruction; Dev owns that gate. This Builder made no `app/` or `lib/` edits, no commit, and no remote operations. Concurrent edits to `lib/fhir/admin-service.ts` and `e2e/tests/admin.spec.ts` appeared during execution and were left untouched.

## Non-superAdmin retest

Task 5b, 2026-10-31. New script `scripts/access-policy/test-nonsuperadmin-containment.mjs` (localhost:8113 only, never logs tokens/passwords/bodies, fake `@example.invalid` data only, no `app/`/`lib/` edits, not committed). It creates/reuses a disposable non-superAdmin Project (`UCC Task5 NonSuperAdmin Test`, verified `superAdmin` falsy), invites a project admin plus two fake clinic Practitioners (doctorA with the existing `ucc-local-staff-containment.json` policy, staffB with no policy) plus a PractitionerRole per fixture (carrying its own telecom), creates two fake Organizations (`clinic|task5-a`, `clinic|task5-b`), then runs the doctorA negative tests directly against `:8113`, plus a no-policy control (temporarily stripped from the membership via the superAdmin token, then restored under `try`/`finally` and reverified). Evidence (status/count/boolean only) written to `/workspace/ai-logs/task5b/evidence.txt` (outside the repo). An exclusive `test.lock` file in that directory serializes reruns; by default the three fake identities (project admin, doctorA, staffB) are deleted at the end of every run (`--keep` retains them for inspection), and a User is only deleted once no `ProjectMembership` anywhere still references it, so a shared identity is never collaterally removed. The script exits non-zero if any assertion fails.

### Codex security review (CHANGES) and fixes

An independent Codex review of the first version (`/workspace/ai-logs/task5b/codex-rev.out`) returned **CHANGES** with five MAJOR findings, all addressed except the explicitly out-of-scope one:

1. *"Failed assertions still exit successfully."* Fixed: the script now exits 1 if any assertion's `pass !== true`.
2. *"Assertions can pass without proving the expected context or data... search checks accept malformed 200 responses... inspect only the first page... never require the known staff fixture to appear."* Fixed: a new `collectPages` helper validates every page is a well-formed `Bundle` and follows `link rel=next` (capped, cycle-guarded) before any assertion runs; a new `assertDoctorAuthContext` check enforces `auth/me` status 200, `project.id` equals the test project, `project.superAdmin !== true`, `membership.admin !== true`, **and** independently re-reads the `ProjectMembership` resource via the superAdmin token to confirm `accessPolicy.reference` matches the created policy (not the ambiguous `auth/me.accessPolicy` field used in the prior diagnostic line); the Practitioner/PractitionerRole directory assertions now require the staffB fixture to actually appear in results before passing.
3. *"PractitionerRole is never created or tested... no direct-read field assertion, narrative check, `_include`/`_revinclude`, history/vread or `_elements` probes."* Fixed: added a PractitionerRole fixture per Practitioner (with its own `telecom`), plus direct-read, `_elements=telecom`, `_history`, and `PractitionerRole?_include=PractitionerRole:practitioner` masking assertions, and POST/PUT/PATCH/DELETE-denied coverage for both Practitioner and PractitionerRole.
4. *"Cleanup... deletes global `User` resources based on matching fake email without checking other memberships, and ignores DELETE statuses... lacks `try/finally`... no final teardown."* Fixed: `deleteOwnedIdentity` checks every DELETE status (`fail()`s on anything other than 200/204/404) and only deletes a `User` after confirming (via `ProjectMembership?user=`) it has no remaining memberships anywhere; the control strip/restore is now wrapped in `try/finally` so a thrown assertion still restores the policy; a final teardown (skippable with `--keep`) removes all three fake identities at the end of every run.
5. *"Reruns are not concurrency-safe."* (MINOR) Fixed: an exclusive `test.lock` file (`wx` flag) now serializes runs, mirroring `apply-local-staff-policy.mjs`'s existing lock pattern.

**Left out of scope, by instruction:** *"Cross-clinic containment is absent... no cross-clinic requests are tested."* Confirmed and intentionally not fixed here — this script only exercises staff-directory containment (ProjectMembership/User/Project/AccessPolicy denial, Practitioner/PractitionerRole telecom masking). `ucc-local-staff-containment.json` grants Patient/Encounter/Observation/etc. project-wide with no clinic criteria, so cross-clinic clinical-data isolation remains a materially larger, separately-reviewed follow-up (consistent with the "Risks and rollback" section above: "Broad clinical clinic isolation remains outside this experiment"). The MINOR "no server-version assertion" finding was also not addressed (not requested).

### Result (hardened script, 23 assertions)

All 23 assertions passed; script exit code 0; teardown of all three fake identities succeeded (membership/practitioner/user all deleted, status 200 each):

| Assertion | Status | Count | PASS/FAIL |
| --- | --- | --- | --- |
| doctorA auth context + policy assigned (verified via superAdmin read) | 200 | - | PASS |
| ProjectMembership denied/no-others (with policy) | 403 | 0 | PASS |
| User denied/no-others (with policy) | 403 | 0 | PASS |
| Project denied/no-others (with policy) | 403 | 0 | PASS |
| Practitioner directory masked + staffB fixture present (with policy) | 200 | 0 | PASS |
| PractitionerRole directory masked + staffB fixture present (with policy) | 200 | 0 | PASS |
| Practitioner/staffB direct read telecom+text absent | 200 | 0 | PASS |
| Practitioner/staffB _elements=telecom absent | 200 | 0 | PASS |
| Practitioner/staffB _history telecom absent | 200 | 0 | PASS |
| PractitionerRole?_include=PractitionerRole:practitioner telecom absent | 200 | 0 | PASS |
| POST Practitioner denied | 403 | 0 | PASS |
| PUT Practitioner/staffB denied | 403 | 0 | PASS |
| PATCH Practitioner/staffB denied | 403 | 0 | PASS |
| DELETE Practitioner/staffB denied | 403 | 0 | PASS |
| POST PractitionerRole denied | 403 | 0 | PASS |
| PATCH PractitionerRole/staffB denied | 403 | 0 | PASS |
| DELETE PractitionerRole/staffB denied | 403 | 0 | PASS |
| AccessPolicy read+write denied | get=403 post=403 | - | PASS |
| Patient search works | 200 | - | PASS |
| ProjectMembership denied/no-others (control, no policy) | 403 | 0 | PASS |
| User denied/no-others (control, no policy) | 403 | 0 | PASS |
| Project denied/no-others (control, no policy) | 403 | 0 | PASS |
| Practitioner telecom exposed (control, no policy) | 200 | 3 | PASS |

The control still confirms the discrepancy noted above as "upstream v5.2.8 already rejects wildcard access to ProjectMembership/User for non-admins": even with **no** accessPolicy at all, a non-admin membership in a non-superAdmin project still gets ProjectMembership/User/Project denied (project-admin resource types are excluded from the legacy wildcard regardless of policy). The policy's incremental, measurable effect in a non-superAdmin project is exactly the Practitioner/PractitionerRole telecom mask (3 other entries' telecom exposed in the control vs. 0 with the policy, now proven across search, direct read, `_elements`, `_history` and `_include`) plus denying create/update/patch/delete on Practitioner and PractitionerRole and denying reads/writes of AccessPolicy outright (all omitted from the explicit allowlist). This is the behavior the original build intended; it was only unreachable in the local superAdmin project because `applyProjectAdminAccessPolicy` injects the omitted project-admin grants unconditionally for superAdmin projects (see the fa6bada source citation above).

Conclusion unchanged: the containment policy works as designed once the project is not `superAdmin`. Production clinics must run in a non-superAdmin project (the local dev project's `superAdmin:true` is a local-only artifact; confirming this for production is a Hostinger-boundary task left to the user). The local superAdmin project itself remains unremediated. Cross-clinic clinical-data isolation remains unverified and out of scope for this script.

Conclusion: the containment policy works as designed once the project is not `superAdmin`. Production clinics must run in a non-superAdmin project (the local dev project's `superAdmin:true` is a local-only artifact; confirming this for production is explicitly a Hostinger-boundary task left to the user, per the existing "Discrepancy resolved" note above). The local superAdmin project itself remains unremediated and should not be treated as representative of production behavior.
