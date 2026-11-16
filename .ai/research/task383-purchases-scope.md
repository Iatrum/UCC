# Task 383 — purchases clinic-scoped search + non-PO 404

- Follow-up to Task 381 review of PR #254 (already merged into `dev` when this was started; branched from origin/dev).
- FHIR R4 Basic defines `identifier` and `code` search params, so the clinic filter (`identifier=clinic|<id>`) is applied server-side together with `code`. Medplum client `searchResourcePages` follows `next` links (https://www.medplum.com/docs/search/paging).
- List: `listClinicPurchaseOrders` (lib/server/purchase-orders.ts) pages with `_count=100`, no 500 cap; in-memory clinic+code check kept as defence in depth.
- Detail/PATCH/DELETE: `isClinicPurchaseOrder` (code + clinic) → 404 for a same-clinic Basic that is not a PO (previously `fromBasic` threw → 500; DELETE could have removed a non-PO Basic).
- Tests: tests/unit/task383-purchases-scope.test.ts.
