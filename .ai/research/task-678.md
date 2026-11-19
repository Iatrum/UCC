# Task 678 — Checkout / Analytics load (perf)

Method: production build (`next build --webpack`, `next start -p 3678`, one server, 3 GB heap cap), dev Medplum :8113,
fake E2E data, headless Chromium (Playwright), cookie session. A/B = baseline build (origin/dev 12df445) vs patched build,
one server at a time. Scripts live outside the repo (/tmp/b678). Usable = checkout: "Totals" card rendered; analytics: KPI
cards ("Pesakit hari ini") visible; dashboard/patient: FCP. 1 warm-up + 9 warm runs (task asked for 5; more used because the
harness is bimodal), median reported.

## Findings
### Checkout (`/orders/checkout/[id]?patientId=`)
- Client waterfall was serial: `/api/orders` (≈190–280 ms) → then `/api/billing` + `/api/consultations/plan`. The invoice lookup
  needs only the consultation id and the draft-plan read only the patient id, which the link already carries.
- `GET /api/orders` read the consultation, then the patient *serially*, and the patient read ran 4 extra searches
  (AllergyIntolerance, Condition, MedicationStatement, last Encounter) whose results checkout never renders (grep: no
  `medicalHistory`/`lastVisit` use in checkout-client or the document renderers; checkout is the route's only GET caller).
- Request count unchanged (62 incl. Next RSC prefetches); transfer ≈548 KB unchanged; no heavy eager bundle on this page.

### Analytics (`/analytics`)
- Server work is already bounded/parallel/cached (page HTML 15–75 KB in ≈20–70 ms cold on fake data, `/api/analytics/summary`
  ≈7 ms warm, clinical cold ≈670 ms but it is a lazy tab). Summary data streams via Suspense; no client fetch for the default tab.
- Largest client chunk is recharts (≈125 KB gzip, `9869-*.js`) pulled by summary-tab. I tried `next/dynamic` (ssr:false,
  same-size placeholders): no measurable gain (median 470 → 512 ms, within noise, +2 requests) → **reverted, not shipped**.
- With the tiny fake dataset analytics is ≈470 ms usable, so the 1170 ms seen in Task 672 is data-volume dependent (Medplum
  searches in `lib/analytics/queries.ts`) and cannot be reproduced here without a large seeded dataset. No change made.

## Changes
1. `checkout-client.tsx`: start billing + plan requests together with the order request when the link has `patientId`; if the
   order response resolves a different patient the speculative plan result is discarded and re-fetched. Totals/auto-deduct logic untouched.
2. `app/api/orders/route.ts` GET: read patient concurrently with consultation when `patientId` is given (only used if it equals
   the consultation's patient, clinic check still applied inside `getPatientFromMedplum`), and skip medical-history searches.

## Results (median)
| Screen | Metric | Before | After |
|---|---|---|---|
| `GET /api/orders` (curl, 8 warm) | total | ≈92 ms | ≈62 ms |
| Checkout | usable (harness, 9 runs) | 1171 ms | 1142 ms (bimodal: 4/9 runs ≈700–780 ms vs 1/9 before) |
| Checkout | usable (in-page MutationObserver, 7 runs) | 741 ms | 738 ms |
| Checkout | LCP | 808 ms | 796 ms |
| Checkout | critical path in a single trace | orders 418→647, plan→730 | orders 392→581, plan→627 |
| Analytics | usable / LCP | 475 / 276 ms | 506 / 248 ms (code unchanged; noise ±40 ms) |
| Dashboard | FCP=LCP | 184 ms | 168 ms (unchanged code) |
| Patient profile | usable / LCP | 248 / 524 ms | 232 / 516 ms (unchanged code) |

Honest summary: on local fake data the browser-level gain for checkout is small (one removed round trip ≈ 60–100 ms on the
critical path, mostly hidden by hydration time ≈330 ms); the API gain is measurable (−30 ms, −4 Medplum searches). The
larger benefit should show with real network/Medplum latency. Dashboard/patient show no regression (code untouched).

## Verification
`tsc --noEmit` clean. `bun test tests/unit/task4* task5* task6*`: 488 pass, 2 fail — the same 2 fail on unmodified origin/dev
(clinic-scoping invoice void; generateSlots cross-clinic), unrelated.
