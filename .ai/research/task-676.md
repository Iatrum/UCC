# Task 676 — PR #331 dashboard LCP / TTFB "regression": root cause

## Verdict
No app-side regression exists to fix. The gap in the Task 672 table (LCP ~190 vs ~100 ms, TTFB ~100 vs ~25 ms) is a **benchmark artifact**: runs are back-to-back with no settle step, and #331 reaches "usable" sooner (queue is server-rendered), so the next navigation starts while the previous page's API calls (appointments, billable, etc.) are still being served by the same dev Medplum / Node server. That contention delays the browser's request (`requestStart` itself rises to 16-74 ms) and the first byte. With a settle step the dashboard is level with dev. Task 672's own note ("auth + queue run before the response head") was a hypothesis; measurement refutes it.

## Evidence (production build: next build --webpack + next start :3676, fake data, dev Medplum :8113)
1. **Server streams the shell before auth/queue.** Authenticated fetch, per-chunk arrival times (ttfb.cjs, median of 12): dev headers 23 ms; #331 head headers 27 ms, shell chunk 29 ms, queue content chunk 86 ms. loading.tsx is already a Suspense boundary, so the head is never blocked by the page's auth + queue ([loading.js](https://nextjs.org/docs/app/api-reference/file-conventions/loading), [streaming](https://nextjs.org/docs/app/getting-started/fetching-data#streaming)). The layout already awaits auth on both branches, and the page-level auth is memoised (authMemo), so it adds no Medplum round trip.
2. **LCP element is the header paragraph, painted with the shell.** nav.cjs (PerformanceObserver + element): LCP == FCP, element `P:Live clinic queue…` in dev and #331, never the queue.
3. **Tried the hunch: async child behind Suspense in page.tsx** (page synchronous, fallback = loading UI). Server chunk timing unchanged (shell 38 ms, content 83 ms); bench not better (dashboard TTFB 128, LCP 248, within noise). No-op because loading.tsx already does this. Reverted, not shipped.
4. **Contention test.** nav.cjs with a 300 ms settle: #331 TTFB 25-33 ms (dev 21-74). nav-noidle.cjs (no settle): dev TTFB 33-123, #331 80-184, reqStart up to 70. Same build, only the idle gap differs.
5. **Settled full benchmark** (bench.cjs with UCC_BENCH_SETTLE=1), two independent runs: dashboard TTFB dev 25/35 vs #331 34/24 ms, LCP dev 92/152 vs #331 176/116 ms (differences flip sign between runs = noise). Usable-time win kept: 596/1212 -> 436/396 ms.

## Results
Cells: usable median (min–max) · median LCP / document TTFB, in ms; 5 warm runs after a warm-up each.
### Original harness (back-to-back runs, as in Task 672)

| Route | dev | head |
|---|---:|---:|
| Login to dashboard | 962 (962–962) · 140 / 35 | 904 (904–904) · 160 / 33 |
| Dashboard and queue | 614 (470–1070) · 144 / 25 | 455 (290–709) · 156 / 78 |
| Patients list | 298 (272–392) · 160 / 74 | 219 (210–362) · 196 / 57 |
| Patient profile | 410 (385–453) · 408 / 76 | 422 (359–450) · 376 / 53 |
| Profile to Treatment search | 721 (637–741) · 448 / 84 | 569 (560–667) · 376 / 27 |
| Billing | 406 (327–480) · 356 / 44 | 548 (320–688) · 460 / 44 |
| Checkout | 546 (522–573) · 548 / 18 | 544 (511–996) · 536 / 18 |
| Inventory | 451 (277–570) · 368 / 25 | 318 (255–454) · 248 / 21 |
| Analytics | 1160 (1051–1474) · 232 / 26 | 994 (921–1009) · 156 / 22 |

### Settled harness (UCC_BENCH_SETTLE=1: networkidle between runs), run 1

| Route | dev-s1 | head-s1 |
|---|---:|---:|
| Login to dashboard | 913 (913–913) · 172 / 32 | 935 (935–935) · 108 / 27 |
| Dashboard and queue | 596 (567–606) · 92 / 25 | 436 (390–668) · 176 / 34 |
| Patients list | 233 (194–298) · 76 / 21 | 213 (169–285) · 72 / 18 |
| Patient profile | 375 (321–413) · 352 / 21 | 397 (290–429) · 368 / 18 |
| Profile to Treatment search | 657 (594–766) · 408 / 21 | 576 (498–833) · 348 / 19 |
| Billing | 383 (334–408) · 352 / 17 | 366 (302–398) · 344 / 18 |
| Checkout | 1053 (555–1077) · 620 / 16 | 1030 (970–1097) · 600 / 18 |
| Inventory | 388 (297–466) · 304 / 15 | 313 (288–475) · 320 / 15 |
| Analytics | 1085 (1051–1316) · 224 / 20 | 1057 (969–1080) · 212 / 18 |

### Settled, run 2

| Route | dev-s2 | head-s2 |
|---|---:|---:|
| Login to dashboard | 1159 (1159–1159) · 204 / 32 | 983 (983–983) · 200 / 30 |
| Dashboard and queue | 1212 (741–1397) · 152 / 35 | 396 (322–413) · 116 / 24 |
| Patients list | 243 (212–385) · 112 / 19 | 393 (276–661) · 316 / 25 |
| Patient profile | 443 (421–546) · 420 / 24 | 401 (308–505) · 416 / 26 |
| Profile to Treatment search | 742 (606–802) · 424 / 33 | 618 (547–904) · 380 / 24 |
| Billing | 448 (419–614) · 424 / 28 | 432 (368–520) · 392 / 35 |
| Checkout | 1019 (618–1047) · 608 / 18 | 1091 (1064–1115) · 696 / 26 |
| Inventory | 422 (271–459) · 352 / 17 | 418 (399–594) · 356 / 22 |
| Analytics | 1053 (990–1183) · 184 / 21 | 1154 (1086–1218) · 112 / 27 |

Per-run spread is large (dev dashboard usable 741–1397 in settled run 2), so single-column differences under ~100 ms are noise.

## Change
No application code change. Added the harness copies in `.ai/research/task-676/` (bench.cjs with the optional settle flag, nav.cjs, ttfb.cjs). Follow-up suggestion for Task 672's harness: use the settle flag when comparing branches that change how fast "usable" is reached.

## Checks
tsc --noEmit clean; tests/unit/task480-dashboard-queue.test.ts 8/8. Server killed (port 3676 free).
