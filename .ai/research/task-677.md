# Task 677 — independent review of Task 676 (PR #331)

Re-ran on production builds (`next build --webpack` + `next start`, port 3677, fake data, dev Medplum :8113): origin/dev `12df445` vs PR head `6908059` (app code identical to `aa416dd`; 676 only added docs). 5 warm runs after one warm-up per route, two full runs per build, in two modes: original (back-to-back) and `UCC_BENCH_SETTLE=1` (networkidle between runs). Cell = usable median (min-max) · median LCP / document TTFB, ms.

## Dashboard and queue (the screen the PR changes)

| Mode | dev r1 | dev r2 | head r1 | head r2 |
|---|---|---|---|---|
| original | 548 (513-590) · 104/28 | 585 (524-662) · 112/36 | 459 (427-502) · 216/96 | 520 (449-566) · 208/110 |
| settled | 1098 (606-1232) · 120/35 | 671 (640-1153) · 112/25 | 451 (394-524) · 144/32 | 510 (460-641) · 136/40 |

## Verdict
- Usable win confirmed: head 451-520 ms vs dev 548-1098 ms in every run. Other screens are within noise (patients, profile, composer, billing, checkout, inventory, analytics all overlap; no screen regressed beyond run-to-run spread).
- TTFB/LCP gap in the original harness reproduces (head TTFB ~100 vs ~30, LCP ~210 vs ~108) and mostly disappears with a settle step (TTFB 32/40 vs 35/25). Task 676's harness-contention explanation is confirmed.
- Correction: settled LCP is not exactly level. Head was ~+20-25 ms higher in both of my runs (136-144 vs 112-120). The PR said the sign flips; in these runs it did not. Absolute LCP is still ~140 ms and paints with the shell, so no action.
- Page-level numbers vary strongly between sessions (dev dashboard usable 548 to 1098), so only same-session comparisons mean anything.

## Code review
- Server fetch is capped at QUEUE_TIMEOUT_MS (10 s) and any error returns null, so DashboardClient falls back to the client loader (loading text, then error + Retry via QueueState). loading.tsx is the Suspense fallback meanwhile, so no blank/stuck page. A refetch failure keeps the list and shows the banner (e2e).
- Composer change is only the idle-deferred catalog load (`onLoadCatalogs`), covered by composer-plan e2e.

## Checks
- `tsc --noEmit`: clean. Unit (task480, appointment-mutation-containment, task591, task639, triage-queue-pagination): 108 pass.
- e2e on the PR build: composer-plan (5), dashboard-load-errors (5), task476-queue-confirm (2): 12 pass. Run with `UCC_BASE_URL=http://localhost:3677`; with `127.0.0.1` the request fixture lost its Secure session cookie (401) on dev and head alike, so that is a harness quirk, not a regression.
- Not directly testable: the server-side-null path (needs Medplum failing at render time); verified by reading the code.
