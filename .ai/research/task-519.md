# Task 519: checkout follow-ups (verified on origin/dev cab678a)

| Item | Status on origin/dev | Evidence |
|---|---|---|
| Part 1 #16 empty checkout | Already fixed (Task 458) | `hasBillableItems`, `no-billable-items-warning`, Complete disabled when `!billable` |
| Part 1 #17 no `?patientId=` | Already fixed (Task 458/504) | `GET /api/orders` resolves patient from the clinic-scoped consultation, 404 for foreign one (`resolveCheckoutPatientId`); client no longer requires patientId |
| Part 2 #7 Submit e-Invoice | Already fixed (Task 504) | Button `disabled`, tooltip + "e-Invoice is not available yet." |
| Part 2 #8 invoice number changes per load | **Fixed here** | Client fetched `previewNumber=true`, which generates a random number each GET. Now only a saved invoice's number is shown; otherwise "Assigned on completion" (`displayInvoiceNumber`). POST omits `invoiceNumber` when unsaved; server `resolveInvoiceNumber` generates it. |

Stock auto-deduct at checkout is unchanged. The `previewNumber` API param is left in place (unused by the UI).
