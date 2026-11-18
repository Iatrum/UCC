# Task 576: checkout correctness (verified against origin/dev 620d0c8)

| Item | Status on dev | Evidence |
|---|---|---|
| (a) stockNegative never shown (Part 2 #1) | API + banner fixed (Task 504/545); **toast lacked item names** | `lib/billing/checkout-stock.ts` `buildStockNotice`, `orders-client.tsx` banner. Now `checkoutToastDescription` puts the lines in the toast. |
| (b) unresolved/error invisible when Tasks off (Part 2 #2) | API returns `stockUnresolved`/`stockError` (`app/api/billing/route.ts`, test in task458-checkout); toast now carries them too | same helper |
| (c) preview invoice number changes (Part 2 #8) | Already fixed (Task 519): checkout GET no longer sends `previewNumber=true`; UI shows "Assigned on completion" via `displayInvoiceNumber`. Saved-number generation untouched | `checkout-client.tsx`, `lib/billing/checkout-guards.ts` |
| (d) Complete on empty RM 0.00 (Part 1 #16) | Already fixed (Task 458): button disabled when `!billable`, warning `no-billable-items-warning`, API 400 `NO_BILLABLE_ITEMS_MESSAGE`. A confirm dialog would be redundant since the action is blocked | same |

Change: toast text only (`orders-client.tsx`), new pure helper, unit test `tests/unit/task576-toast.test.ts`. Dispense flow untouched. Server API unchanged (shape already correct).
