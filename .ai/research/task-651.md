# Task 651 — consistent low / order-soon logic

Found by Task 643: table flagged `stock <= minimumStock`, so stock 0 / min 0 (no threshold) showed "Low stock", while `isOrderSoon` ignored that case differently.

Fix: `lib/inventory/stock-summary.ts` now exports `hasThreshold` (minimumStock finite and > 0), `isOrderSoon` (threshold set && 0 < stock <= min) and alias `isLowStock`. Used by `inventory-table.tsx` (red stock text + Low badge), inventory `page.tsx` (overview badge colour, filter, tiles, banner via summarizeLowStock).
No threshold => never low; stock <= 0 still shows "Out of stock" (and "Negative stock" in the table).
Tests: `tests/unit/task651-low-stock.test.ts` (also run with TZ=America/New_York). No date logic involved.
