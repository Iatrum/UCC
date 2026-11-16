# Task 5 research — AccessPolicy as the primary clinic-isolation control

Verified against the bundled server of the DEV Medplum container (`ucc-dev-medplum`, 5.2.15, `packages/server/dist/index.js`, copied read-only with `docker cp`) and the official docs below. Production runs its own Medplum: the runbook makes the operator re-check the version first.

Docs: https://www.medplum.com/docs/access/access-policies (criteria limits, `%profile`/custom `%name` membership parameters, `admin` flag does NOT bypass a policy, "chained searches are not allowed") · https://www.medplum.com/docs/user-management/project-admin (links to Super Admin Guide / Admin Users / Project vs Server Scoped Users) · FHIR R4 AccessPolicy is a Medplum resource, not FHIR core.

## Why superAdmin broke isolation (evidence)
Server source (5.2.15):
- `getRepoForLogin`: `new Repository({ superAdmin: project.superAdmin, projectAdmin: membership.admin, projects: [project,+links] ... })` — **every member** of a superAdmin project gets repo superAdmin.
- `applyProjectAdminAccessPolicy`: `if (project.superAdmin) push ProjectMembership/User/Project/... grants` into every policy; the non-super branch strips those for non-admin members and, for admins, re-adds them with `_project=<own project>` criteria and `ownProjectWriteConstraint`.
- Measured with `scripts/access-policy/verify-clinic-isolation.mjs` BEFORE (evidence `before.json`, 71/110, label "before"): a policied clinic-A staff token could list 17 ProjectMemberships, 22 Users, 5 Projects, 8 AccessPolicies, read another project's Practitioner, list other clinics' Practitioners, **update and delete a clinic-B Patient**, and **create** ServiceRequest/Encounter/ImagingStudy/Observation for a clinic-B patient (201).

## Why not move data to a new project
Medplum has no supported move. `Project/$clone` (`projectclone.ts`) gives every resource a new id (breaks Firebase/PACS/device/Patient-id links), copies max 1000 per type and is super-admin only. Direct SQL on `projectId`/`meta.project` is unsupported. So the topology changes around the data: the **existing clinical project keeps its id, data, memberships and users and is demoted** (`superAdmin=false`); the Medplum operator moves to a **new** superAdmin project that holds nothing else. Rollback = flip the flag back.

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
- Hand-set policies are never repointed by the script (blocker or `--skip-membership`).
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
