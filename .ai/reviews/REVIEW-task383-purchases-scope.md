# Review — Task 383 (PR #259): purchases clinic-scoped search + non-PO 404

Reviewer: independent (Task 384). Review only; no code changed.
**Verdict: APPROVE** (two minor, non-blocking notes).

## Scope check
Diff vs `origin/dev` is exactly 4 files: the research note, `app/api/purchases/route.ts`,
new `lib/server/purchase-orders.ts`, and the new unit test. No composer, Lab/POCT, nav, auth,
Firebase or config changes.

## Clinic isolation — OK
- List search now sends `identifier=clinic|<clinicId>` AND `code=...` server-side, so another
  clinic's orders can't crowd out results. `clinicId` comes from `requireClinicAuth`, not the request.
- In-memory `isClinicPurchaseOrder` re-check kept as defence in depth (test proves it drops
  foreign and non-PO rows even if the server returned them).
- GET ?id / PATCH / DELETE use `isClinicPurchaseOrder` (code AND clinic) -> 404 for foreign clinic
  or same-clinic non-PO Basic. Fixes the earlier 500 and, importantly, DELETE can no longer remove
  a non-PO Basic. Foreign and non-PO give the same 404 (no existence leak).
- POST/`toBasic` unchanged and still writes both code and clinic identifier.

## Paging — OK
`searchResourcePages` (exists in @medplum/core, signature `(type, query, options)`) follows `next`
links; 500 cap removed; `_count=100`; `_sort=-_lastUpdated` kept; `cache: 'no-cache'` avoids stale lists.
Test covers 600 foreign + 250 own orders -> exactly 250 returned across 3 pages.

## Verification run
- `bun test tests/unit/task383-purchases-scope.test.ts`: 6 pass / 0 fail.
- `bun test tests/unit`: 229 pass / 0 fail.
- `tsc --noEmit`: no errors mentioning purchases.
- Not run: live dev-Medplum check (see notes).

## Notes (non-blocking)
1. Tests use a fake Medplum client, so the real `identifier=clinic|<id>` search on Basic against
   Medplum was not exercised. FHIR R4 Basic defines `identifier`, so it should work; a quick
   smoke test against dev Medplum (:8113, fake data) is a cheap follow-up.
2. PATCH's new 404 for a non-PO Basic has no dedicated test (GET and DELETE do), and the DELETE
   test accepts `[403, 404]`; tightening to 404 and adding a PATCH case would be nicer.
   Also: `node_modules` in my worktree resolved @medplum/core 5.1.13, not 5.2.8; the API used is
   stable across both, but worth confirming in CI.
