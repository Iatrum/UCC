# Task 814: UX-FINDINGS re-verification on origin/dev @ eba7551 (2026-11-23)

Method: read `.ai/UX-FINDINGS.md`, checked each item not marked FIXED/ADDRESSED against code, then one `next dev --webpack` on :3814 (killed afterwards), dev Medplum :8113, fake data, Playwright (in `timeout`) at 390px. Display-only changes; no official-API research needed.

## Items still unmarked, verdict
- Part 1 #19, Part 3 #24, Part 4 #32 (sidebar/nav): out of scope, still open.
- Part 2 Low 16 (dead purchasing panels): STILL REAL. `purchase-orders-panel.tsx` and `suppliers-panel.tsx` are unimported; `INVENTORY_PURCHASING_ENABLED = false`. Removal is a purchasing decision, not done.
- Part 2 Low 20: warning text exists (`document-template-editor.tsx`); "Preview with a real patient" is a new feature, left.
- Part 4 #33 (tables scroll sideways with no hint): STILL REAL, skipped: open PRs #361 (`components/ui/table.tsx`) and #362 (`components/queue-table.tsx`) edit those files.
- Part 4 #34/#35: informational, no action.
- Part 4 #38 (appointments tiles count past bookings): STILL REAL, skipped: open PR #354 edits `modules/appointments/pages/appointments-root.tsx`.
- Other open-PR overlaps avoided: `patients/page.tsx` (#362, #370; its 4 stat tiles also stack one per row on a phone, same as the POCT finding below), login, checkout-client, billing/admin files.
- Everything else already carries a FIXED/VERIFIED mark with evidence; page-level overflow is 0 at 390px on dashboard, patients, orders, poct, follow-up, settings, inventory.

## New real findings (fixed here)
1. **POCT "Abnormal 0 / Require attention" tile was hardcoded** (`app/(routes)/poct/page.tsx`, `<div>0</div>`), never computed. It tells staff there is nothing abnormal whatever the results are. Results and any flags belong only in the Lab tab, so the tile is removed (no critical-result warning outside Lab).
2. **POCT stat tiles stacked one per row on a phone** and pushed the test list below the fold. Now 3 compact tiles in a row (hint lines and icons hidden below `sm`); `sm`+ keeps the hints and icons, 3 columns instead of 4.

Screenshots: `.ai/screenshots/task-814/{before,after}/poct-390.png`.

## Noted, not fixed
- Follow Up tabs wrap ("Sent" on its own row) at 390px: cosmetic, not changed.
