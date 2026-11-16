# Task 5 research — AccessPolicy as the primary clinic-isolation control

Original recovered WIP investigation verified against the bundled server of the DEV Medplum container (`ucc-dev-medplum`, 5.2.15, `packages/server/dist/index.js`, copied read-only with `docker cp`) and the official docs below. Production runs its own Medplum: the runbook makes the operator re-check the version first.

Docs: https://www.medplum.com/docs/access/access-policies (criteria limits, `%profile`/custom `%name` membership parameters, `admin` flag does NOT bypass a policy, "chained searches are not allowed") · https://www.medplum.com/docs/user-management/project-admin (links to Super Admin Guide / Admin Users / Project vs Server Scoped Users) · FHIR R4 AccessPolicy is a Medplum resource, not FHIR core.

## Why superAdmin broke isolation (evidence)
Server source (5.2.15):
- `getRepoForLogin`: `new Repository({ superAdmin: project.superAdmin, projectAdmin: membership.admin, projects: [project,+links] ... })` — **every member** of a superAdmin project gets repo superAdmin.
- `applyProjectAdminAccessPolicy`: `if (project.superAdmin) push ProjectMembership/User/Project/... grants` into every policy; the non-super branch strips those for non-admin members and, for admins, re-adds them with `_project=<own project>` criteria and `ownProjectWriteConstraint`.
- Measured with `scripts/access-policy/verify-clinic-isolation.mjs` BEFORE (evidence `before.json`, 71/110, label "before"): a policied clinic-A staff token could list 17 ProjectMemberships, 22 Users, 5 Projects, 8 AccessPolicies, read another project's Practitioner, list other clinics' Practitioners, **update and delete a clinic-B Patient**, and **create** ServiceRequest/Encounter/ImagingStudy/Observation for a clinic-B patient (201).

## Why not move data to a new project
Medplum has no supported move. `Project/$clone` (`projectclone.ts`) gives every resource a new id (breaks Firebase/PACS/device/Patient-id links), copies max 1000 per type and is super-admin only. Direct SQL on `projectId`/`meta.project` is unsupported. So the topology changes around the data: the **existing clinical project keeps its id, data, memberships and users and is demoted** (`superAdmin=false`); the Medplum operator moves to a **new** superAdmin project that holds nothing else. Rollback restores project settings, backed-up grants, policies and directory account stamps. The dedicated operator is retained for recovery.

## Final topology
| Identity | Project | Rights |
|---|---|---|
| Medplum operator (dedicated user) | NEW "UCC Platform Operator", superAdmin=true | server administration only; no clinical data; credentials kept offline |
| UCC platform admin (existing admin user) | clinical project, `admin=true`, no policy | project-scoped admin (app `/admin` uses `membership.admin`, `isPlatformAdmin`), cannot touch other projects |
| App server `ClientApplication` | clinical project, `admin=true` + **UCC App Server Policy** | explicit type list (no `*`): can invite users/set accounts in its own project, cannot create Bot/ClientApplication, read Login, reach other projects, become superAdmin |
| Clinic staff | clinical project, `access[]` per clinic → **UCC Clinic Staff Policy** | compartment-scoped read/write, scoped directory, no ProjectMembership/User/Project/AccessPolicy |

Project `link` → base "FHIR R4" project so spec SearchParameters/StructureDefinitions stay visible.

## Findings that shaped the implementation
1. **`_has` is forbidden in policy criteria** (constraint `axp-3`: `criteria.contains('_has:').not()`; also no chains). First draft restricted Practitioner via `_has:PractitionerRole`; the server rejected it (400). Fix: stamp `Practitioner.meta.accounts` with the clinic HealthcareService of every active PractitionerRole and use `Practitioner?_compartment=%clinicAccount` (+ `Practitioner?_id=%profile.id` for self). App code keeps it in sync (`syncPractitionerClinicAccounts` after invite and role reassignment); the migration script backfills.
2. Project admins in a non-super project only see **project-scoped** Users (`User?_project=`); server-scoped users do not match. Tests therefore take user ids from memberships.
3. `$set-accounts` needs project admin (`setResourceAccounts`): the app client must stay `admin=true`; its policy decides which types it may set accounts on.
4. In the policy, `%clinicWriteAccounts` must be present on every access entry as the union regex; the script normalises that (same as `withClinicMembershipAccess`).
5. Existing `ProjectMembership`s are not moved: membership `project` is fixed at creation, and not moving them keeps ids, logins, and the app's `projectId` env unchanged.

