# Task 591 - measured snappiness audit

Method: `next build --webpack` + `next start -p 3210` (one server, `--max-old-space-size=3072`, killed afterwards), dev Medplum
`:8113`, fake demo clinic (100 fake patients). A `--require` preload wrapped `globalThis.fetch` to log every outgoing FHIR call
(method, status, ms, path). Numbers = curl `time_total` (server time incl. render) and FHIR call count per request; first request
after boot is cold. Local DB round trip is ~10-20 ms, so call *depth* matters more than the absolute ms here.
Docs: Medplum search (repeated params = AND, `_count`, `_elements`), FHIR R4 search "identifier" modifiers/repeats, Next.js 16 App Router.

## Baseline (origin/dev 51b9a58), warm unless noted
| Page / API | server ms | payload | FHIR calls |
|---|---|---|---|
| /dashboard | 23 (cold 164) | 37 KB | 0 (7 cold) |
| /patients (list shell) | 17-33 | 34 KB | 0 |
| /api/patients?page=1&pageSize=25 | 43-60 | 10 KB | 4 |
| /api/patients?stats=1 | 70-90 | 46 B | **8** (tenant resolved twice) |
| /patients/[id] profile | 100-135 | 68 KB | 15 (1 clinic-wide Encounter search) |
| /orders (billing list) + /api/orders/billable | 105-130 | 34 KB / 0.4 KB | 10 |
| /orders/checkout/[id] (shell) + /api/orders + billing + plan | 22 + 73-95 + 17 + 72 | 27 KB + 2.5 KB + 4 KB + 0.3 KB | 0 + 13 + 1 + 7 |
| /inventory (+ /api/inventory) | 15 (+18-33) | 26 KB (+8.8 KB) | 0 (+1) |
| /analytics (+ clinical/money/summary tabs) | cold 470-625 / 190 / 22, warm 7-10 | 73 KB, tabs 2-3 KB | 14-21 cold, 0 warm (cached) |
| /api/queue | 52-63 | 30 B | 4 |

Nothing exceeds 800 ms on a production build at this data size; the cold analytics tab (~0.5-0.6 s) is the slowest and is
already parallel, bounded and cached per clinic (Task 551), no N+1. Billable/checkout reads were already batched (Task 547).

## Root causes found
1. **Patient profile clinic-wide Encounter search (real bug + scale problem).** `getPatientConsultationsFromMedplum` searched
   `Encounter?identifier=clinic|X&_sort=-date` (default page of 20, full resources, no patient filter) and filtered by patient
   afterwards. Cost grows with the clinic's encounter count, and once 20 newer clinic encounters exist the patient's consultations
   fall off the page: **before the fix 45 of 100 fake patients showed 0 consultations although they have one; after: all of them**
   (`/api/consultations?patientId=` over the 100 patients: 5 -> 74 consultations, 4 -> 71 patients with history).
   Same function feeds the profile page, `/api/consultations`, and smart-text summary.
   Fix: send both identifiers server-side (`identifier=clinic|X&identifier=firebase-patient|P`, ANDed - the same predicate the
   post-filter used) with `_count=1000`. Clinic isolation unchanged (clinic identifier stays in the query and `matchesClinic` still runs).
2. **Duplicate tenant resolution** (`stats=1`, search page, count/page reads each resolved Organization+HealthcareService
   independently, ~4 round trips each): moved read-only count/page/search paths to `resolveClinicTenantMemo` (5 s, per client).
   `/api/patients?stats=1`: 8 -> 5 FHIR calls.

## After (same build method)
| | before | after |
|---|---|---|
| /patients/[id] FHIR calls / warm ms | 15 / 100-135 | 15 / 114-146 (same locally; payload now patient-scoped instead of 20 clinic encounters) |
| /api/patients?stats=1 FHIR calls | 8 | 5 |
| consultations returned for 100 fake patients | 5 | 74 |

Local time did not drop for the profile because the demo clinic is tiny; the gain is O(clinic encounters) -> O(patient encounters)
plus the correctness fix.

## Tried and reverted
Skipping the guaranteed-404 `readResource('Organization', <slug>)` when the clinic id is not a UUID would save one serial round
trip per tenant resolution, but 84 existing unit-test fakes model clinic id == Organization id, so it was reverted (could be a
follow-up together with updating those fakes).

## Not changed (no measured problem)
Analytics cold path (already bounded/cached), dashboard, inventory, checkout, billing list. Sidebar/nav, UI, composer untouched.
Unit: `tests/unit/task591-perf.test.ts` (search params; truncation regression with a paging fake client). Full unit suite 733 pass, tsc and eslint clean.
