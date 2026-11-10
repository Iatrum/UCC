# Task 090 / task-isolation-1 — self security review

Scope: Phase 0 verification and Phase 1 plumbing only. Single-author Codex self-review; independent Claude review remains pending on the draft PR. No backfill apply, existing-staff migration, production access or merge.

## Verdict

Phase 1 implementation is suitable for a draft review, subject to the final gate recorded below. This does **not** establish complete clinical isolation for existing staff/data: Phase 2 remains necessary and the two MAJOR findings below remain open.

## Open findings, explicitly deferred by task scope

1. **MAJOR — pre-existing write-side cross-clinic creation.** Phase 0 observed policied staff A POST an Observation whose subject is clinic B's patient: **201**, expected 403; direct read of that patient was 404. Per-resource compartment criteria did not prevent creation. App lab/imaging order services also lack an explicit patient/clinic ownership check before creation. This is a cross-tenant integrity defect, independent of Phase 1. Do not describe Phase 2 membership migration alone as fixing it. Follow up with reviewed ownership validation on every relevant creation path. Evidence: `.ai/research/clinic-isolation.md`, D36, `/workspace/ai-logs/task90-phase0/evidence.txt`. The foreign Observation's read-back by the creator was not independently measured; do not claim that outcome as tested.
2. **MAJOR — pre-existing non-extended account reads.** Medplum strips `meta.accounts`/`meta.account` unless reads send `X-Medplum: extended`. App `getResourceAccountReferences()` callers in lab/imaging use ordinary reads, so their account arrays can be empty; the newly threaded Provenance argument inherits this limitation at those call sites. Script and inventory use extended reads; this task does not change the app SDK/read configuration. The Phase 1.5 reassignment implementation derives accounts from clinic Organizations/HealthcareServices and does not use these call sites. Follow up before relying on result/audit propagation during migration. Evidence: backfill dry run and `.ai/BACKLOG.md`.

## Implementation checks

- Existing parameterized clinic staff policy retained. Provenance receives unscoped create and scoped read/search; no update/delete grant added. Audit stamping stays non-blocking to protect existing clinical writes.
- Explicit clinic account references now reach Provenance through the planned call sites. Three Encounter update paths call the existing tenant-stamping helper after updating. The live regression checks all three original Encounter IDs using extended reads. An early failure was a fixture missing the triage extension, causing a new visit instead of reuse; fixed in the fixture.
- Staff assignment PATCH remains platform-admin-only. Full deduplicated assignment set replaces only clinic-policy entries; unrelated array and singular policies are preserved. Broad custom grants can still grant broader access by design; this is not an audit/migration of arbitrary custom policies. Admin membership privileges and activation status remain unchanged.
- Reassignment resolves all clinic parameters before changing profile/roles/membership, then writes them in one FHIR transaction with version preconditions. Current roles are paginated; duplicate/inactive assignment rows are normalized. Missing/invalid clinic parameters fail before the transaction.
- Removing the final clinic uses an explicit empty policy when there are no other explicit grants, avoiding Medplum's legacy no-policy full-access fallback. A same-name no-clinic policy containing resource grants is rejected. The local disposable regression verifies zero access and later re-grant without a new staff login.
- Backfill remains dry-run by default with a local endpoint guard; it was never applied. Historical missing accounts are not treated as a new Phase 1 regression. Inventory checks all 23 compartment-scoped types, fails invalid/mismatched stamped accounts and offers strict completeness for post-migration checks.
- No sidebar/nav, module-toggle, composer UI, Firebase Storage or manual POCT result-entry changes. POCT and X-ray remain in their existing feature modules.

## Limits and follow-ups before Phase 2

- The backfill inference uses Organization reference IDs as a fallback clinic key while account lookup uses clinic identifier values; resources lacking identifiers with only UUID Organization references may be unresolved. Current dry run has unresolved=0. Validate inference/ambiguity, backups, apply failure handling and rollback separately before approving any apply. No write-mode verification was performed here.
- Whole-policy cross-clinic fixture matrix and full clinical workflows under migrated seeded identities remain Phase 2. This phase tests four disposable clinics across Patient/Encounter/Observation reads/searches, multi-clinic union/revocation, custom legacy grants, invalid reassignment, zero clinics, ServiceRequest creation/read, Provenance and all three Encounter update paths.
- No concurrency fault injection was run. Atomic transaction behavior follows the installed SDK and FHIR R4 contract; invalid-clinic failure is tested live.

## Validation

- Focused isolation e2e: PASS (1/1).
- Extended local clinic inventory: 433 historical missing accounts, 0 invalid stamped accounts before the full gate.
- Final foreground `e2e/scripts/check-all.sh task-isolation-1`: pending; append measured result after completion.
