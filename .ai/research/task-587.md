# Task 587 — UX-FINDINGS small Low leftovers
Verified on origin/dev 51b9a58 (code + unit tests; no dev server needed).
- (a) Part 1 #7 history table clipped: ALREADY FIXED (Task 446). `patient-profile-workspace.tsx` wraps the md+ table in `overflow-x-auto` with `min-w-[860px]`, parents are `min-w-0`; below md a card list is used. Skipped.
- (b) Part 1 #8 "Total visits / Last completed visit": ALREADY FIXED (Task 446). Header uses `consultSummary` (lib/patients/profile-history.ts), labelled "consults"/"No consults yet"; signed consults are intentionally not "completed visits". Skipped.
- (c) Inventory banner wording: fixed. New `lowStockBannerStatus` in lib/inventory/stock-summary.ts: out-of-stock only -> "out of stock."; threshold only -> unchanged; mixed -> "out of stock or at or below the minimum stock threshold."
- (d) Document Templates: one-line helper text added above the placeholder list in components/settings/document-template-editor.tsx (text only).
Tests: tests/unit/task587-banner.test.ts. tsc + eslint clean on changed files.
