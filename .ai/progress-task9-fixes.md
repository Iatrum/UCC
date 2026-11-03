# Progress: Task 9 follow-up fixes (PR #223 already merged)

Branch: `ai/task-9-fixes`, worktree `/workspace/ucc-pr223-fixes`, based on `origin/dev` @ af7b786
(moved from a stale prior worktree `/workspace/ucc-pr-9fixes` that had the branch created but zero
commits — previous attempt stalled before writing any code).

## Scope
1. `/poct` page (`app/(routes)/poct/page.tsx`) hardcodes `Today's Tests 0` / `Pending 0` / lists —
   needs to read real `ServiceRequest`s (tag `https://ucc.emr/poct` code `poct`, `identifier
   clinic|<id>`, `performer: Device/<analyserId>`) created by the composer (`lib/fhir/lab-service.ts
   createLabOrder`). Add/extend `e2e/tests/poct.spec.ts`.
2. Consultation History table (`app/(routes)/patients/[id]/patient-profile-workspace.tsx` ~line 785)
   squeezes Complaint/Diagnosis to a couple chars when the composer panel is open — fixed with
   table/cell min-widths.
3. Blocking finding from `.ai/REVIEW-task9.md` (MAJOR): legacy `app/(routes)/poct/new/page.tsx` posts
   straight to `/api/labs/order` without the `poct:` field, bypassing the online-analyser/Device
   check entirely once a clinic's `poct` module flag is on. Fixed by retiring the form (now an
   informational page pointing at the Treatment composer).
4. Do NOT touch `/workspace/ucc-pr-poct-toggle` (separate in-flight task, same `poct` module surface).

## Done
- [x] `lib/fhir/lab-service.ts`: added `getClinicPoctOrders(clinicId, medplum)` — searches
      `ServiceRequest` by `identifier=clinic|<id>` + `_tag=https://ucc.emr/poct|poct`, batch-fetches
      Patient names, returns `PoctOrderSummary[]` (id, patientId, patientName, testCode, testName,
      status, priority, authoredOn, analyserId).
- [x] `app/(routes)/poct/page.tsx`: converted to an async server component using
      `getMedplumForRequest()` + `resolveClinicIdFromServerScope()` (same pattern as
      `app/(routes)/orders/page.tsx`). Today's Tests / Pending / Completed stat cards and the
      Pending/Completed/All tabs now render real clinic POCT orders instead of hardcoded zeros.
      "New Test Order" button kept linking to `/poct/new`.
- [x] `app/(routes)/patients/[id]/patient-profile-workspace.tsx`: `Table` gets `min-w-[860px]`,
      Complaint/Diagnosis `TableHead`/`TableCell` get `min-w-[200px]` (cells also keep
      `max-w-[260px] truncate`) so the table scrolls horizontally via the existing
      `overflow-x-auto` wrapper instead of squeezing when the composer panel is open.
- [x] Legacy `/poct/new` fix (REVIEW-task9 MAJOR): `app/(routes)/poct/new/page.tsx` no longer has a
      form or posts to `/api/labs/order`; it's now a static informational page that explains POCT
      orders must come from the Treatment composer and links to `/patients`. Can't bypass the
      analyser/online contract anymore because there's no submit path left.
- [x] `e2e/tests/poct.spec.ts`: `fixture()` now also returns `patientName`; the "online + Sign" test
      navigates to `/poct` after signing and asserts the patient's order row is visible and the
      Pending stat card count is > 0.
- [x] `bunx tsc --noEmit` (both `tsconfig.json` and `tsconfig.lint.json`) and `bun run lint` clean.
- [x] Ran `e2e/tests/poct.spec.ts` against a dedicated dev server for THIS worktree (see note below)
      — all 3 tests pass (20.3s).

