# Task 351 — independent review of Task 350

PR: https://github.com/Iatrum/UCC/pull/247 (`ai/task-350-containment-2` → `dev`).
Original head: `6cf8842646b12acb8eb12bb9b43e125b2581665d`. Reviewer did not author Task 350. Review performed in `/home/dev/ucc-task351`, initially created from `origin/dev`; submitted head checked out without merging/rebasing. Worktree-local identity copied from the last base commit author. User explicitly authorized normal pushes for this task, overriding AGENTS.md's standing no-remote rule.

## Verdict

**HOLD for validation.** MAJOR implementation findings below are fixed in two fix loops; no outstanding MAJOR finding in the reviewed create/export paths. This is **not unconditional approval**: the required full `check-all.sh` gate did not pass and browser composer behavior remains unverified. Do not interpret GitHub mergeability or passing CI as satisfying the local clinical workflow gate.

## MAJOR findings and fixes

1. **Privileged exports read across clinics, then filter too weakly.** Both Patient searches omitted clinic scope. `makeClinicStamper.isOwn` accepted a matching identifier even when accounts named a different clinic. Added server-side `_compartment` narrowing, fresh extended reads and exclusive account ownership checks. Foreign/mixed-account matches cannot be reused. Unknown/missing clinic fails before writes. Bulk Firebase queries retain `clinicId == X`; an absent IC no longer causes a broad Patient lookup.
2. **FHIR mapper writes escape the acting client's boundary.** `/api/fhir/export` authenticated with a staff client but mappers wrote via unrelated raw REST credentials, without extended mode or tenant stamping. Mappers now use the supplied acting SDK client, explicitly validate patient/visit links, and stamp clinic/account metadata. The route also authorizes the Encounter **before** fetching its clinical graph. It reuses the existing Patient. Pinned Medplum v5.2.8 source confirms extended admin mode is required to write explicit accounts.
3. **Patient-linked writer coverage was incomplete.** Billing exception Tasks had no patient/visit guard; invoices checked only the patient despite carrying an Encounter reference. Added paired authorization before writes, scoped Task deduplication searches and checked reused Task ownership. Consultation create/update paths now require clinic context and prove existing patient/visit ownership; legacy find-or-create patient behavior is preserved for scoped creates. The shared patient assertion now rejects absent clinic context rather than silently bypassing containment for privileged callers.
4. **Triage child resources lacked clinic identifiers.** Encounters were scoped, but complaint/vital Observations were not. Both now carry the clinic identifier. Valid own-clinic triage and consultation-note writes remain covered by positive tests.

Fix loop 1: `1d55cd3` (normal push), export/guard/writer fixes plus boundary tests.
Fix loop 2: graph authorization before clinical reads, scoped billing Task lookup, triage positive coverage, and correction of the pre-existing invoice test fixture. No third implementation loop.

## Writer inventory and scope

Searched all `app/`, `components/`, `lib/` TS/TSX for SDK creates, updates, transactions and raw/generic persistence helpers; followed patient-linked create callers. No additional direct writes were found in UI components.

| Writer family | Authorization / review result |
| --- | --- |
| Referral, appointment, document, follow-up | Shared patient assertion now fails closed without clinic; foreign-patient zero-write tests retained. Follow-ups without a patient reference do not bypass a linked-patient check. |
| Scheduling book/manual-book | Patient checked before Schedule/Slot/Appointment mutations; foreign slot forbidden. Existing Task 350 tests pass. |
| Triage/check-in | Patient guard precedes creation; Encounter scoped; complaint/vital child identifiers repaired and positive-tested. |
| Consultation create/update; legacy updateConsultation x2 | Existing patient/Encounter assertions; own-clinic notes persist; missing/foreign contexts reject. Scoped legacy patient creation retained. |
| Checkout invoice, billing exception Task | Patient and Encounter pairing checked before writes; Task lookup scoped and returned ownership checked. |
| FHIR graph and bulk/standalone exports | Auth/secret/context guards; scoped queries; exclusive Patient account checks; supplied SDK client and stamped graph. |
| Lab/POCT and imaging orders/results | Order creators already use `assertOrderClinic`; result paths derive links from existing orders. No result-ingestion/UI changes introduced. The newer X-ray work already on `dev` is outside this PR's diff and was not overwritten or duplicated. |
| Unsigned drafts | Existing `draftScope`/patient-visit assertion, practitioner/clinic/patient key, ownership checks and version preconditions unchanged; draft unit tests pass. |
| Generic bundle/validation helpers and audit provenance | Callers inspected rather than treating low-level persistence as independently authorized endpoints. Provenance checks acting-client targets before privileged writes. |
| Patient registration/intake, directory/catalog/config | Registration creates a new clinic-owned patient; intake QuestionnaireResponse currently contains answers without a Patient reference. Not an arbitrary patient-link create endpoint. No Firebase Storage changes. |

This is a create/link-containment review, not a claim that every legacy read/delete/admin operation has been exhaustively penetration-tested. No policies, migration/backfill or live clinical data were changed.

## Tests and regression evidence

- `NODE_OPTIONS=--max-old-space-size=3072 bun run lint`: PASS (TypeScript plus clinic-admin client guard).
- `bun test tests/unit`: **57 pass, 0 fail** (includes composer draft lifecycle/ownership, positive own-clinic consultation-note and triage writes).
- `bun test tests/review/task351-export-routes.test.ts`: **3 pass, 0 fail**. Run separately because route module mocks are process-wide. Tests invoke actual POST handlers with fake clients/Firebase only: absent auth/context/unknown clinic, foreign patient/visit, own graph reuse/stamping, Firebase query scope and Medplum query scope.
- Meaningfulness: neutralizing the shared patient assertion yields **11 failures** across the 23 containment tests; removing export compartment scope fails the bulk-route query assertion. Mutations restored immediately. The original invoice rejection fixture was invalid before authorization (wrong line-item fields); repaired it so rejection now exercises the guard.
- `git diff --check`: PASS.
- Required full gate attempted with `timeout --kill-after=5s 20s ... bash e2e/scripts/check-all.sh task351`: **OVERALL FAIL**, immediate infrastructure failure: `mkdir: cannot create directory '/workspace': Permission denied`. Its hard-coded output paths prevented lint/build/browser/clinic steps from running and there is no `/workspace` baseline. Log: `/tmp/task351-check-all.log`. An unused loopback app port was supplied to avoid another worktree's server; all Medplum URL overrides were `http://127.0.0.1:8113/`. No browser results or baseline comparison exist; cannot assert “no new failures”.
- PR CI at milestone `1d55cd3`: lint-and-build SUCCESS; other checks SUCCESS; MERGEABLE/CLEAN. Final live head/state is reported in the task response after the last push.

No `components/`, composer effects, navigation/sidebar, Lab display, POCT online requirement/manual-entry logic or Firebase Storage implementation changed. This limits UI regression risk; it does **not** replace browser signing/draft/checkout verification. No server started; none to kill. Existing :3210 left alone. No Docker/container operations, protected directories, Supabase, Tradebot, real patient data, merge or force-push. All test data/credentials synthetic; no .env.local or e2e/.secrets staged.

Publication note: the second milestone exposed append conflicts in STATE.md and CHANGELOG.md with newer dev history. Copied the fetched dev versions and appended the Task 351 entries, preserving both histories via a normal documentation commit; no merge/rebase or third implementation loop.
