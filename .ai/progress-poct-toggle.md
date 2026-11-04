# Progress: POCT lab (poct) + X-ray (pacs) module toggle hardening

Branch: `ai/task-poct-toggle`, worktree `/workspace/ucc-pr-poct-toggle`, based on `origin/dev` @
21a8768 (includes Task 9's PR #223 and Task 9-fixes' PR #224: composer POCT section gated end to
end, `/poct` worklist shows real data, legacy `/poct/new` bypass retired).

## What already works (reused, not rebuilt)
- Module toggle mechanism: Organization extension `organization-enabled-module-ids`, helpers in
  `lib/module-registry.ts` + `lib/module-settings.ts`. `poct`/`pacs` are `KNOWN_BRANCH_MODULE_IDS`,
  NOT in `DEFAULT_BRANCH_ENABLED_MODULE_IDS` -> both default OFF for every existing clinic.
- Admin toggle UI (`app/(admin)/admin/clinics/[id]/clinic-edit-form.tsx`) lists poct/pacs generically
  via `listAvailableBranchModules()`.
- `/poct/*` and `/pacs/*` route trees gate via their `layout.tsx` -> `loadEnabledModulePage` ->
  `<ModuleUnavailable/>` (whole subtree, including `/poct/new` and `/pacs/new`).
