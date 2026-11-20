# Task 696 — page-load perf (patient profile, Documents tab, inventory, appointments)

Method: production build (`next build --webpack`, `next start -p 3696`, one server at a time, 3 GB heap cap), dev Medplum :8113, fake
data (1 patient checked into the queue, 3 consultations with MC documents, 8 appointments; `task-696/seed.cjs`), headless Chromium
(Playwright), cookie session, 1440×900 viewport. Baseline = origin/dev `b22d32e` build; "after" = this branch build. Both builds
alternate on the same machine/server slot, 3 rounds × (1 discarded warm-up + 8 warm runs) = 24 warm runs each, median of pooled runs
reported. Scripts: `task-696/bench.cjs` (usable + LCP via PerformanceObserver), `requests.cjs` (request list), raw output `raw-*.jsonl`.
"Usable" = the thing the user needs is on screen: profile = "Consultation History" tab present; Documents = both lists finished loading
(no "Loading…" text, empty/list state shown); inventory = a medication row; appointments = a booked appointment row.

## Before / after (same machine, same runs, medians of 24 warm runs)

| Screen | Usable before | Usable after | LCP before | LCP after | Requests b/a | KB transferred b/a |
|---|---|---|---|---|---|---|
| Patient profile, opened from queue (soft nav) | 418 ms | 410 ms | n/a (soft nav) | n/a | 22 / 11 | 42 / 33 |
| Patient profile, hard load | 384 ms | 391 ms | 380 ms | 392 ms | 67 / 56 | 30 / 21 |
| Patient **Documents tab** (hard load + tab) | **763 ms** | **694 ms** | 436 ms | 416 ms | 63 / 62 | 22 / 22 |
| Inventory list | 379 ms | 361 ms | 344 ms | 360 ms | 49 / 49 | 23 / 23 |
| Appointments | 419 ms | 460 ms | 80 ms | 88 ms | 60 / 60 | 27 / 27 |

Per-round usable medians (before → after): Documents 1216,726,773 → 786,647,728; profile/queue 388,442,418 → 416,446,402;
inventory 451,384,377 → 424,348,361; appointments 423,418,443 → 539,402,429. The box is shared and noisy (±40–60 ms, one slow
outlier round); only the Documents tab shows a gain bigger than noise. Inventory/appointments/profile code is unchanged
(differences are noise); appointments +41 ms is one outlier round (539), the other two rounds are −16/−14 ms.
API-level (curl, warm, median of 20, in-process): `GET /api/documents` 54 → 37 ms, `GET /api/referrals` 54 → 36 ms (−30 %).

## Root causes found (with traces)

1. **Documents tab: two list APIs over-fetch.** Opening the tab mounts `ReferralMCSection` + `PatientDocuments`, which call
   `/api/referrals?patientId`, `/api/documents?patientId` (+ `/api/organization`). Both routes only use the patient read as a clinic
   guard (`if (!patient) 404`) but called `getPatientFromMedplum` with its default `includeMedicalHistory: true`, i.e. 4 extra Medplum
   searches (AllergyIntolerance, Condition, MedicationStatement, Encounter) whose result is discarded. Same pattern Task 678 fixed for
   `/api/orders`. **Fix:** pass `{ includeMedicalHistory: false }` (the clinic check is unchanged and still runs first; response bodies
   identical). 8 Medplum searches removed per Documents-tab open.
2. **Profile: per-row Link prefetch.** In the production build every `<Link>` in the viewport prefetches its route. The consultation
   history rows ("View"/"Edit", plus "Open full") produced 2 RSC requests per consultation (dynamic server renders, each re-running
   auth/clinic resolution) — it scales with history length. They compete with the page's own `/api/*` calls (HTTP/1.1 on localhost has
   a 6-connection limit; on production HTTP/2 the contention is lower but the server renders still happen). In the trace the three
   Documents requests started at ≈493 ms behind ≈20 prefetches. **Fix:** `prefetch={false}` on those 4 links (Next 16 docs: `false` =
   no viewport and no hover prefetch). No markup/visual change. Cost: clicking View/Edit renders on demand, as dynamic routes already
   do beyond their loading boundary. Soft-nav profile open dropped from 22 to 11 requests and 42 → 33 KB; hard load 67 → 56 / 30 → 21 KB.
   Time effect on this 3-consultation fake patient is within noise; it should matter more on patients with long histories (not
   reproducible here without a large dataset).
3. **What is NOT the problem.** Inventory (client page, one `/api/inventory`, 8.7 KB) ≈ 360 ms and appointments (one search, 74 ms
   server) ≈ 420 ms are dominated by JS download + hydration (~300 ms before the first client fetch is issued: `/api/auth/*` → page
   data). LCP is already 80–390 ms. No heavy client bundle is on their critical path; the fix would be restructuring the client fetch
   into a server component, which is a UI-affecting change and out of scope.

## Not changed (blocked by open PRs) — follow-ups
- `modules/appointments/pages/appointments-root.tsx` (PR #338): the list is fetched in a client `useEffect` after hydration
  (`fetch('/api/appointments')`), ≈ 300 ms hydration + 70–90 ms fetch. Fetching in the server page (like the dashboard queue) or
  starting the request before hydration would remove the post-hydration round trip. Needs #338 to merge first.
- `referral-mc-section.tsx` (PR #338): its three data loads (`getPatientReferrals`, `fetchOrganizationDetails`, then lazy template
  fetches) start only after the lazy chunk mounts. Moving referrals+org into the profile server page, or `import()`-preloading the two
  lazy tab chunks (5189/8608) when the profile mounts, would remove ≈ 1 chunk round trip. The chunk preload can be added in
  `patient-profile-workspace.tsx` after #338 lands (not done here to avoid overlapping its `lib/org.ts` change).
- Sidebar `<Link>`s double-prefetch ~10 routes per page (each twice, 2 router-state keys); nav is off limits per project rules.
- Profile page links `check-in`/`edit` (`page.tsx`) still prefetch (2 links, cheap; left alone).

## Verification
- `bun run lint` (tsc + clinic-admin check): clean.
- `bun test tests/unit/task696-list-gets.test.ts task482-route-containment task601-perf`: 23 pass. The new test fails on origin/dev
  routes (2 of 3, history searches present) and passes with the fix; it also asserts a foreign-clinic patient is 404 with no searches.
- Files touched: `app/api/documents/route.ts`, `app/api/referrals/route.ts`, `patient-profile-workspace.tsx` (Link props only),
  new test. None is in PR #334 or #338's file lists (checked with `gh pr view --json files`). Composer code untouched.
- Server on :3696 killed after each run; no server left running.
