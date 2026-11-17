# Task 354: composer plan failure / "autosaved" (BACKLOG 3)

## Findings (code + live repro, 2026-11-16, dev Medplum :8113, fake data)
- Original error "Unable to detect a Project Id in the current environment" is google-auth-library's NO_PROJECT_ID_FOUND (Firebase Admin with no ADC project). https://firebase.google.com/docs/admin/setup
- On origin/dev (U1b #234, durable draft retention) `app/api/consultations/plan/route.ts` uses `lib/fhir/consultation-draft.ts` (Medplum DocumentReference) and imports no firebase/google code; `requireClinicAuth`, `clinic-tenancy`, `treatment-plan` have none either. Project scoping comes from the Medplum session, not a Firebase project id.
- Repro, unstubbed, dev server on :3354: POST plan -> 200 `persistenceAvailable:true`, GET reads it back. So no remaining server root cause; remaining Firebase uses (documents, storage/logo, export-to-medplum) are not in the composer path and Firebase Storage stays.
- U1b already made the footer truthful ("Saved (server)" / "Saved on this device only" / "Failed to save").
- Remaining client gaps in `components/orders/order-composer.tsx`: (1) `isDraftPersistenceUnavailable` string-sniffed errors (UNAUTHENTICATED, "Project Id") and silently flipped to local-only, hiding a real rejection (e.g. expired session); (2) a failed add/edit called `rollback()`, so the doctor's item vanished.

## Fix
- `lib/plan-save-state.ts` `planWriteOutcome(httpOk, body)`: `local-only` only for explicit `persistenceAvailable:false`; `saved` only for 2xx + `success:true`; everything else `failed`.
- Composer: use it for load/save/delete; remove text sniffing and the rollback on failed add/edit (item stays, status "Failed to save", Retry, Sign disabled); removing an item clears its failed-save flag. Failed delete still restores the item (server still has it).

## Tests
- Unit `tests/unit/plan-save-state.test.ts`; e2e `e2e/tests/composer-plan.spec.ts` (real route, Project Id 500, UNAUTHENTICATED 401, remove-after-failure) plus existing `save-state.spec.ts` all green (11/11).
