# Task 3b research: composer loses the first item (hydration race)

## Reproduction (Dev, 2026-10-31 08:10 MYT, out-of-repo probe /workspace/ai-logs/probe)
- Probe = e2e tests 01-05 + logging of every /api/consultations/plan request/response.
- Run 1 (pick item right after composer opens): GET draft x2 sent in test 04 (dev Strict Mode double effect), POST sent in 05 BEFORE the GETs answered. GET -> 200 `{persistenceAvailable:false, entries:[]}`, POST -> 503 `{persistenceAvailable:false}`. Result: item GONE.
- Run 2 (same, but wait 20 s before picking): GETs answered first, item KEPT ("1 × RM 0.50"), no POST (persistence already disabled).
- => Root cause is NOT a re-render loop (round-1 hunch was wrong: `initialEntries` is a module constant, `onPlanChange` is a stable useCallback, `toast` is a module function). It is a race: the hydration effect in `components/orders/order-composer.tsx` (~L558-601) calls `publishPlan(initialEntries)` / `publishPlan(server entries)` when the slow GET resolves, overwriting anything the user added meanwhile. In dev the GET is slow (route compile), in prod a slow network does the same.

## External
- React docs: fetch in Effects needs an ignore flag for stale responses, and a late response must not clobber newer state. https://react.dev/learn/you-might-not-need-an-effect#fetching-data , https://react.dev/learn/synchronizing-with-effects#fetching-data
- Strict Mode runs effects twice in dev (explains the 2 GETs; first is ignored via `active`). https://react.dev/reference/react/StrictMode
- Clinical UX: never silently drop clinician input; data loss erodes trust (AHRQ health IT usability, "preserve user work"). https://digital.ahrq.gov/health-it-tools-and-resources/evaluation-resources/workflow-assessment-health-it-toolkit

## Options
1. Disable picker until hydrated. Simple, but adds wait for a busy doctor and still fragile.
2. Track "user edited before hydration" with a ref; when the GET resolves, MERGE instead of overwrite: server entries + local entries whose id is not in the server list (local wins on same id). If server has none, keep local. Chosen.
