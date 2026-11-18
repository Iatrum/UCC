# Task 593 - snappiness round 2 (continues PR #317 / Task 591)

Method: `next build --webpack` + `next start -p 3210` (one server, `--max-old-space-size=3072`, killed afterwards), dev Medplum `:8113`,
fake demo clinic. A `--require` preload wraps `globalThis.fetch` and logs every FHIR call (start, ms, status, path) per request.
Headless Chromium (Playwright, wrapped in `timeout`) for the client side. The VPS also runs production, so wall-clock numbers are noisy
(same page 73-234 ms depending on load); **dependent-call depth ("waves") and call counts are the reliable metric**, wall ms are medians.

## 1. Task 592 review nit - consultation figures re-measured
Data now: clinic has 1601 encounters / 1884 patients (grown since 591). Same 100 fake patients (`/api/patients` pages 1-4).
Direct Medplum queries (per patient `identifier=clinic|X&identifier=firebase-patient|P&_count=1000` = truth; old code = default page of 20 clinic encounters):

| | encounters of the 100 patients | patients of the 100 with a consultation |
|---|---|---|
| truth (fixed query) | 74 | 71 (29 have none) |
| old code (clinic-wide default page 20) | 5 | 4 |

So the old profile showed an empty history for **96 of 100** patients (67 of the 71 who have one). The "45 of 100" in task-591.md was wrong;
corrected there. The old "4 to 71" ranges were this same 4 -> 71.

## 2. Profile page `/patients/[id]` - where the time goes (prod build)
Server side (warm, curl): ~70-110 ms, 15 FHIR calls, 68 KB HTML. `page.tsx` already runs patient/consultations/triage/appointments/modules in
one `Promise.all`; consultations are batched (one `encounter=a,b,c` search per child type, no N+1); no oversized `_include`/`_revinclude`.
FHIR waterfall before: 4 dependent waves (tenant: `Organization/<slug>` 404 -> `Organization?identifier` ; then Patient-history x4, which
waited for the tenant lookup although they only need the patient id ; plus encounter children). Critical path ~85 ms of ~110.

Client side (Chromium, document -> network idle): document ~330-410 ms, **34 JS chunks / 459 KB**, then a post-hydration chain:
`/api/auth/medplum-session` -> `/api/auth/me` -> composer bootstrap `/api/procedures`, `/api/catalogs?type=lab|imaging|document`,
`/api/inventory`, `/api/consultations/draft` (1.0-1.2 s after navigation), plus a `/settings?_rsc` prefetch. Each of those APIs costs
10-20 ms server time except `/draft` (6 FHIR calls, ~55-70 ms: auth/me twice, tenant x3, patient, DocumentReference).
Conclusion: there is no single server-side hot spot left for the profile; what users feel is the client bootstrap waterfall of the
composer (fetches on mount in `patient-profile-workspace.tsx`) and the 459 KB bundle. Both sit in/around the consultation composer, which
the rules forbid breaking, so they are **not changed here** (follow-ups below).

## 3. Dashboard / queue
`/dashboard` shell: ~15-20 ms, 0 FHIR calls, 37 KB, 31 JS chunks / 327 KB. After hydration the client fires `/api/appointments`,
`/api/queue`, `/api/orders/billable` in parallel (done ~700 ms after navigation, mostly JS load/hydrate). `/api/queue`: 4 FHIR calls in
3 dependent waves (tenant 404 -> tenant search, then the Encounter search) ~30-40 ms; the demo queue is empty today so payload is 30 B.
No N+1, one bounded Encounter search (`_count=200`, today's date range).

## 4. Changes (small, behaviour-preserving)
1. `lib/fhir/clinic-tenancy.ts` `findClinicOrganization`: start the identifier search together with the direct `Organization/<id>` read
   instead of after its 404 (the clinic id is normally a slug, so the read 404s). Direct read still wins when it succeeds; a failing search
   only surfaces if the direct read did not. Removes one serial hop from every tenant resolution (all clinic-scoped APIs).
   Clinic scoping is unchanged (same identifier query; no cross-request cache added, so nothing to key).
2. `lib/fhir/patient-service.ts` `getPatientFromMedplum`: the four history searches start as soon as the Patient read passed the clinic
   check, concurrently with the tenant lookup; the tenant is still awaited before returning (a tenant failure still yields `null`), and a
   patient of another clinic never triggers history queries.
Tried/not done: skipping the 404 read for non-UUID ids (84 test fakes model id == Organization id; still a follow-up); sharing one `/auth/me`
in `draftScope` (`medplum.getProfileAsync()` duplicates the memoised `loadMe`; fakes in tests use `getProfileAsync`).

## 5. Before / after (same method, same fake data)
| | before | after |
|---|---|---|
| /patients/[id] dependent FHIR waves / critical path | 4 / ~85 ms | 3 / ~60-70 ms (calls unchanged: 15) |
| /patients/[id] warm wall (curl median, noisy box) | 72-110 ms | 78-105 ms (within noise; load avg varied 0.5-1.2) |
| /api/queue waves / calls | 3 / 4 | 2 / 4 (median 38 -> 32 ms) |
| /api/consultations/draft median | 62 ms | 52 ms |
| /api/patients?stats=1 median | 48 ms | 40 ms |
| /dashboard shell | 17 ms | 15 ms |
Honest read: locally each FHIR hop is only 10-30 ms, so the gain is one hop (~15-25 ms) per clinic request; against the real
Medplum (higher RTT) it scales with RTT. The profile page did not get meaningfully faster on this box because the server part was already
small - the remaining latency is the client bundle + composer bootstrap waterfall.

## 6. Follow-ups (not done, need design/composer decisions)
- Defer/lazy-load the composer catalogs (`/api/procedures`, 3x `/api/catalogs`, `/api/inventory`) until the composer tab is used, or serve them
  from one `/api/composer/bootstrap` call (saves 5 requests; touches the composer -> separate reviewed task).
- Dynamic-import heavy workspace tabs (rich-text editor, lab/imaging views, documents) to cut the 459 KB first-load JS.
- `draftScope` second `/auth/me`; skip the guaranteed-404 `Organization/<slug>` read together with updating the test fakes.

Tests: `tests/unit/task593-perf.test.ts` (tenant overlap + precedence, patient history overlap, cross-clinic patient triggers no history,
tenant failure -> null). Full unit suite 739 pass; tsc (tsconfig.lint.json) clean; eslint clean on changed files.
