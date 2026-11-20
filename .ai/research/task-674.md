# Task 674 — failing tests on current dev

Base: origin/dev 12df445. Fake data, dev Medplum :8113 only, one dev server on :3210 (killed afterwards).

## Unit (`bun test tests/unit`): 2 failures -> 0 (1036 pass)
| Test | Verdict | Fix |
|---|---|---|
| task643-checkout-invoice: void/delete of another clinic's invoice | Stale test. Task 645 made foreign invoice ids a 404 (`Invoice not found.`) instead of `Access denied`. | Test expects `/Invoice not found/`. |
| task639-scheduling-slots: foreign schedule | Stale test. Caller-supplied schedule reference is a 403 `Schedule unavailable in current clinic` (Task 422 rule 2). | Test expects that message. |

## Browser gate (`e2e/scripts/run-low-memory.mjs`, 9 batches)
Run 1 was stopped by the RAM guard (available < 2.6 GiB with a 2 GB dev-server heap) and is not counted. Run 2 (heap 1280 MB) gave 19 failures. Each was then re-run alone against a fresh server.

Real, repeatable (all stale tests, no app bug):
- dashboard-load-errors (2): Task 647 `describeFetchError` shows the thrown message (`Failed to fetch appointments/consultations`), so the spec's old text was stale. Selectors updated.
- feedback + module-toggle (+ poct/xray/time-chit/phase2/3 via shared helper): the specs flip `organization-enabled-module-ids` directly in Medplum, which bypasses `invalidateModuleIdsMemo`. The Task 547 5 s memo (`lib/server/module-ids-memo.ts`) then serves the old value (Feedback trigger absent, "PACS is not enabled" still shown, POCT region missing). Added `settleModuleMemo()` (5.5 s) after every toggle and restore. The app memo is unchanged (it is correct in-app, since admin-service invalidates it).
- poct "Per-device keys" and xray "Per-device keys": Task 572 made the JSON receive routes (`/api/labs/receive`, `/api/imaging/receive`) answer foreign/unknown orders 404 with zero writes. The HL7 message route stays 403. Expectations updated.
- xray "module disabled after an order exists": Tasks 517/518 reject an imaging order with no encounter and no `xray` block when pacs is on (409). The "generic" order now carries `encounterId`.

Env flakes (passed on re-run, no change): api patients CRUD, dispense-checkout concurrent (ECONNRESET/socket hang up while next-server recycled), composer-plan-unsaved, save-state, poct sim/lab-subscription (180 s timeout), workflow 03/06 (ERR_CONNECTION_REFUSED while the server was down; with a 2 GB heap all 9 steps passed). Cause: the next-server worker gets recycled/OOM-ed near its heap cap when production shares the 8 GB box. Use `UCC_DEV_HEAP_MB=2048` and a fresh server per batch.

Final: every spec that failed passed on re-run (unit 1036/0). No app code changed. Not verified: one uninterrupted full-gate pass; the box could not hold it under the RAM guard.
