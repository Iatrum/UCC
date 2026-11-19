# Task 684 — remaining checkout / analytics client cost (perf, PR #335)

Method: production build (`next build --webpack`, `next start -p 3684`, one server, 3 GB heap cap), dev Medplum :8113, fake e2e
data, headless Chromium (Playwright, cookie session). Harness lives outside the repo (/tmp/b678: bench/prof/tl/loaf/wf.cjs).
Usable = checkout: "Totals" card visible; analytics: KPI "Pesakit hari ini" visible; dashboard/patient: FCP. Each sample = 9 warm
runs after 1 warm-up. The box has 2 cores shared with production and other agents (load avg 2.5–5), so absolute numbers drift ±50 %
between invocations (the same baseline measured 750 ms and 1290 ms on different runs). Therefore A/B was **interleaved**
(base, after, base, after, …, one server at a time) and the median of per-round medians is reported.

## Measurements (before any change, origin/ai/task-678-perf build)
- JS per route (browser, gzip): checkout 31 files / 330 KB (raw 1.08 MB); analytics 30 files / 434 KB (raw 1.43 MB; recharts chunk
  `9869-*` 125 KB gzip is the only large route-specific one). Next 16 `build` prints no per-route sizes, so numbers are from loaded resources.
- Checkout request waterfall: scripts finish ≈265 ms; the first page fetch (`/api/auth/me`) starts at ≈392 ms and the three
  critical reads (order / invoice / plan) at ≈458 ms, i.e. **after hydration**; they take 113–324 ms, so Totals renders at ≈720–830 ms.
  Long animation frames: 133 ms (104 ms, react-dom chunk `9324` executing/hydrating) — the client reads cannot start earlier
  because they live in a `useEffect`.
  Root cause: **client waterfall HTML → JS download → hydrate → effect → fetch → render**. Task 678 removed the order→plan serial hop but
  all three reads still started only after hydration, which is why the saved round trip was hidden behind ~330–450 ms of hydration.
- Analytics: summary data is already server-streamed (Suspense); KPI cards are in the streamed HTML at ≈420–500 ms (server query time),
  before the main-thread work. The remaining client cost is one 140–230 ms long task at ≈490–590 ms = React rendering the streamed
  Summary incl. recharts `ResponsiveContainer`s (event-listener in react-dom, `blockingDuration` ≈90 ms). It happens *after* KPIs are
  visible, so it affects interactivity (TBT), not usable/LCP. Task 678 already tried `next/dynamic` for recharts: no gain. No change.
- 60 RSC prefetch requests (sidebar links) and `/api/auth/me` + `/api/auth/medplum-session` run on every page; they belong to the
  shared shell / nav (out of scope: no sidebar/nav changes).

## Change (checkout only)
`app/(routes)/orders/checkout/[consultationId]/page.tsx` emits a tiny nonce'd inline script (`lib/billing/checkout-preload.ts`)
that starts the **same three GETs** (`/api/orders`, `/api/billing?…optional=true`, `/api/consultations/plan`) at HTML-parse time.
`checkout-client.tsx` takes those in-flight promises once on first mount (`takeCheckoutPreload`) instead of issuing its own.
- Same API routes → same `requireClinicAuth`, clinic scoping, responses. Only the start time moves; totals, invoice lookup,
  auto-deduct and idempotency code untouched. Retry/reload (`reloadKey>0`), client-side navigation (inline scripts do not run
  there), other ids, preload older than 15 s, network failure or no settle in 8 s → the normal `fetchWithTimeout` path.
- Safety: script only emitted when both ids match the FHIR id pattern `[A-Za-z0-9.-]{1,64}` (so `?patientId=` cannot inject), values
  JSON-encoded with `<` escaped, `nonce` from `x-nonce` (CSP unchanged). No patientId → nothing preloaded (as before).
- No visual/markup change besides the `<script>` element.

## Results (median usable ms / LCP ms; interleaved A/B, 9 warm runs per sample)
| Screen | Metric | Before | After |
|---|---|---|---|
| Checkout | usable (3 rounds: 1362/1291/1230 → 704/896/732) | 1291 | 732 |
| Checkout | LCP (1040/924/840 → 696/904/696) | 924 | 696 |
| Analytics (unchanged code) | usable / LCP | 481–502 / 256–272 | 493–543 / 264–308 (noise) |
| Dashboard (unchanged) | FCP=LCP | 208–212 | 192–212 |
| Patient profile (unchanged) | usable / LCP | 280–288 / 540–552 | 256–272 / 508–536 |
After won in each of the 3 checkout rounds. Absolute values were lower on quiet runs (base 750 ms) — the *relative* gain is the
meaningful number; on a quiet box expect ≈ −300 to −400 ms (critical path = max(hydration, API) instead of hydration + API).
Request count (62) and transfer (≈550 KB) unchanged; no console errors/hydration warnings.

## Verification
- `tsc --noEmit` clean. `bun test tests/unit/task684-checkout-preload.test.ts` 4/4 (URL parity with client, injection guard, one-shot/
  stale/mismatch, fallback). Related checkout/billing unit tests: 68 pass, 1 fail = `clinic scoping … void/delete of another clinic's
  invoice` which fails identically on unmodified origin/dev (see task-678.md).
- Existing checkout e2e on the production build (`dispense-checkout*.spec.ts`, incl. reload/retry-does-not-deduct-twice, concurrent
  checkouts deduct once, void restores): 8 passed, 1 skipped (pre-existing skip).
- Server killed; no extra processes left.
