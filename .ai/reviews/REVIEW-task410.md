# Review – Task 410 (PR #268, head a4339f0): dispensing version-guard race + idempotent invoice per visit

Verdict: **APPROVE** (non-blocking notes below). Reviewed diff `7cec0c4..a4339f0` (billing-service, fake-medplum helper, tests, notes).

## Verification
- `bun test tests/unit`: 265 pass, 0 fail. `tsc --noEmit`: clean. eslint on the 3 changed code files: clean.
- Mutation checks (fix reverted, new tests re-run):
  - Disable `isOwnVersionOrClinicBump` (always accept re-read) -> "concurrent checkout saving between our save and re-read" FAILS (stock deducted / not superseded).
  - Replace `createResourceIfNoneExist` with `createResource` -> "two first-time checkouts create exactly one invoice" FAILS.
  So both races are covered by tests that fail without the fix.

## Race 1 (version guard)
After save, the re-read version is accepted only if it is ours or has identical billed content (status, lineItem, totals), i.e. the metadata-only `$set-accounts` bump. A different version with different content means a concurrent checkout saved in between: this request deducts nothing (`superseded: true`) and the newer request reconciles. `deductStockForCheckout` still re-checks the version. Correct.

## Race 2 (duplicate invoice)
First-time create is a FHIR conditional create (`If-None-Exist`) on consultation + clinic identifiers (both AND-ed, so clinic is part of the match key: no cross-clinic adoption). Loser detects a foreign invoice, loops, and applies its data as an If-Match update (max 3 retries, then error). Fake helper now ANDs repeated identifier params (matches FHIR semantics).

## Checks requested
- No new clicks/steps: diff touches no UI, route, sidebar or composer code.
- Checkout never blocked by low stock: stock errors are caught (`dispenseError`); superseded path returns normally; new test covers stock=1, qty=5.
- Clinic containment intact: write path unchanged (`withClinicIdentifier`, `assignResourceToClinicTenant`, `assertPatientInClinic`); conditional-create key includes clinic.
- Lab/POCT, composer, Firebase: untouched.

## Non-blocking notes
1. "Did a competing checkout create it?" is inferred from `invoiceNumber`/`date` equality rather than an explicit signal. Collision needs same-millisecond requests proposing the same invoice number; practically negligible. Could be hardened by comparing `meta.versionId === "1"` plus number, or via a created-vs-found flag.
2. Superseded request returns its own `saved` invoice (stale vs. the newer one) to the caller; UI only uses id/stock flags, so harmless.
3. If the superseding request's own stock deduction fails, nobody retries until the next checkout/edit (already surfaced via `dispenseError` on that request).
4. Evidence is fake-Medplum only; the real-server conditional create with two identifier params was not re-run here (standard FHIR/Medplum behaviour per notes). A dev-Medplum e2e of two parallel checkouts would be a nice follow-up.
