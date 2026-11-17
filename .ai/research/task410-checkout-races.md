# Task 410 – checkout races (PR #268)

Sources: FHIR R4 conditional create (https://hl7.org/fhir/R4/http.html#ccreate, `If-None-Exist`);
Medplum `createResourceIfNoneExist(resource, query)` (medplum 5.2.8 typings, "syntactic sugar for searchOne ?? create", sent as If-None-Exist).

1. Version-guard race (review 403): after saving, `completeCheckoutInvoice` re-reads the invoice for the
   `$set-accounts` (clinic-assignment) bump. It now only accepts the re-read if the version is the one it saved
   or the billed content (status, lineItem, totals) is unchanged (metadata-only clinic bump). Otherwise a concurrent
   checkout saved in between: this request deducts nothing (`stock.superseded = true`); the newer request reconciles.
   `deductStockForCheckout` still re-checks the invoice version itself.
2. Duplicate first-time invoices: creation is a conditional create on consultation + clinic identifiers.
   If a competing request created it first, the returned invoice is adopted and our data is applied as an If-Match update
   (bounded retries). Never blocks checkout on stock; no new UI/steps.

Tests: tests/unit/dispense-consistency.test.ts ("Task 410"), fake helper tests/unit/helpers/fake-medplum.ts
(multi-identifier conditional create, createResource, searchOne, `$set-accounts` hook).
