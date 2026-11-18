# Task 568: access policy ProjectMembership leak

Result: NOT reproducible on current dev. The leak is already closed. No policy change needed; this task adds a pinning unit test and marks the BACKLOG line done.

## Docs used
- Medplum access policies (criteria, readonly, hiddenFields, compartment, parameterized `%` variables): https://www.medplum.com/docs/access/access-policies
- Medplum projects / ProjectMembership, admin flag: https://www.medplum.com/docs/access/projects
- A resource type with no rule in a policy is denied entirely (default deny); only project-admin memberships get implicit ProjectMembership/User/AccessPolicy access.

## Code
`lib/fhir/clinic-access-policy.ts` is the single source for "UCC Clinic Staff Policy" (applied by `scripts/setup-access-policies.ts`). It has no `*`, ProjectMembership, User or AccessPolicy rule. Directory rules (`clinicDirectoryRules`, added by Task 5, commit 5241ae2) are read-only and scoped: Practitioner by `_compartment=%clinicAccount` or own `_id=%profile.id`, PractitionerRole by `organization=%clinicOrganization`, Organization/HealthcareService by own id. `_has` is forbidden in criteria (axp-3), see `task5-topology.md`.
The `/workspace/iatrum-ucc-ap` notes are obsolete (path not on this VPS).

## Live check (dev Medplum 127.0.0.1:8113 only, fake data, doctor@ucc.local staff login, statuses/counts only)
Dev had 19 memberships, 13 organizations, 18 practitioners and 18 PractitionerRoles across clinics.
- Deployed policy vs repo: `clinicStaffPolicyDrift` = [] (in sync). Membership is not admin, no legacy accessPolicy.
- Search ProjectMembership, User, AccessPolicy, Project, Login, Bot, ClientApplication, Subscription, AuditEvent, Device, Location, Questionnaire: all 403.
- Direct `GET ProjectMembership/<id>` and `User/<id>` for all 19 memberships: none 200.
- Own membership search by profile: 403.
- Create ProjectMembership, User, Practitioner: 403.
- Practitioner search: 4 of 18 (own clinic only). The 14 others, read by id: 0 readable. PractitionerRole: 4 of 18 visible, 0 of 14 foreign readable. Organization/HealthcareService: 1 each (own).
- Residual by design: own-clinic colleagues' Practitioner records include telecom (email/phone), needed for the staff directory. Same clinic, not cross-clinic.

## Production apply step
None required by code. To confirm production has no drift, Hidayat/assistant can run the idempotent `bun run medplum:setup-access` against the production project (upserts by policy name, ids unchanged) or compare the deployed policy with `clinicStaffPolicyDrift`. This task did not touch production.

## Tests
`tests/unit/clinic-staff-policy-drift.test.ts` new block "identity/membership containment (Task 568)" pins: no wildcard/identity/policy rules, directory rules read-only with exact criteria, no unscoped rule other than create-only.
