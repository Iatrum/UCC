# progress-task12

Updated: 2026-11-06 (Claude build round, resumed again after a stall)

## Done
- Plan written (`.ai/PLAN-task12.md`)
- Scope + build defaults decided as D28 (narrow A, reuse `pacs`, widen subscription, v1 Chest/limb studies, one draft PR)
- Phase 1 (commit 0505817, pushed): X-ray device layer + XRAY_STUDIES catalog + GET /api/pacs/devices
- Phase 2 (commit 9ba5f7f, pushed): composer ordering (XraySection, pacsEnabled, order.xray branch in
  createImagingOrder, PATCH/DELETE module-gated from day one, DX filter bug fixed)
- Phase 3 (commit 98f4a35, pushed): device bridge (lib/pacs/xray-device-bot.ts, POST /api/imaging/receive/message),
  Lab tab "Pending X-ray" card, /api/labs/subscription widened to poct OR pacs, scripts/pacs/sim-xray.ts
- Bugfix (about to commit): ImagingStudy's FHIR search parameter is `basedon` (no hyphen), not `based-on` like
  ServiceRequest/DiagnosticReport use -- confirmed via `GET /fhir/R4/metadata` on the local Medplum. Fixed in
  `lib/pacs/xray-device-bot.ts`'s duplicate-ingestion guard.
- `e2e/tests/xray.spec.ts` written (5 tests, mirrors poct.spec.ts): offline device blocks ordering + 409 on
  direct API call with online or offline device id + clinic isolation on foreign device; online+Sign creates
  active un-completed tagged ServiceRequest (tag/category/identifier/performer asserted), preserves bill, no
  completed Procedure, idempotent retry; module disabled hides the composer section + 404s /api/pacs/devices +
  403s the order API; simulated device study reaches the Lab tab pending card and clears it after ingestion,
  duplicate-ingestion guard returns the same ImagingStudy on retransmit, bad key 401s, non-xray-tagged order 400s;
  module disabled after an order exists blocks PATCH/DELETE of that order while a generic (non-device) imaging
  order stays mutable.
  - All 5 passing as of this update except the "Simulated X-ray device study..." test, which was failing on a
    test-only bug (not app code): `/patients/<id>/labs-imaging` is a SEPARATE standalone page (own route,
    `app/(routes)/patients/[id]/labs-imaging/page.tsx`) with its own "Laboratory Tests"/"Imaging Studies" tabs
    (distinct from the SPA tab of the same name inside `patient-profile-workspace.tsx`). `LabResultsView` is on
    the default "Laboratory Tests" tab (so the pending-card assertions work with no extra click, matching
    poct.spec.ts's precedent), but `ImagingResultsView` is under "Imaging Studies" and needs an explicit tab click
    first -- test now clicks `page.getByRole('tab', { name: 'Imaging Studies', exact: true })` before asserting
    the study card is visible. Rerunning now to confirm.
- Worktree `/workspace/ucc-pr-12` set up for lint/test: `bun install` run, `e2e/node_modules` symlinked to
  `/workspace/ucc-e2e-suite/node_modules`, `.env.local` and `e2e/.secrets/{pacs_key,poct_key,pw}` copied from
  `/workspace/iatrum-ucc` (none staged/committed -- all gitignored). Added `PACS_API_KEY` export to `e2e/lib/env.ts`.
  Dev server running on :3210 from this worktree (`NODE_OPTIONS=--max-old-space-size=3072 next dev --webpack -p 3210`,
  log `/workspace/ai-logs/devserver-task12.log`). Medplum already up on :8113.
- `bun run lint` (tsc --noEmit + clinic-admin-medplum check) clean after phase 1+2+3.

## In progress
- Rerunning `tests/xray.spec.ts -g "Simulated X-ray device study"` after the Imaging-Studies-tab-click fix, in the
  foreground, before committing the spec file.

## Remaining
- Confirm all 5 xray.spec.ts tests pass together (not just individually -- check for cross-test pollution since
  they share the same `demo`/`clinicb`/etc. fake clinics).
- Commit + push e2e/tests/xray.spec.ts + the basedon fix.
- Full `check-all.sh task12` in the foreground (baseline ~29/30, known-bug-probes-summary only expected failure;
  do not regress) -- not run yet this round.
- Open/update one draft PR `ai/task-12` -> `dev`, verify `gh pr view --json mergeable`, write summary to
  `/workspace/ai-logs/ucc-task12.md`.

## Design decisions made during build (not spelled out in the original plan)
- The device bridge for X-ray only ever creates an `ImagingStudy` (reusing the existing `receiveImagingStudy`
  function as-is) -- it does NOT fabricate a `DiagnosticReport`/interpretation, consistent with D28 point 3
  (`/api/imaging/report` stays the human-typed radiologist path, unchanged). The "Pending X-ray" card clears once
  `receiveImagingStudy` marks the ServiceRequest completed, picked up by the Lab tab's existing 30s poll fallback.
- ImagingStudy FHIR search parameter is `basedon`, not `based-on` (differs from ServiceRequest/DiagnosticReport).
- `modality` field computed in `createImagingOrder` but never written onto the resource is pre-existing dead code
  (present before this task); left as-is, out of scope.

## Notes
- Time Chit deferred to `070-time-chit` (after Task 12) -- user priority is POCT X-ray first
- Codex remains user-paused; do not unpause
- Baseline ~29/30 (known-bug probes summary only)
- Branch `ai/task-12`, worktree `/workspace/ucc-pr-12`, pushed through 98f4a35 so far.
- IMPORTANT for future resumes: do not background e2e/playwright test runs or sleep-then-check loops; run them
  directly in the foreground with Bash (the harness's own background-task tracking has been unreliable this round
  -- a previous `run_in_background` run completed with 0-byte output and no completion notification survived a
  session stall). Prefer plain foreground `Bash` calls even if they take a few minutes.