## Residual risks (documented, not solved here)
- The app server credential can still read/write every clinic in the project by design; per-clinic checks in code (`assertOrderClinic`, `resolveClinicTenant`, `write-containment.ts`) remain the second layer.
- Hand-set policies are never repointed by the script; there is no skip flag. Resolve them explicitly before proceeding.
- Resource-level `compartment` is deprecated in the policy schema; revalidate on Medplum upgrade.
- Medplum caches project/policy state; verify with a fresh login after cut-over.

## Recovery review (16 November 2026)
The existing local WIP was recovered into an isolated origin/dev worktree. Read-only docker inspect of **ucc-dev-medplum only** confirms compose project `ucc-medplum-dev`, image `medplum/medplum-server:5.2.15`, rather than the task brief's 5.2.8. Official pinned source checked for both versions:
- https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/fhir/accesspolicy.ts
- https://github.com/medplum/medplum/blob/v5.2.15/packages/server/src/fhir/accesspolicy.ts
- https://github.com/medplum/medplum/blob/v5.2.15/packages/server/src/fhir/projectmembership.ts
- https://github.com/medplum/medplum/blob/v5.2.15/packages/server/src/admin/projectclone.ts
- https://www.hl7.org/fhir/R4/security-labels.html — labels require enforcement by the server; app identifiers alone do not authorize access.
- https://nextjs.org/docs/app/guides/authentication — enforce authorization near data access; retain existing service checks.
- https://react.dev/reference/react/useEffect — no composer lifecycle changes needed.
- https://dicom.nema.org/medical/dicom/current/output/chtml/part18/chapter_8.html — DICOMweb is a separate protocol boundary; keep existing PACS authorization and stable resource IDs.

The app client is a project admin because $set-accounts and staff invitations require that capability. Its injected project-admin rights mean the clinical resource allow-list is **not** a sandbox against a compromised app server. It is a trusted, project-scoped credential; dedicated operator credentials remain separate. Do not claim it cannot reach all administrative types until verified against the pinned server implementation.

The old after.json (108/108) is inherited evidence only. The original workflow run was not a pass: tests were run on :3251 although three suites require :3210, screenshot directories were missing, and composer/checkout timed out. Fresh gate required.

## Patient create finding and final safeguards
Fresh staff-membership regression found raw extended `POST Patient` could return 201 for a forged foreign clinic identifier even after project demotion. Patient has no parent from which to inherit accounts; it must not use the generic clinical create rule. The staff policy now omits Patient create, preserves protected metadata on updates and prevents clinic-identifier mutation. Registration already uses `savePatientToMedplumWithAdmin` behind `requireClinicAuth`, derives clinic server-side and assigns its account, so that authorized workflow remains available. Foreign update/delete returns 403 **or** 404; the legacy prerequisite assertion is adjusted only to accept either denial.

Directory synchronization errors now propagate instead of being logged and ignored. Reassignment clears old directory accounts before changing roles/grants, refreshes the Practitioner version and then performs the existing transaction; a failed restamp hides the profile from colleagues instead of exposing stale clinic assignments. This intentionally favors confidentiality during a partial failure.

New rehearsal proves existing pre-cutover staff tokens remain authenticated but lose administrative grants. App-client credential proof verifies it cannot read the operator project profile or list Bot, ClientApplication or Login. The project-admin injection remains a trusted capability, not a sandbox against a compromised server. Clinic-assigned human admins are rejected by the migration so they cannot silently bypass the staff policy.

## Policy ID creation verification
A rehearsal caught that POST replaces supplied IDs even for super-admin callers (`Repository.createResource`, `assignedId` false on the standard POST route). Manifest-backed creation therefore uses super-admin PUT to the preallocated UUID; `Repository.canSetId` and `checkExistingResource` permit this, and `fhir-router.updateResourceImpl` returns 200. Refuse any pre-existing resource at the planned ID. References:
- https://github.com/medplum/medplum/blob/v5.2.15/packages/server/src/fhir/repo.ts
- https://github.com/medplum/medplum/blob/v5.2.15/packages/fhir-router/src/fhirrouter.ts
The failed POST-manifest rehearsal was fully cleaned up and is not counted as passing verification.