## Important environment note (read before re-running e2e)
`:3210` was already occupied by a **different** checkout (`/workspace/iatrum-ucc`, branch
`ai-work`) — not this worktree. Running Playwright against `:3210` silently tests the wrong code
(confirmed: `git stash` + rerun against `:3210` gave byte-identical failures to the un-stashed run,
because neither run was hitting this worktree's code at all). Started a dedicated dev server for
*this* worktree on **`:3211`** instead of touching/killing the shared `:3210` process (it may belong
to another in-flight task): `NODE_OPTIONS=--max-old-space-size=3072 bun run dev -- -p 3211`, warmed
with `UCC_BASE_URL=http://localhost:3211 node scripts/warmup.mjs`. All e2e runs for this task use
`UCC_BASE_URL=http://localhost:3211`. Medplum (`:8113`) is shared infra, untouched.

## Remaining
- [x] Run the full e2e suite once (foreground) against `:3211`: 20 passed, 2 failed, 4 did-not-run
      (see "Full gate results" below) — all pre-existing/environmental, none caused by this diff.
- [x] Run `npx tsx scripts/clinic-check.ts` (clinic isolation check): `problems: []`, clean.
- [x] Commit WIP (262aec8), push `ai/task-9-fixes` (normal push, no force) — already on `origin`.
- [x] Open/update draft PR into `dev`: https://github.com/Iatrum/UCC/pull/224, `mergeable:
      "MERGEABLE"`, `isDraft: true`.
- [x] Write summary to `/workspace/ai-logs/ucc-pr223-fixes.md`.
- [x] Stop the dedicated `:3211` dev server when fully done (left `:3210`/iatrum-ucc alone
      throughout).

## Full gate results (this worktree, `:3211`, 2026-11-03)
- `bunx tsc --noEmit` (both configs): clean.
- `bun run lint`: clean.
- `bun run build:ci`: succeeds.
- `npx tsx scripts/clinic-check.ts`: 7 clinics, 198 encounters, `problems: []`.
- Full Playwright suite (`--workers=1`, 26 tests): **20 passed**, 2 failed, 4 did-not-run.
  - `poct.spec.ts` (all 3, this task's own coverage): **PASS**.
  - FAIL `inventory: validation returns 4xx not 500` — pre-existing bug (also fails on the old
    Oct-31 baseline, `.map of undefined` crash in `/api/inventory`), untouched by this diff.
  - FAIL `07 lab result ingest -> Labs & Imaging tab` — `POST /api/labs/receive` returns 401
    `"Unauthorized: Invalid API key"`. Root cause: this box's shared `.env.local` now has
    `POCT_API_KEY` set (for the separate, unmerged Task 4 x-api-key hardening work), so the
    *existing, unmodified* `apiKey` check in `app/(routes)/api/labs/receive/route.ts:28-34`
    (identical byte-for-byte to `dev` HEAD — confirmed via `git diff af7b786 HEAD`) now rejects
    the e2e test's request, which doesn't send `apiKey` in the body. Confirmed with a direct curl
    against `:3211` — 401 regardless of which branch serves the request, since the route code is
    unchanged. This is an environment/infra drift, not a regression in this PR.
  - `08`/`09`/`10`/`11` did-not-run: `workflow.spec.ts` tests share state serially via one
    module-level `facts` object across `test()` calls in the same file: `07`'s uncaught failure
    stops the remaining chain. Nothing in this PR's diff touches docs/billing/smoke/known-bug-probe
    code paths.
  - Net: no new failures attributable to this PR's 5 changed files; the 2 failures and the
    4 knock-on skips are pre-existing/environmental.

## Step log
- 2026-11-03 ~14:30-15:17 (resumed after watchdog restart): read progress/review notes, verified
  uncommitted diff (lab-service.ts, poct/page.tsx, poct/new/page.tsx, patient-profile-workspace.tsx)
  was already complete and typechecks/lints clean. Extended poct.spec.ts with the /poct-worklist
  assertion. Discovered `:3210` belongs to a different worktree (`/workspace/iatrum-ucc`) — started
  own dev server on `:3211` for this worktree, warmed, reran `poct.spec.ts`: 3/3 pass.
