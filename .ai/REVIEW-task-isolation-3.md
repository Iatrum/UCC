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
