# Task 547 — sidebar page latency (extends #302/#303 work)

## Measured floor (from KL VPS, 2026-11-18 ~02:05 MYT, given in the task)
- fhir.drhidayat.com healthcheck 44–58 ms; demo `/api/health` (no Medplum) 580–612 ms TTFB;
  every unauthenticated sidebar HTML 537–633 ms (median ~560). Vercel functions default to iad1
  (x-vercel-id sin1::iad1) → SIN→IAD→SIN ≈ 450–500 ms before any app code.
- Code cannot beat ~550 ms TTFB while functions stay in iad1; Medplum RTT from iad1 ≈ 220–280 ms/call.
  The region change (Vercel project setting, not done here) is requested in the PR.

## What changed (all fewer round trips; no behaviour change)
| Area | Before | After |
|---|---|---|
| requireClinicPageAuth / requireClinicAuth | getProfileAsync(/auth/me) → isPlatformAdmin(/auth/me) → Organization → PractitionerRole, all serial (4 RTT); `getMedplumForRequest` ran twice | one `/auth/me` (profile + admin), then Organization ‖ PractitionerRole (2 serial RTT, 3 calls), memoised per sha256(token) 10 s |
| Layout + page + 3 dashboard APIs | each repeated the chain | share the in-flight/memoised promise per token |
| Module toggle lookup | 3 admin Organization searches per page (root layout nav, feedback flag, module layout/page) | 1 per clinic per 5 s (invalidated on module write) |
| getConsultationsWithDetails | per encounter: read Encounter + 4 child searches + Patient read + clinic-wide Encounter search + 4 child searches (≈11N calls) | fixed ≈ 9–12 calls: patient `_id` search, `subject=`-filtered Encounter search (25 patients/search), children in batches of 100 |
| Tenant resolve | non-memo in getAllPatients / upcoming appointments / schedules | `resolveClinicTenantMemo` |
| Analytics | getMedplum → clinicId serial, whole page blocked | parallel; heading paints, cards/charts stream via Suspense |
| Sidebar pages | no loading boundary | `loading.tsx` for follow-up, orders, appointments, inventory, tasks (shared `PageLoading`) |

## Safety
- Memo keys are `sha256(token)|scope` (scope includes clinic id): no cross-user/clinic reuse; raw token never stored.
- Failures/denials are never cached; entries expire in 10 s (auth) / 5 s (modules); size-bounded (500).
- Strict module guards (`isModuleEnabledForClinicStrict`: accession/PACS) bypass the memo.
- Auth is still awaited before the layout renders children (streaming the page before auth would leak clinic content).
- Not touched: composer, Lab/POCT rules, Firebase Storage, sidebar/nav.

## Docs consulted
- Medplum search params (`_id`, comma OR on reference params, `_count`): https://www.medplum.com/docs/search/basic-search
- FHIR R4 search (OR via comma): https://hl7.org/fhir/R4/search.html#combining
- Next.js 16 loading.tsx / Suspense streaming: https://nextjs.org/docs/app/api-reference/file-conventions/loading
- Vercel function regions: https://vercel.com/docs/functions/configuring-functions/region

## Left for follow-up
- Single `/api/dashboard` (queue + appointments + billable): the auth memo already collapses the three auth chains; rewiring the client (Task 480 abort/error semantics) needs a browser pass.
- Patients/Inventory API consolidation; Analytics aggregates via `_summary`/`_elements` need a data-size review.
