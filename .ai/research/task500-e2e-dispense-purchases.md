# Task 500 - e2e for checkout dispensing (358) and clinic-scoped purchases (383)

Sources: Playwright test/request APIs (https://playwright.dev/docs/api-testing), FHIR R4 Basic (https://hl7.org/fhir/R4/basic.html), Medplum search paging (https://www.medplum.com/docs/search/paging); code in app/api/billing, app/api/purchases, lib/server/purchase-orders.ts; rule from `.ai/research/task422.md`.

## Specs
- `e2e/tests/dispense-checkout-ui.spec.ts`: real checkout screen. Fixture patient + inventory item (stock 10) + Encounter (needs `firebase-patient` identifier or GET /api/orders is 404) + prescription via POST /api/orders. Asserts: no dispense button, stock untouched on view, Complete visitation deducts exactly the quantity, one `completed` MedicationDispense, inventory page shows new stock (not negative), re-POST does not deduct again. RM 0 / no-item case is `test.skip`: #279 (Task 458) was still open on 2026-11-17.
- `e2e/tests/purchases-scope.spec.ts`: fake PO Basics for own clinic, a foreign clinic and a non-PO Basic. List shows only own; foreign/non-PO/missing id = 404 with no clinic leak; anonymous = 401/403.
- Purchasing writes are feature-flagged OFF (`lib/purchasing.ts`): POST/PATCH/DELETE return 403 before lookup. The spec asserts that contract and the untouched foreign resource (versionId); if the flag is enabled it asserts clinic stamping and 404 for foreign ids (Task 422 rule 1).

## Result
No app bug found; no app code changed. Fixtures are removed in afterAll.
