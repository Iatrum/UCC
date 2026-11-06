# progress-task12

Updated: 2026-11-06 (Claude build round, resumed a third time)

## Done
- Plan written (`.ai/PLAN-task12.md`)
- Scope + build defaults decided as D28 (narrow A, reuse `pacs`, widen subscription, v1 Chest/limb studies, one draft PR)
- Phase 1 (commit 0505817, pushed): X-ray device layer + XRAY_STUDIES catalog + GET /api/pacs/devices
- Phase 2 (commit 9ba5f7f, pushed): composer ordering (XraySection, pacsEnabled, order.xray branch in
  createImagingOrder, PATCH/DELETE module-gated from day one, DX filter bug fixed)
- Phase 3 (commit 98f4a35, pushed): device bridge (lib/pacs/xray-device-bot.ts, POST /api/imaging/receive/message),
  Lab tab "Pending X-ray" card, /api/labs/subscription widened to poct OR pacs, scripts/pacs/sim-xray.ts
- Phase 4 WIP (commit 31da9a3, pushed): e2e/tests/xray.spec.ts (5 tests)
- Bugfix (commit 4afac89, pushed): DiagnosticReport's search param for ImagingStudy is `study`, not `imaging-study`
  -- confirmed via `/fhir/R4/metadata`. This was silently 500ing `GET /api/imaging/results` for ALL imaging
  (pre-existing, predates this task), which is why the device-ingested X-ray study never showed up in
  `ImagingResultsView` during testing. All 5 `xray.spec.ts` tests pass together after this fix + the
  `basedon` fix (also in 4afac89's predecessor commit) + clicking the "Imaging Studies" sub-tab in the test
  (standalone `/patients/[id]/labs-imaging` route has separate "Laboratory Tests"/"Imaging Studies" tabs,
  distinct from the SPA tab of the same name in `patient-profile-workspace.tsx`).
- Full-suite gate run (lint 0, build 0, warmup 0) surfaced two apparent "NEW FAIL"s vs the `10-decisive` baseline:
  1. `api.spec.ts: read endpoints respond without 5xx (smoke)` -- `ECONNRESET` on `GET /api/queue`. Re-ran in
     isolation: passes cleanly. Transient dev-server hiccup, same documented pattern as D10; not a regression.
  2. `poct.spec.ts: Lab subscription API enforces login, clinic patient/encounter scope and POCT toggle` --
     expected 401, got 503 on the test's first `anonymous.post('/api/labs/subscription', ...)` call. Root-caused
     by debugging (temporary `console.log` in the route, since removed): this test's `anonymous` context was
     created via `playwright.request.newContext({ baseURL })` WITHOUT the `storageState: { cookies: [], origins:
     [] }` override every *other* anonymous context in this same file correctly uses (confirmed by grep -- only
     one of two call sites had it). Without the override, it inherits the project's default
     `storageState: '.secrets/state.json'` (a real, valid, clinic=`demo` session) -- so the "anonymous" call is
     actually fully authenticated. Combined with the test's own fixture enabling `poct` for its dynamically
     created patient's clinic (which this shared test session always assigns to `demo`, since patient creation
     goes through the same default-session `request` fixture), the module check passes, the patient is found,
     and the call proceeds into the real Subscription-creation attempt, which 503s because this local Medplum
     project doesn't support WebSocket subscriptions (a pre-existing, already-documented environment limitation --
     see the *other* passing assertion two lines later in the same test: `expect([200, 503]).toContain(...)`).
     **Proved this is pre-existing, not caused by this task's subscription-widen change**: reverted
     `/api/labs/subscription/route.ts` to the exact pre-Task-12 single-`poct`-check code in a scratch copy,
     re-ran the same test against it with a freshly cleaned `demo` clinic -- identical 503 failure. Restored the
     widened route (verified byte-identical to the committed version via `git diff`, clean). Fixed the actual bug:
     added the missing `storageState: { cookies: [], origins: [] }` override to this one `anonymous` context in
     `e2e/tests/poct.spec.ts` (mirroring the correct pattern already used earlier in the same file). Verified the
     test now passes with a clean `demo` clinic. `bun run lint` clean after this fix.
