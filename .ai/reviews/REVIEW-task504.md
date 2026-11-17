# Review: Task 504 (checkout stock feedback + billing ownership check) — Task 505

Reviewed commit f634428 (local branch `ai/task-504`, built on `origin/ai/task-458` 10da203 and `origin/dev` 3bf71a6).

**Verdict: APPROVE**

## Findings
- **Process:** when this review started, `origin/ai/task-458` held only Task 458 and Task 504 was local (`ai/task-504`). The 504 commits reached the remote while the review ran (f634428), and this review is a fast-forward on top. PR #279 is not a draft and its title/body still describe Task 458 only; update the body to mention Task 504 before merging.
- **Merge with origin/dev:** `origin/dev` (3bf71a6) is an ancestor. `git diff origin/dev HEAD` equals the three-dot diff (14 files, all Task 458/504). Nothing from dev was lost; CHANGELOG and UX-FINDINGS conflicts kept both sides.
- **Stock fields:** `/api/billing` returns `stockNegative`, `stockUnresolved` (from `result.stock.unresolved`) and `stockError` (from `dispenseError`). Types match `billing-service.ts` / `dispense-service.ts`. `buildStockNotice` shows them on `/orders` after redirect (sessionStorage), severe when deduction failed or a line was ambiguous.
- **No separate dispense step:** none added; deduction stays inside the single POST /api/billing. The stock preview (`GET /api/inventory`) is read-only; the checkout UI only shows hints and a warning.
- **Confirm dialog:** "This saves the invoice and deducts stock for N item(s). Continue?" (or "This saves the invoice." when no stock items). Accurate; the old "irreversible" wording is gone.
- **e-Invoice:** button is `disabled` with an "not available yet" note and `aria-describedby`.
- **Invoice number:** labelled "Preview number — Confirmed when the invoice is saved."
- **Ownership check:** `assertCheckoutConsultationPatient` runs before the main try, so a foreign id writes nothing and creates no billing-exception Task. Missing/foreign/mismatched consultation or patient gives 404; no clinic gives 403 (Task 422 rule). Unit tests assert zero `create`/`update` calls for 5 cases.
- **Tests:** meaningful (real route with a fake Medplum that records writes; stock matching, summing and ambiguity; notice building).
- **Gates:** `bun run lint` (tsc + clinic-admin check) pass; `bun test tests/unit` 587 pass, 0 fail. No browser or `check-all.sh` run (no baseline results on this box).
- **Scope:** no sidebar/nav, composer, Lab/POCT, Firebase or secrets changes.

## Non-blocking notes
- UX-FINDINGS marks #1, #2, #5-#8 "FIXED (Task 504)" but those fixes came from other merged tasks (e.g. 430, 432, 446); only the attribution is off.
- POST /api/billing calls `requireClinicAuth` twice (once for the ownership check); harmless extra auth lookup.
- Low-stock warning is conservative when a visit is re-run (on-hand already includes the earlier deduction), as the research note says.