## Canonical dev pagination and operator ownership
The live dev database exceeds one page of Patients. Its Bundle next links advertise `http://localhost:8113` while the approved caller uses `http://127.0.0.1:8113`. Initially the strict verifier refused that origin mismatch and exited nonzero after cleaning all probes. It now accepts only this known local FHIR alias and rewrites the path/query onto the configured 127.0.0.1 origin; actual requests remain on the approved endpoint. Arbitrary foreign origins, URL credentials and pagination loops remain refused; remote production targets require exact-origin pagination. Both migration and verifier share that behavior.

An existing non-superAdmin project with the operator project's name is never promoted based on its name alone. Promotion requires the ID recorded after this migration created the project. Existing superAdmin operator projects are verified through dedicated login/membership checks.

## Resume verification: simulated devices require development mode
The built-app run rejected every simulated POCT device because `lib/fhir/poct-device.ts:deviceForClinic` deliberately omits simulated devices when `NODE_ENV=production`; device ingress uses the same projection and therefore returns 401. This guard exists unchanged at the branch base `52c2554`. Do not relax it. Use `next dev --webpack` on :3210 for the fake-device gate; the official [Next CLI](https://nextjs.org/docs/app/api-reference/cli/next) documents webpack support and [NODE_ENV guidance](https://nextjs.org/docs/messages/non-standard-node-env) distinguishes development from production. The previous built run also lost its server before the remaining workflow/X-ray tests, followed by authentication throttling. It remains failed evidence. Local-only test guards now accept either localhost or 127.0.0.1 on port 8113, retaining remote refusal while allowing the user-approved numeric dev endpoint.

## Bounded full gate on the shared VPS
The installed Next 16.2.1 `server/lib/start-server.js` checks used heap after every dev request and exits/restarts above 80% of the V8 heap limit. Both turbopack and webpack dev modes therefore can interrupt a long monolithic suite under the required 3072 MB cap. The clean monolithic run passed all POCT/X-ray tests but restarted during workflow check-in; it remains FAIL. Official [memory guidance](https://nextjs.org/docs/app/guides/memory-usage), [Playwright CLI file selection](https://playwright.dev/docs/test-cli), and [JSON reporting](https://playwright.dev/docs/test-reporters#json-reporter) were checked. The opt-in `UCC_E2E_BATCHED=1` gate runs every discovered spec once in sequential batches, owns a fresh :3210 dev server per batch, retains individual JSON/artifacts and concatenates all suites for the existing comparator. No retries or removed tests; memory cap and simulated-device production guard stay intact. Missing/fatal batch reports withhold the combined report, failing the gate. All owned process groups are terminated before returning.

Time Chit’s existing failing admin-save assertion ran after inviting a synthetic staff member, but the test did not record that member’s Practitioner ID until after the assertion. Failure deleted its temporary clinic/account while retaining an active role/membership, which then correctly blocks topology migration as an unresolved clinic assignment. Capture that known fake identity immediately after invitation so existing finally cleanup removes its role/membership/profile before deleting the clinic. This changes only fixture cleanup, not the admin-save assertion or application behavior.

## Queue cap and owned synthetic fixture hygiene
The first batched gate passed all 53 pre-workflow tests but the workflow's new visit was absent from the queue. A doctor token directly read its Patient and Encounter successfully; the exact queue query returned 200 Encounters, advertised another page, and omitted that new Encounter. Root count was 222 demo Encounters today. `getTriageQueueForToday` on unchanged dev code fetches one `_count=200`, date-ascending page (including finished visits), so accumulated test visits fill that page. [FHIR R4 search paging/count](https://hl7.org/fhir/R4/search.html#count) documents the continuation mechanism. No application query or authorization check was relaxed.
Task-owned server logs provide a ledger of created Patient UUIDs. A private cleanup dry-run required each still-live Patient to be in the clinical project, carry one of the four fake clinic identifiers, and have a Fake name. Only those logged test Patients and their linked clinical graph were backed up (0600) and removed: 234 Patients, 135 Encounters, 1347 resources total. Seeded patients and other tasks' fixtures were excluded by the creation ledger. Two older unscoped disposable Migration identities and two exact Time Chit identities with deleted clinics were separately backed up and removed. The migration's fresh final dry-run is no-op/zero refresh. Final gate reruns against the normal-sized fake queue; production and Firebase Storage remain untouched.
