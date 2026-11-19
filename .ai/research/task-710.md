# Task 710 — warm page-load measurements (docs-only; no safe fix found)

## Method
- Production build (`next build --webpack`) of `origin/dev` @ b22d32e, `next start -p 3731`, `NODE_OPTIONS=--max-old-space-size=3072`, dev Medplum `:8113`, fake data (2,791 patients, 16 appointments, a handful of billing items).
- Playwright Chromium, signed-in `doctor@ucc.local` session, 1440x900. Per screen: 1 discarded warm-up + 8 samples, median reported. `bench.cjs` in this folder; raw samples in `raw-base.jsonl`.
- **usable** = the data the user came for is visible (patients: stat cards + first table row; appointments: table header and no "Loading appointments"; analytics: KONSULTASI figure; orders: "Ready to bill" row; settings: profile resolved). **LCP** via PerformanceObserver. **req** = all browser requests (incl. JS chunks and `<Link>` `_rsc` prefetches); **api** = `/api/*` + Medplum origin.
- The VPS also runs production, so noise is high (load average ~3); ranges are shown.
- Because no code change is proposed, there is no PR column and no dev/PR interleaving: the table is the `dev` baseline only.

## Baseline (origin/dev)
| Screen | usable ms, median (min–max) | LCP ms | browser req | API req |
|---|---|---|---|---|
| Patients list | 477 (386–602) | 88 | 91 | 4 |
| Appointments | 325 (264–351) | 64 | 69 | 3 |
| Analytics | 209 (168–888) | 108 | 51 | 2 |
| Lab/Orders (`/orders`) | 278 (241–316) | 304 | 59 | 3 |
| Settings | 217 (189–290) | 76 | 59 | 3 |

(LCP is the page heading/text on all but Orders, so it is earlier than "usable"; Orders' LCP is its table.)

## What the evidence shows
1. **Server APIs are not the bottleneck.** Direct authenticated GETs (median of 7): `/api/patients?stats=1` 48 ms, `/api/patients?page=1&pageSize=25` 34 ms, `/api/appointments` 27 ms, `/api/auth/me` 13 ms.
2. **No fetch waterfall beyond the auth gate.** Patients and Appointments already issue their data calls in parallel (stats + list start together). The only serial step is `authLoading` (`/api/auth/me` + `/api/auth/medplum-session`, ~15–35 ms) before the data effect fires; the page's own fetches only start after React re-renders. Removing the gate could save at most ~35–60 ms, which is below the run-to-run spread (patients 386–602 ms), and the gate's purpose (not firing before the session cookie is settled) has not been verified, so I did not change it.
3. **`<Link>` prefetch is not the cause (hypothesis disproved).** Patients fires ~50 `_rsc` prefetches (25 rows × profile + check-in). Aborting all `_rsc` requests (`BLOCK_RSC=1`) did *not* help: medians 489/494/513 ms vs 439/363/424 ms with prefetch on (3 interleaved blocks of 8). Setting `prefetch={false}` would therefore be a guess with no gain.
4. **Bundles are uniform.** ~29–30 JS chunks, 307–434 KB encoded per screen (Analytics largest at 434 KB, charts); the shared shell dominates. No route has a screen-specific oversized bundle worth splitting for a measurable win.
5. **Analytics** (209 ms median) already streams: heading paints at once and the summary comes from Suspense-streamed bounded queries. The 888 ms max is a single outlier.
6. Dashboard and patient Documents/profile are covered by #339 / #341 and were not touched.

## Conclusion
All five screens are 200–480 ms warm. The slowest is Patients (~480 ms), and its time is spread over document + hydration + auth + two parallel ~35 ms server calls + render; no single dominant waterfall, duplicate fetch, over-fetch or oversized bundle was found. The only candidate change (start data fetches without waiting on `authLoading`) is within noise and touches auth ordering, so no fix is proposed. Docs-only PR.

## Follow-ups worth a separate task (need cold-start/real-network numbers, not this warm LAN setup)
- Cold first-visit cost (JS ~310–430 KB per screen) on a mobile network.
- Verify why `authLoading` gates the Patients/Appointments data effects before deciding whether to relax it.
