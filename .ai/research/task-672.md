# Task 672 — Dashboard LCP regression after server-rendered queue

## Root cause
Task 665 made /dashboard an async Server Component (auth + clinic queue read). The route's loading.tsx fallback only contained Skeleton boxes (no text/image), so the first paint had no LCP candidate. The first real LCP element, the page description paragraph, only painted when the page chunk streamed in after auth + queue (LCP 276-464 ms in a probe vs FCP 84-132 ms from the sidebar). Before, the static client page painted its header at once.
Probe: PerformanceObserver largest-contentful-paint with element names, 3 warm loads ([LCP API](https://developer.mozilla.org/en-US/docs/Web/API/LargestContentfulPaint), [Next.js loading.js / streaming](https://nextjs.org/docs/app/api-reference/file-conventions/loading)).

## Fix
Shared `DashboardHeader` (title + description) rendered by both loading.tsx and the client dashboard. LCP element now paints with the first shell (probe: LCP == FCP, 116-180 ms). Queue stays server-rendered, usable gains kept.

## Remaining gap
Document TTFB is ~120 ms vs ~28 ms on dev because auth + queue run on the server before the response head; median LCP 188 ms vs dev 104 ms (Task 665 alone: 424 ms).

## Benchmark
Same harness as Task 665 (/home/dev/ucc-task-665-measure/bench.cjs): Playwright, next build --webpack + next start, warm-up + 5 runs, fake-data dev Medplum :8113.
Each cell shows **usable min / median / max · median LCP / document TTFB**, in ms.

| Route | Before `46488f8` | Current dev `12df445` | `claude/perf-591` (665 + 672 LCP fix) |
| --- | ---: | ---: | ---: |
| Login to dashboard | 1565/1565/1565 · 308/27 | 1085/1085/1085 · 104/29 | 1088/1088/1088 · 196/46 |
| Dashboard and queue | 763/1183/1808 · 308/25 | 604/635/647 · 104/28 | 404/504/615 · 188/92 |
| Patients list | 319/416/508 · 336/47 | 289/351/368 · 192/79 | 242/295/425 · 172/76 |
| Patient profile | 409/576/1167 · 544/159 | 411/511/544 · 448/65 | 421/480/560 · 444/75 |
| Profile to Treatment search | 636/829/1427 · 684/109 | 664/745/1680 · 500/99 | 559/600/908 · 368/25 |
| Billing | 538/599/1035 · 576/45 | 410/463/516 · 436/71 | 303/440/496 · 384/68 |
| Checkout | 1077/1132/1176 · 724/17 | 694/1037/1091 · 700/15 | 548/1040/1119 · 604/23 |
| Inventory | 378/451/570 · 404/17 | 360/396/428 · 348/21 | 236/296/420 · 220/22 |
| Analytics | 1281/1351/1450 · 688/16 | 1060/1090/1473 · 188/17 | 1055/1169/1662 · 160/38 |

Treatment click to editable search, excluding profile navigation, had medians of 128, 272, 210 ms in the same order.
