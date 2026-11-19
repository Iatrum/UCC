# Task 685 — independent review of Task 684 (PR #335, head c12022d)

Method: two production builds (`next build --webpack`): origin/dev (12df445) and PR head; one `next start` at a time (:3685, 3 GB heap),
dev Medplum :8113, fake patient + encounter, headless Chromium cookie session, 9 warm runs after 1 warm-up per sample, 3 interleaved
rounds (base, PR, base, PR, ...). Usable = checkout "Totals" visible / analytics "Pesakit hari ini" visible. 2 shared cores: absolute values drift.

| Screen | Metric | origin/dev (rounds) | PR head (rounds) | median of rounds |
|---|---|---|---|---|
| Checkout | usable | 1179 / 1184 / 1251 | 704 / 662 / 643 | 1184 -> 662 ms |
| Checkout | LCP | 788 / 804 / 944 | 700 / 608 / 620 | 804 -> 620 ms |
| Analytics | usable | 418 / 428 / 562 | 473 / 434 / 511 | 428 -> 473 ms (noise, rounds +55/+6/-51) |
| Analytics | LCP | 244 / 264 / 276 | 236 / 252 / 292 | 264 -> 252 ms |
Requests per page unchanged (checkout 62, analytics 50-51). PR won every checkout round.
Note: the PR contains Task 678 + 684, so the table above is vs origin/dev (the PR body's "before" was the 678 branch).

## Review findings
- No UI change: only a `<script nonce>` element is added to the checkout page; markup/CSS/components untouched. No sidebar/nav change.
- Same three GETs / same API routes (auth + clinic scoping on the server); browser check: exactly 3 api calls (orders, billing, plan) with
  and without `?patientId=`, no console/CSP errors, no leftover `window.__uccCheckoutPreload`. Mismatched/malicious ids -> same error state as base.
- Fixed (small): the preload bypassed `fetchWithTimeout`'s 15 s abort (headers + body), so a stalled body would spin forever instead of
  error + Retry. The inline script now passes `AbortSignal.timeout(15000)` (guarded by try/catch for old browsers). Unit test added.
- `/api/orders` speculative patient read: clinic-scoped, unhandled rejection suppressed, only used when ids match. OK.

## Verification (PR head + fix)
- `tsc --noEmit` clean. `bun test tests/unit`: 1038 pass / 2 fail; the same 2 fail on unmodified origin/dev
  (clinic-scoping invoice void; generateSlotsForSchedule other clinic) -> pre-existing.
- e2e on the production build (localhost:3685, `dispense-checkout*.spec.ts`): 8 passed, 1 skipped (pre-existing "needs #279").
  Covers UI checkout payment, single stock deduction, idempotent retry/reload, concurrent checkout, void restore. Re-run after the fix: same.
- Tip: e2e API context needs `http://localhost` (Secure cookies are not sent to 127.0.0.1 by APIRequestContext).
