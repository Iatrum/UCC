# Task 516 — Review of PR #290 (Task 515: imaging card layout + labs-imaging order form)

Verdict: **APPROVE** (no code changes needed).

## Checked
- **Card layout** (`components/imaging/imaging-results-view.tsx`): accession column `minmax(0,2fr)` with `min-w-0` + `truncate` + `title` tooltip, so it can't overlap Series. Viewer/PACS buttons are `col-span-full` with `max-w-full`, so they stay inside the card. Sound CSS-grid usage; the `data-testid="xray-open-viewer"` hook is kept.
- **Order form gate** (`labs-imaging/page.tsx`, `lib/imaging/order-entry.ts`): `pacs` on → pointer card to the Treatment panel (real path that mints the accession); off → generic form unchanged. Uses the same `resolveClinicIdFromServerScope` + `isModuleEnabledForClinic('pacs', clinicId)` pattern as `patients/[id]/page.tsx`, so it is clinic-scoped. Next 16 async `params` already handled.
- **Rules**: no sidebar/nav files touched; composer untouched; no Lab/POCT result or critical-warning changes; no manual POCT entry; Firebase untouched.
- **Tests**: `bun test tests/unit` 616 pass / 0 fail (incl. 3 new). `tsc --noEmit` has no errors in touched files.

## Non-blocking notes
1. The gate is UI-only. `/api/imaging/order` still accepts an accession-less order if called directly (pre-existing; the X-ray path requires `order.xray`). Consider a server-side rejection of non-X-ray imaging orders when pacs is on in a follow-up.
2. `.catch(() => false)` fails open to the generic form if the module lookup errors. Acceptable (old behaviour), but fail-closed would avoid accession-less orders on transient errors.
3. New unit tests for the page/card are source-string checks, not rendering checks.

## Not verified
- No browser/screenshot run (no dev server started, to protect production RAM). Layout verified by code reading only; visual check at narrow widths is recommended before merge.
