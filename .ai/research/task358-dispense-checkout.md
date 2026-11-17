# Task 358 — auto-deduct inventory at checkout (2026-11-16)

Decision (user, 16 Nov): stock is deducted automatically when a visit is checked out/billed. No dispense step, no extra clicks.

## What the code already had
- Stock = `Medication` (identifier `https://ucc.emr/inventory/medication|catalog-item` + `clinic|<id>`, `meta.accounts`), `stock` is an `valueInteger` inside the `https://ucc.emr/inventory` extension (`lib/fhir/inventory-service.ts`).
- Checkout = `POST /api/billing` -> `completeCheckoutInvoice` (`lib/fhir/billing-service.ts`): one `Invoice` per consultation (upsert, so re-checkout reuses it). Void = `PATCH /api/billing {action:'void'}`, delete = `DELETE /api/billing`.
- Prescriptions are `MedicationRequest`s that carry only text (`name [strength]`), price and quantity — **no inventory id**. The invoice line name is that text, so the only reliable link to stock is the name.
- The old e2e probe in `workflow.spec.ts` ("checkout does not decrement stock") documented the gap.

## Design
`lib/fhir/dispense-service.ts`
- Match each invoice line (`type Item`) to exactly one clinic inventory item by name or `name + strength` (case/space-insensitive). Zero or >1 matches => not deducted, reported in `unmatched` (never guess).
- One `MedicationDispense` per (consultation, inventory medication): identifier `https://ucc.emr/dispense/checkout|<consultation>:<medication>` + clinic identifier + the Medication's `meta.accounts`; `status completed|cancelled`, `quantity`, `context Encounter/…`, extensions: invoice ref, stock before/after.
- The stock change and the dispense write go in ONE FHIR `transaction` Bundle (`Medication` PUT with `ifMatch`, `MedicationDispense` POST/PUT). All-or-nothing, so audit and stock can't diverge; a concurrent writer gets 412, we re-read and retry (max 4).
- Idempotency: the dispense stores the quantity already deducted; each run applies only `target − recorded`. Same items => 0 change. Changed quantity => the difference. Line removed on re-checkout => returned to stock (dispense becomes `cancelled`).
- Negative stock is allowed (never blocks checkout). `stockNegative` is returned by `/api/billing`; the existing inventory Items table shows a "Negative stock" / "Out of stock" / "Low stock" badge (no new nav).
- Void/delete of the invoice calls `reverseStockForCheckout` first (clinic-scoped, idempotent), then updates/deletes the invoice. Retrying a void is safe.
- Failure policy: invoice already saved => checkout still succeeds; a `stock-deduction-failed` billing exception Task is created and re-running checkout retries safely.
- Read-only audit: `GET /api/inventory?dispensesFor=<consultationId>` (staff client, clinic-scoped by policy).

## FHIR references (R4)
- MedicationDispense: https://hl7.org/fhir/R4/medicationdispense.html (`context`, `quantity`, `status` incl. `cancelled`).
- Transaction/If-Match/conditional rules: https://hl7.org/fhir/R4/http.html#transaction , https://hl7.org/fhir/R4/http.html#concurrency
- Medplum batch/transaction: https://www.medplum.com/docs/fhir-datastore/fhir-batch-requests

## Findings worth knowing
1. **Access policy:** `UCC Clinic Staff Policy` had no `MedicationDispense` rule, so staff got 403. Added to `scripts/setup-access-policies.ts` plus the two mirror lists (`backfill-clinic-accounts.mjs`, `e2e/scripts/clinic-check.ts`). **Rollout: re-run `scripts/setup-access-policies.ts` against each environment** (done on dev Medplum only). Until then checkout works and raises the exception Task above.
2. In local dev (`NEXT_PUBLIC_DISABLE_AUTH=true`) some routes use the process-level admin client whose dev policy lacks `MedicationDispense`; the audit lookup therefore uses the staff client.
3. `scripts/access-policy/ucc-local-staff-containment.json` (local containment test fixture) keeps `Medication` read-only and is deliberately unchanged.
4. Base branch: `origin/main` is a June snapshot (no `e2e/`, no `.ai/`); the work is based on `origin/dev`.

## Limits / follow-ups
- Name matching: an item prescribed by free text that doesn't equal an inventory name is not deducted (listed as `unmatched`). A durable fix is storing the inventory Medication id on the MedicationRequest in the composer (touches the composer; deliberately not done here).
- Fractional billed quantities are rounded up to whole units (stock is an integer).
- Stock is per Medication, not per batch/expiry.

## Verification (dev Medplum :8113, fake data)
- `tests/unit/dispense-service.test.ts` (9): deduct, idempotent, delta on re-checkout, negative, reverse x2, clinic isolation, unmatched/ambiguous, 412 retry, matcher.
- `e2e/tests/dispense-checkout.spec.ts` (4): deduct+negative+idempotent+audit, UI badge, void/restore/re-checkout, 3 concurrent checkouts deduct once.
- `bun run lint`, `bun run build:ci` pass; `api.spec.ts` + `workflow.spec.ts` pass (the only failure is the pre-existing "known-bug probes" summary, minus the stock bug which is now fixed: Paracetamol 500 -> 499 in the real journey).
