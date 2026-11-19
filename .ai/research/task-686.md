# Task 686 — Slow-internet check, round 2

Builds on Task 647 (`.ai/research/task-647.md`; not redone: dashboard queue, checkout pay/load, inventory, billing/appointments tables, triage/check-in guards).
Method: production build (`next build --webpack`, `next start -p 3686`), dev Medplum :8113, fake data only. Playwright + CDP
`Network.emulateNetworkConditions` ≈ 400 kbps (50 kB/s each way), 400 ms RTT, cache disabled; fault injection with `page.route` (request never answered = "stalled")
and `offline` blips. Scripts: `.ai/research/task-686/{walk,fault,stall,composer,bench,mkdoc,login}.cjs`; raw output `fault-before.json`, `fault-after.json`, `bench-*.txt`.
Refs: MDN fetch/AbortController, Chrome DevTools Protocol Network.emulateNetworkConditions, React 19 effects docs, Next.js 16 App Router client components.
Untouched (open PRs): #331 (dashboard, patient profile workspace, composer), #334, #335 (checkout). Sidebar/nav untouched.

## Per screen result (throttled 400 kbps / 400 ms)
| Screen | Cold load (usable) | Stalled API | Offline blip | Verdict |
|---|---|---|---|---|
| Dashboard queue | ~10.5 s | Error "Queue is taking too long" + Retry (647) | n/a | OK, unchanged |
| Patient list + search | ~10.4 s | **Before:** "Loading..." forever, list gone. **After:** old rows kept, banner + Retry at 20 s | **Before:** table replaced by raw "Failed to fetch", no Retry, never recovered when back online. **After:** rows kept, Retry; typed text kept both times; recovers on Retry | Fixed |
| Patient profile + composer | ~2.6 s shell | n/a (SSR) | Add item while offline: status "Failed to save", item kept, Retry → "Saved (server)", exactly 1 POST 200 | OK, composer untouched |
| Billing list `/orders` | ~2.8 s | SSR list, unaffected | n/a | OK |
| Checkout payment | — | 647 timeout + Retry; pay POST guarded | — | OK, file belongs to #335 |
| Inventory | ~10.6 s | Timeout + Retry (647) | — | OK |
| Appointments (`/appointments`) | ~2.7 s | **Before:** "Loading appointments..." forever. **After:** timeout message + Retry at 20 s | — | Fixed |
| Documents / MC viewer (patient Documents tab) | ~2.6 s shell | **Before:** dialog stuck on "Preparing preview..." forever (template + organization fetch had no timeout). **After:** "The request timed out" + Retry at ~14.5 s | same path (network error → message + Retry) | Fixed |
| Settings → Document templates | ~10.9 s | **Before:** a failed load silently fell back to the default templates and Save was enabled, so a Save would overwrite the clinic's custom template. **After:** error + Retry, editor hidden until the real templates load | Retry recovers (verified) | Fixed (data-loss risk) |
| Analytics | ~2.7 s shell | **Before:** tab skeleton forever. **After:** "Sambungan perlahan: permintaan tamat masa." + existing "Cuba lagi" at 17.5 s | **Before:** raw "Failed to fetch". **After:** "Tiada sambungan internet." + Cuba lagi | Fixed |

No screen rendered a blank page on first load. No double submit seen (composer: 1 POST; writes were not given timeouts, see 647 rationale).

## Changes (reads only, no mutation timeouts)
- `lib/fhir/patient-client.ts`: list/search/stats via `fetchWithTimeout` (20 s).
- `app/(routes)/patients/page.tsx`: Retry (reloadKey), keep previous rows while refetching/failing (`resolveLoadView`/`showStaleBanner`).
- `modules/appointments/pages/appointments-root.tsx`: 20 s timeout, friendlier message (existing Retry in the table).
- `components/analytics/analytics-dashboard.tsx`: 20 s timeout and offline/timeout messages.
- `app/(routes)/patients/[id]/referral-mc-section.tsx` + `lib/org.ts`: 15 s timeout on template/organization reads; error + Retry inside both viewer dialogs. A template timeout does NOT silently print with the default template; a non-OK template response keeps the previous default fallback.
- `components/settings/document-template-editor.tsx`: load failure shows error + Retry (never offers defaults to overwrite saved templates).
- Tests: `tests/unit/task686-slow-net.test.ts`.

## Normal network (no throttle), warm runs, median of 6, ms until usable (before → after)
| Screen | Before | After |
|---|---|---|
| Appointments | 454 | 461 |
| Patient list (first row) | 593 | 553 |
| Analytics (charts drawn) | 442 | 526 |
| Settings/documents (editor visible) | 466 | 422 |
| Patient Documents tab (Generated Documents visible) | 968 | 1016 |
Differences are within run-to-run noise (spread of runs ~±100–300 ms); no regression.

## Not done / left
- Mutating POSTs still have no timeout (aborting does not cancel the server write).
- Checkout and dashboard files are owned by open PRs; not re-measured beyond the stall check.
- 2 unit tests in `clinic scoping on checkout and invoice reads` fail on origin/dev too (pre-existing, unrelated).

Verification: `tsc -p tsconfig.lint.json` clean, ESLint on changed files clean, `bun test tests/unit` 1037 pass / 2 pre-existing fail. Dev server killed (port 3686 free).
