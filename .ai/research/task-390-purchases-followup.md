# Task 390 — purchases scope follow-up (from review 384 of PR 259)

- `INVENTORY_PURCHASING_ENABLED` is `false` in `lib/purchasing.ts`, so PATCH/DELETE return 403 before the clinic/type guard runs. The unit test mocks `@/lib/purchasing` as enabled so the 404 guard is actually exercised (the old `[403,404]` assertion could pass without testing it).
- Added: PATCH non-PO Basic -> 404 (no update), PATCH/DELETE other-clinic PO -> 404, DELETE non-PO -> exactly 404.
- `scripts/dev/smoke-purchases-scope.ts`: runs `listClinicPurchaseOrders` against dev Medplum (127.0.0.1:8113 only, refuses other hosts) with 105 + 5 fake POs in two throwaway clinics, asserts paging + scoping, deletes them. Medplum `searchResourcePages`: https://www.medplum.com/docs/sdk/core.medplumclient.searchresourcepages ; FHIR token search `system|value`: https://hl7.org/fhir/R4/search.html#token
- The "window is not defined" PKCE warning in Bun is benign (falls back to plain challenge).