- Worktree `/workspace/ucc-pr-12` set up for lint/test: `bun install` run, `e2e/node_modules` symlinked to
  `/workspace/ucc-e2e-suite/node_modules`, `.env.local` and `e2e/.secrets/{pacs_key,poct_key,pw}` copied from
  `/workspace/iatrum-ucc` (none staged/committed -- all gitignored). Added `PACS_API_KEY` export to `e2e/lib/env.ts`.
  Dev server running on :3210 from this worktree (`NODE_OPTIONS=--max-old-space-size=3072 next dev --webpack -p
  3210`, log `/workspace/ai-logs/devserver-task12.log`, restarted once mid-round to clear stale module-toggle
  pollution from earlier debugging). Medplum already up on :8113. All 4 fake clinics (`demo`/`clinicb`/`clinicc`/
  `clinicd`) confirmed back to default module state (no leftover `poct`/`pacs` toggles) before every gate run.

## In progress
- About to commit the `poct.spec.ts` storageState fix and push, then run ONE MORE full-suite gate in the
  foreground to get a clean official result with zero unexplained NEW FAILs.

## Remaining
- Full clean `check-all.sh`-equivalent gate run (lint/build/warmup already done this round; e2e full run + compare
  + clinic-check still needed after this commit).
- Open/update one draft PR `ai/task-12` -> `dev`, verify `gh pr view --json mergeable`, write summary to
  `/workspace/ai-logs/ucc-task12.md`.

## Design decisions made during build (not spelled out in the original plan)
- The device bridge for X-ray only ever creates an `ImagingStudy` (reusing the existing `receiveImagingStudy`
  function as-is) -- it does NOT fabricate a `DiagnosticReport`/interpretation, consistent with D28 point 3
  (`/api/imaging/report` stays the human-typed radiologist path, unchanged). The "Pending X-ray" card clears once
  `receiveImagingStudy` marks the ServiceRequest completed, picked up by the Lab tab's existing 30s poll fallback.
- ImagingStudy FHIR search parameter is `basedon`, not `based-on`; DiagnosticReport's imagingStudy-link search
  parameter is `study`, not `imaging-study` (both differ from the `based-on` ServiceRequest/DiagnosticReport
  normally use elsewhere in this codebase). Both confirmed against this Medplum instance's `/fhir/R4/metadata`,
  both pre-existing bugs in `lib/fhir/imaging-service.ts` predating this task, both fixed as part of this task
  since they directly blocked verifying the new X-ray results path (same precedent as Task 10's `_count` fix).
- `modality` field computed in `createImagingOrder` but never written onto the resource is pre-existing dead code
  (present before this task); left as-is, out of scope.
- `e2e/tests/poct.spec.ts`'s last test had a missing `storageState` override on one of its two "anonymous" API
  contexts (pre-existing test-authoring bug, not app code); fixed as part of this task's gate since it directly
  blocked a clean gate and the root cause required tracing through the new subscription-widen code to rule out.

## Notes
- Time Chit deferred to `070-time-chit` (after Task 12) -- user priority is POCT X-ray first
- Codex remains user-paused; do not unpause
- Baseline ~29/30 (known-bug probes summary only)
- Branch `ai/task-12`, worktree `/workspace/ucc-pr-12`, pushed through 4afac89 so far.
- IMPORTANT for future resumes: do not background e2e/playwright test runs or sleep-then-check loops; run them
  directly in the foreground with Bash. Before any full gate run, confirm `demo`/`clinicb`/`clinicc`/`clinicd`
  Organizations have no leftover module-toggle extensions from prior debugging (query with `{cache: 'no-cache'}`
  via a `bun -e` one-liner using `getAdminMedplum()`) -- the admin Medplum client is a process-level singleton
  that caches reads, so toggles written via a *separate* short-lived script invocation won't be visible to the
  long-running dev server's cached view until it re-queries without cache, but the Organization resource itself
  really did change, so always verify with an explicit no-cache read against the SAME running dev server process
  if something looks stale.