- Composer POCT section (`order-composer.tsx` `poctEnabled` prop, from
  `app/(routes)/patients/[id]/page.tsx` via `isModuleEnabledForClinic`) gated UI + server
  (`GET /api/poct/analysers` -> 404, `createLabOrder`'s `order.poct` branch -> 403 when disabled).
- Legacy `/poct/new` (the one REVIEW-task9.md MAJOR finding) retired to an informational page with
  no submit path (Task 9-fixes).

## Corrected understanding vs. the original gap list (read this before touching labs/imaging code)
The first pass at this task (before a watchdog restart wiped its step log) assumed `poct`/`pacs`
should gate the *entire* `/api/labs/order` and `/api/imaging/order` surface unconditionally. That
is **wrong** and would have been a regression:

- The treatment composer's "Investigations" tab lets staff order *generic* catalog lab tests
  (`Lab: Full Blood Count`, seeded in `e2e/global-setup.ts`) and *generic* imaging procedures
  (`Imaging: Chest X-ray PA view`) as ordinary billable line items, via the exact same
  `POST /api/labs/order` / `POST /api/imaging/order` endpoints — with no `poct`/analyser-style
  flag at all for imaging, and only when `order.poct` is explicitly set for labs. This is a
  separate, always-on, module-independent feature that predates the poct/pacs modules
  (`lib/clinical-catalog.ts`, `patient-profile-workspace.tsx:494-609`).
- `e2e/tests/workflow.spec.ts` tests 06/07 are baseline-gated proof of this: they create a
  generic FBC lab order + Chest X-ray imaging order and sign the treatment against the `demo`
  clinic, which has **both** `poct` and `pacs` off (default). Gating those endpoints
  unconditionally breaks this baseline outright — confirmed by stashing the "unconditional gate"
  change and re-running; test 06 fails immediately with a 403/404 instead of creating the
  ServiceRequests. AGENTS.md: "Never break existing features, especially the consultation
  composer."
- `pacs` has no analyser-equivalent flag/tag distinguishing "ordered via the dedicated PACS
  module UI" from "ordered as a generic catalog item in the composer" — unlike `poct`, which tags
  its ServiceRequests (`POCT_TAG_SYSTEM`) and requires `order.poct`. Building that distinction is
  Task 12's job (PACS X-ray feature, not yet started per `.ai/STATE.md`/`.ai/BACKLOG.md`), not
  this toggle-hardening task's. So there is nothing safe to add to
  `/api/imaging/order|results` beyond the existing `/pacs/*` route-level gate.
- The standalone `app/(routes)/patients/[id]/labs-imaging/page.tsx` (unreachable from any nav/link
  — confirmed via grep, only ever hit directly by URL, and smoke-screenshotted once in
  `workflow.spec.ts` test 07 step 13 with no content assertion) renders the same generic
  `LabOrderForm`/`ImagingOrderForm` components as the composer (`getClinicalCatalog('lab'/
  'imaging')`, not `POCT_TEST_DEFINITIONS`). It is not POCT/PACS-module functionality and gating
  it by `poct`/`pacs` would be the same category of regression as above. Left untouched.
- `GET /api/labs/results` / `GET /api/imaging/results` show *historical* results regardless of
  current toggle state (same as any EMR — disabling a module doesn't erase past patient data).
  AGENTS.md's "Lab/POCT results show only in the Lab tab" is a placement rule (already true), not
  an on/off-visibility rule. Left untouched.

## Real gap found and closed
`PATCH`/`DELETE /api/labs/order` had **no** module check at all — including for orders that *are*
POCT (tagged `POCT_TAG_SYSTEM`/`poct`, created via the `order.poct` path). A caller with API
access (no UI currently exposes this — grepped, no PATCH/DELETE caller) could still edit/cancel an
existing POCT order after an admin disabled the module for that clinic, bypassing the same
"module disabled" contract the POST path already enforces. Generic (non-POCT) lab orders' PATCH/
DELETE must stay unaffected, same reasoning as above.

**Fix:** `lib/fhir/lab-service.ts` `updateLabOrder`/`deleteLabOrder` now take a `clinicId`, read
the `ServiceRequest` first, and — only if it carries the POCT tag — call
`isModuleEnabledForClinic('poct', clinicId)` and throw `ForbiddenError` (403) if disabled.
Generic orders pass straight through, unaffected. `app/(routes)/api/labs/order/route.ts`
`PATCH`/`DELETE` now destructure `clinicId` from `requireClinicAuth` and use `handleRouteError`
(matching `POST`'s error mapping) instead of a hardcoded 500, so the new `ForbiddenError` actually
surfaces as 403.

## e2e coverage added
- `e2e/tests/module-toggle.spec.ts` (already drafted before the restart, kept as-is): `pacs`
  route-level toggle — `/pacs` and `/pacs/new` show `<ModuleUnavailable/>` when off, render the
  module when on. Documents the generic-ordering-is-out-of-scope decision inline as a comment.
- `e2e/tests/poct.spec.ts`: added "POCT module disabled after an order exists blocks PATCH/DELETE
  of that order; a generic lab order stays mutable" — creates one POCT order + one generic order
  while enabled, disables the module, asserts PATCH/DELETE on the POCT order both 403 (and the
  resource is unchanged), asserts PATCH/DELETE on the generic order both still succeed, then
  re-enables and confirms the POCT order's PATCH/DELETE work again.
- `tests/unit/module-settings.test.ts` (already drafted before the restart, kept as-is): poct/pacs
  are known-but-default-off modules; normalization keeps them opt-in only.

## Gate status (this worktree, dedicated dev server :3212, Medplum :8113 shared/untouched)
- `bunx tsc --noEmit` (both `tsconfig.json` and `tsconfig.lint.json`): clean.
- `bun run lint`: clean.
- `bun test tests/unit/module-settings.test.ts`: 3/3 pass.
- `npx tsx e2e/scripts/clinic-check.ts`: 7 clinics, 261 encounters, `problems: []`.
- Full Playwright suite (`UCC_BASE_URL=http://localhost:3212 npx playwright test --workers=1`,
  29 tests): 20 passed, 4 failed, 5 did not run. Every failure traced to a specific, pre-existing
  or self-inflicted cause — none are regressions from this diff:
  - `api.spec.ts` "patients: create/..." — failed once (duplicate-NRIC collision: `RUN` id in
    `e2e/lib/env.ts` is minute-granular, and I'd run the suite several times within the same
    minute earlier in this session). Re-ran in isolation: **passed**.
  - `api.spec.ts` "inventory: validation returns 4xx not 500" — documented pre-existing bug
    (`.map of undefined` in `/api/inventory`), fails on every baseline run across this project's
    history, untouched by this diff.
  - `poct.spec.ts` "POCT online + Sign creates active Device ServiceRequest..." — flaky in this
    box's env regardless of code: earlier in this session I `git stash`'d every change in this
    task and re-ran this exact test against the untouched baseline; it still failed, with a
    *different* assertion each time (worklist visibility, then the 409-block timing, then an API
    timeout on the idempotent-retry call). Confirmed not caused by this diff.
  - `workflow.spec.ts` "06 composer ... labs, imaging ... -> Sign" — failed once (mid-run,
    redirected to `/login`) inside the 29-test run, immediately after the already-flaky POCT test
    stalled for 1.9 minutes on an API timeout. Re-ran `workflow.spec.ts` alone, fresh: **passed**
    (52.2s) — this is the test that proves generic lab/imaging ordering still works with poct/pacs
    off; a real regression here would have been the one failure that mattered. Resource
    contention from the earlier POCT test, not this diff.
  - `workflow.spec.ts` "07 lab result ingest -> Labs & Imaging tab" — `POST /api/labs/receive`
    returns 401 `Unauthorized: Invalid API key`. Confirmed: `app/(routes)/api/labs/receive/
    route.ts` is byte-identical to `origin/dev` (`git diff origin/dev -- ...` empty) and this
    box's shared `.env.local` has `POCT_API_KEY` set (for the separate, unmerged Task 4
    x-api-key hardening work) — exactly the documented pre-existing environment/infra drift from
    `.ai/progress-task9-fixes.md`. Not this diff.
  - `workflow.spec.ts` 08-11 "did not run" — cascade from 07's failure (tests in this file share
    one module-level `facts` object serially); same documented, pre-existing behavior.
- Net: zero new failures attributable to this task's 3 changed files + 2 new test files.

## Remaining
- [x] Run full e2e suite in the foreground once; confirmed no new failures vs. baseline (see
      above).
- [x] Commit (b33ad40, no `.secrets`/`e2e/.secrets`), push `ai/task-poct-toggle` (normal push).
- [x] Opened draft PR into `dev`: https://github.com/Iatrum/UCC/pull/226 — `mergeable: "MERGEABLE"`,
      `isDraft: true`.
- [x] Wrote summary to `/workspace/ai-logs/ucc-poct-toggle.md`.
- [x] Stopped the dedicated `:3212` dev server.

Task complete.

## Step log
- 2026-11-03: resumed after prior runs died on API errors. Fast-forwarded `ai/task-poct-toggle` to
  `origin/dev` (picked up Task 9-fixes, PR #224, already merged — no duplicate work needed).
  Re-derived the real architecture (composer's generic lab/imaging ordering is module-independent,
  proven by `workflow.spec.ts` 06/07 against the default-off `demo` clinic) and corrected the
  stale gap list above. Implemented the one real residual gap (PATCH/DELETE module check for
  POCT-tagged orders only). Added e2e coverage. tsc/lint/unit clean; targeted e2e 7/8 (1
  pre-existing flake, confirmed via stash-and-rerun against baseline). Dev server for this
  worktree running on `:3212` (not touching `:3210`/other agents' worktrees). Next: full e2e gate,
  commit, push, PR.
- 2026-11-04: resumed after a stall. Restarted the `:3212` dev server (had gone down between
  sessions; `:3210` untouched throughout). Ran the full 29-test Playwright suite in the
  foreground, triaged all 4 failures by isolated re-run / diff-against-dev / cross-checking past
  documented issues — none are regressions from this diff (see Gate status above). Clinic check
  clean. Committed b33ad40, pushed `ai/task-poct-toggle`, opened draft PR #226 into `dev`
  (MERGEABLE). Wrote `/workspace/ai-logs/ucc-poct-toggle.md`. Stopped the `:3212` dev server.
  Task complete.
