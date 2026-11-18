# Task 585 — UX-FINDINGS Part 1 #9 (inventory tiles/banner)

Verified on origin/dev (merged into the #313 branch, already up to date): already implemented in Task 456/457.
- `lib/inventory/stock-summary.ts`: `isOrderSoon` = `stock > 0 && stock <= minimumStock` (excludes out-of-stock); `formatItemCount` gives "N item(s)"; `summarizeLowStock` gives `bannerNames` (first 5) and `moreCount`.
- `app/(routes)/inventory/page.tsx`: banner renders 5 names + "and N more" (button to filter); tiles use `formatItemCount`. Data is the per-clinic medication list, so scoping is unchanged.
- Unit tests: `tests/unit/ux-polish-456.test.ts` (7 pass). tsc and eslint on the touched files are clean.
No code change needed; no duplicate logic added.
