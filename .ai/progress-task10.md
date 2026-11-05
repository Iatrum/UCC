# Progress: Task 10 — simulated analyser HL7/ASTM, Bot, Lab tab

Branch `ai/task-10`, worktree `/workspace/ucc-pr-10`, based on `origin/dev` @ 21a8768 (already
includes merged PR #223 Task 9 composer-POCT and PR #224 Task 9 fixes). `.env.local` copied from
`/workspace/iatrum-ucc/.env.local` (gitignored, not committed) — this worktree had none, so nothing
in it could run before this round.

**Context: this is the 4th automated attempt.** `/workspace/ai-runner/runner.log` shows `020-task10`
(2026-11-03) and `027-task10` (2026-11-04, twice) all killed `rc=143`/stalled with **zero commits**
in this worktree before this round. Scoping decisions below exist specifically to avoid repeating
that; this round commits WIP incrementally so a kill doesn't lose work again.

## Scope decisions (read before changing the plan)

1. **No real Medplum `Bot` resource, no server config change.** Checked the actual running Medplum
   process (`/proc/6676/environ`, port 8113): config comes from `MEDPLUM_*` env vars, no
   `MEDPLUM_VM_CONTEXT_BOTS_ENABLED` set → VM-context bots default OFF (confirmed via Medplum docs:
   "Running Bots Locally" / "VM Context Bots" — `vmContextBotsEnabled` defaults `false`, needs a
   server config change + restart). This Medplum instance is **shared** across every concurrent
   task/worktree (AGENTS.md: "one dev server/Medplum at a time"); flipping that + restarting it is a
   shared-infra change far outside "small task, one commit", and is very likely what the prior
   attempts burned their time budget on. Decision: write the Bot's logic as a plain module
   (`lib/poct/analyser-bot.ts`) in the exact Medplum Bot handler shape
   (`handler(medplum, event: BotEvent)`, same input content types Medplum documents:
   `text/plain` / `x-application/hl7-v2+er7`), so it is a drop-in `Bot` resource later, but it is
   invoked in-process by a new Next.js route for now. Documented so nobody "fixes" this by guessing.
2. **HL7 ORU^R01 / ASTM E1394 are hand-written minimal encoders+decoders**, not a new npm dependency
   (none installed; `package.json` has zero HL7/ASTM libs). Only the fields we actually need:
   HL7 `MSH`/`OBR`/`OBX`; ASTM `H`/`O`/`R`/`L`. No vendor-specific profile is targeted — "simulated
   analyser" per the task, not a real device integration — so round-trip unit tests (build → parse →
   same data) are the correctness check, not a specific manufacturer's interface spec.
3. **No new numeric reference ranges.** `POCT_TESTS` (`lib/fhir/lab-constants.ts`) already carries
   `referenceRange: 'To confirm per analyser'` (Task 9 decision D28 — no guessed clinical intervals).
   The simulated analyser/tests pick `interpretation` (`normal`/`high`/`low`/`critical`) explicitly as
   a simulation parameter; they do not derive it from an invented threshold.
4. **Auth on the new ingestion route matches the existing `/api/labs/receive` contract exactly**
   (optional `apiKey` in the JSON body checked against `POCT_API_KEY`, fail-OPEN if unset). This is
   the pre-Task-4 (insecure) shape because Task 4's hardening only landed on `ai-work`, never merged
   into `dev` (documented gap, `.ai/BACKLOG.md` "Process gap… 2 Nov"); fixing that is Task 4's own
   follow-up PR, not this one. Not touched here, same as `ai/task-poct-toggle` left it (see its
   progress note: "Device ingestion routes … Left untouched").
5. **No module-toggle gate added to the new route** — same call `ai/task-poct-toggle` made for the
   existing receive routes ("API-key authenticated device push, not part of composer/orders/results
   UI surface"). The new route only ever acts on a `ServiceRequest` that was already created while
   `poct` was enabled (clinic match enforced via its `identifier: clinic|<id>`), so there is no
   bypass surface opened by skipping this check. It also only ever touches `ServiceRequest`s tagged
   `poct` (checked in `analyser-bot.ts`), so it cannot be used as a generic lab-result writer.
6. **Lab tab gets a "pending POCT" list**, not a new page. AGENTS.md: "Lab/POCT results show only in
   the Lab tab." Today the Lab tab (`components/labs/lab-results-view.tsx`) only shows *completed*
   `DiagnosticReport`s; there is no visibility of an order that's waiting on a result. Adding that
   closes the loop end-to-end (order from Task 9 → pending in Lab tab → simulated analyser → Bot
   handler → final result with flag, already rendered). The existing `/poct` worklist (Task 9 fixes)
   is clinic-wide/ops-facing; this is the per-patient clinical view AGENTS.md actually names. This is
   gated the same way the rest of the patient's Labs & Imaging page already is (clinic-scoped auth on
   `getMedplumForRequest`); no new POCT-toggle check is added here either, matching decision 5 above
   — a patient only ever has pending `poct`-tagged ServiceRequests if the module was on when ordered.
7. **Route path**: the new endpoint lives at `app/(routes)/api/labs/receive/message/route.ts` (nested
   under the existing `receive/` dir), not a sibling `receive-message/` dir. Reason: this repo's
   `scripts/check-clinic-admin-medplum.mjs` lint gate forbids `app/(routes)/...` routes from calling
   `getAdminMedplum()` directly except an explicit allowlist, which already includes
   `^app/\(routes\)/api/labs/receive/` (that's how the existing JSON receive route gets away with it).
   Nesting under `receive/` reuses that existing allowlist entry instead of editing the shared lint
   config (smaller diff, no risk of clashing with another in-flight branch also touching that file).
8. **One consolidated e2e test, not two.** First attempt wrote two separate tests (HL7 happy-path,
   ASTM+rejection), each calling the shared `fixture()` (its own patient/consult/Device/UI-Treatment-
   tab round trip) plus a full UI Sign click. Both runs of that version hit `OperationOutcomeError:
   Unauthorized` / `AuthError: Session expired` partway through — confirmed in
   `/workspace/ai-logs/task10-devserver.log` ("Session expired. Please sign in again." on
   `/api/poct/analysers` and `POST /api/patients`). Root cause: Playwright's `page` (browser context)
   and `request` (API context) fixtures each load their own copy of the saved session+refresh cookies
   from `.secrets/state.json` at test start, but a refresh triggered in one context doesn't update the
   other's cookie jar, and refresh tokens are typically single-use/rotating — so once total spec
   wall-clock crosses the access-token TTL and one context refreshes, the other's now-stale refresh
   token can fail outright with no fallback. This is e2e-harness infrastructure, not a bug in this
   task's application code (same category as the many "transient auth flake, cleared on rerun" entries
   already in `.ai/STATE.md`); re-architecting cross-context cookie sync is out of scope for Task 10.
   Mitigation actually taken: merged into **one** test that signs via the UI exactly once
   (`signGlucoseOrder`), and does everything else (second POCT order, non-POCT order, wrong-key check)
   via direct FHIR (`f.m`, the same superadmin client `fixture()` already uses) or the api-key-authed
   ingestion route (no clinic-session cookie involved at all) — far less wall-clock, far fewer
   cross-context calls after the initial `fixture()` setup.
9. **Dev server for this worktree runs via `bunx next dev --webpack -p 3210`**, not `bun run dev`
   (which is `next dev --turbopack` and fails here: `TurbopackInternalError: Symlink [project]/
   node_modules is invalid, it points out of the filesystem root` — this worktree's `node_modules` is
   a symlink to `/workspace/iatrum-ucc/node_modules` per AGENTS.md's own worktree instructions, and
   Turbopack in this Next 16.2.1 build won't resolve a symlink that points outside its own directory
   tree; webpack has no such issue, same as `build:ci` already uses `--webpack` for the same reason).

## Plan
- [x] `lib/poct/hl7.ts` — `buildOruMessage()` / `parseOruMessage()` (MSH/OBR/OBX subset).
- [x] `lib/poct/astm.ts` — `buildAstmResult()` / `parseAstmResult()` (H/O/R/L subset).
- [x] `lib/poct/analyser-bot.ts` — Bot-shaped handler: format-sniff → parse → resolve
      `ServiceRequest` by placer-order-number (= its id), require it is `poct`-tagged → call
      `receiveLabResults()`. Exported `handler(medplum, event)` AND a plain `ingestAnalyserMessage()`
      the route calls directly.
- [x] `app/(routes)/api/labs/receive/message/route.ts` — `POST { format: 'hl7'|'astm', message,
      apiKey? }`, same auth shape as `/api/labs/receive`.
- [x] `lib/fhir/lab-service.ts` — added `getPatientPendingPoctOrders(patientId, medplum)`.
- [x] `app/(routes)/api/labs/results/route.ts` — now includes `pending` in the JSON response.
- [x] `components/labs/lab-results-view.tsx` — renders a "Pending POCT Tests" card above the reports.
- [x] `scripts/poct/sim-analyser.ts` — CLI: `device` (create a simulated Device), `heartbeat`
      (loop/once/offline), `send-result` (builds HL7 or ASTM via `lib/poct/*` and POSTs to the new
      route). Reuses `getAdminMedplum()` like `scripts/backfill-clinic-identifiers.ts`.
- [x] `tests/unit/poct-messages.test.ts` — round-trip unit tests for hl7.ts/astm.ts. **7/7 pass**
      (`bun test tests/unit/poct-messages.test.ts`). Not part of `check-all.sh`; run manually.
- [x] `bun run lint` (tsc + `check-clinic-admin-medplum.mjs`) passes clean on all new/changed files.
- [x] `e2e/lib/env.ts` — added `POCT_API_KEY` export (reads `e2e/.secrets/poct_key`, same pattern as
      the existing `PASSWORD` export), so the new e2e test can pass the real key without hardcoding it.
- [x] `e2e/tests/poct.spec.ts` — added one consolidated test (see decision 8 below for why it's one
      test, not two): signs a POCT order via the UI once, then exercises wrong-key rejection,
      non-POCT-ServiceRequest rejection, an HL7 result reaching the Lab tab (pending clears, value+flag
      render, SR completes), and an ASTM critical result (critical banner renders) — the second POCT
      order for the ASTM case is created directly via FHIR, not a second UI sign round trip.
- [x] **Found and fixed a pre-existing, unrelated bug while gating**: `getClinicPoctOrders` (used by
      the `/poct` worklist, not touched by Task 9/9-fixes' own diff review) batch-fetches patient
      names via `searchResources('Patient', { _id: ids.join(',') })` with no `_count` override: once a
      clinic has more than Medplum's default page size (20) of distinct POCT patients, only the first
      20 resolve and the rest silently show their raw UUID instead of a name. Confirmed live against
      this box's shared `demo` clinic: 42 POCT ServiceRequests, 42 distinct patients, only 20 Patients
      resolved without `_count`, all 42 with `_count: '200'`. This is exactly why the **pre-existing**
      "POCT online + Sign…" test (not part of my diff) started failing on `/poct` page a patient name
      — the clinic has accumulated that many fake patients across the many prior Task 9/10 e2e runs on
      this shared box. Fixed with a one-line `_count: '200'` add (matching the ServiceRequest search's
      own cap already on that function) at `lib/fhir/lab-service.ts:350`, and applied the identical fix
      to the three other unbounded `Observation` `_id:`-join batch lookups in the same file
      (`getPatientLabResults`, `getLabReport`, `getEncounterLabResults`) since they have the exact same
      bug shape and sit directly in the Lab tab's own read path (a patient with >20 total observations
      across their lab history would silently lose older results — a correctness bug, not a styling
      one). Scoped in-PR (not deferred like the Task 4/6c gaps) because it's one line, in a file this
      task already touches, and it was actively blocking a clean gate.
- [ ] Run the e2e spec alone (foreground), then the full `e2e/scripts/check-all.sh 10` once at the end
      in the foreground. Dev server for this worktree is up on :3210 (webpack, not turbopack — see
      decision 9), Medplum up on :8113.
- [ ] Final commit + push after gate passes; open draft PR into `dev`; `gh pr view --json mergeable`.
- [ ] Write summary to `/workspace/ai-logs/ucc-task10.md`.

## Failing tests
- None. `tests/poct.spec.ts` 4/4 PASS (confirmed on a fresh dev server, `/workspace/ai-logs/task10-poct-r5`,
  39.2s total). Unit tests 7/7 pass. Lint clean. History of how it got there, for the record:
  - "POCT online + Sign…" (pre-existing test) failed on `/poct` not showing the patient's name —
    root cause was the `_count` truncation bug (fixed, decision/plan item above); confirmed fixed.
  - My new test (after merging 2→1, decision 8) then failed with `page.waitForResponse` timing out on
    `/api/labs/order` inside `signGlucoseOrder`: the helper clicked "Sign" immediately after "Add"
    with no wait for the composer to register the add first (unlike the pre-existing "online + Sign"
    test, which waits for the "Remove" button to appear before signing) — a race in the **test**, not
    the app (same class of bug this codebase's own Task 3b fixed in the composer itself). Reproduced
    identically on both a stale dev server (RSS ~2.99GB, near the 3072MB cap, 4.0 min test) and a
    freshly restarted one (49.2s test, same failure) — ruling out memory pressure as the cause and
    confirming it was this missing wait. Fixed by adding the same `toBeVisible()` wait; reran, 4/4 pass.
  - Separately noted: the stale dev server (same process since ~22:35, 3 full runs) had grown to
    ~2.99GB RSS against the 3072MB `NODE_OPTIONS` cap without an explicit crash/restart log line —
    restarted it before the final successful run. Not a code issue; just don't reuse a dev server for
    many consecutive full e2e runs without restarting it.

## Full gate (`e2e/scripts/check-all.sh 10`)
Ran 3 times to separate real signal from infra noise (`/workspace/ai-logs/10`, `10-r2`, `10-r3`):
- **10** (first run, server warm from manual testing but not yet run through `check-all`'s own
  build+warmup sequence): 16/27, cascading failures from `workflow.spec.ts` test 02 onward — root
  cause confirmed in `task10-devserver-r2.log`: repeated `AuthError: Session expired` during a cold
  dev-server compile window (`GET /dashboard` took 16.1s on first hit), the same
  cold-compile-eats-the-access-token's-short-TTL pattern this project's own `.ai/STATE.md` has
  documented many times before (e.g. D10). Not caused by this task's diff — it hit the **unmodified**
  `workflow.spec.ts`.
- **10-r2** (rerun, server now warm): 20/27. The cold-start cascade cleared as expected. Two findings
  remained: (a) `POCT offline analyser…` failed with a raw `ECONNRESET` — confirmed in the devserver
  log as `⚠ Server is approaching the used memory threshold, restarting...`, the well-documented
  dev-server auto-restart-under-memory-pressure flake, self-healing (server was back up within
  seconds); (b) `workflow.spec.ts` `07 lab result ingest…` started failing with
  `401 {"error":"Unauthorized: Invalid API key"}` from the **pre-existing, untouched**
  `/api/labs/receive` route, with tests 08/09/10 in the same file showing as skipped (not
  independently failed) as a result (`workflow.spec.ts` runs its tests serially sharing one `page`).
- **10-r3** (rerun once more to confirm (a) was a one-off flake and (b) is stable, not another flake):
  21/27 — `POCT offline analyser…` now passes (confirms (a) was the transient OOM-restart), the
  `07`/`08`/`09`/`10` group fails identically again (confirms (b) is a stable, reproducible gap, not
  noise). **Root cause of (b), fully confirmed**: `e2e/tests/workflow.spec.ts:147` posts to
  `/api/labs/receive` with no `apiKey` field at all (unmodified, written before Task 4 existed). This
  worktree's `/api/labs/receive/route.ts` (also unmodified — not in this task's diff; `git diff
  origin/dev --stat` confirms neither file is touched by Task 10) is the **pre-Task-4** version:
  `if (expectedApiKey && body.apiKey !== expectedApiKey) return 401` — i.e. it only enforces a key
  when `POCT_API_KEY` happens to be set in the environment. `origin/dev` (this branch's base) never
  got Task 4's PR (documented in `.ai/BACKLOG.md` under "Process gap found while rebasing Task 9's PR
  onto `dev`"), so on a bare `dev` checkout this env var would be unset and the route — and this
  test — would both behave exactly as originally written (no key, fail-open). The *only* reason it
  fails in **this** worktree is that `.env.local` was copied from the more-advanced main repo
  (`/workspace/iatrum-ucc/.env.local`, which has `POCT_API_KEY` set because Task 4 lives on
  `ai-work`), for unrelated reasons (`MEDPLUM_CLIENT_ID`/`MEDPLUM_CLIENT_SECRET` are required just to
  log in at all). Confirmed against the actual baseline file: `07 lab result ingest…` **passed** in
  `/workspace/ai-logs/baseline/results.json` (captured on `ai-work`, which already has Task 4). So
  "NEW FAIL" here is comparing a `dev`-based branch against an `ai-work`-based baseline — the exact
  same structural mismatch Task 9's own PR #223 hit and documented (`.ai/STATE.md` 2026-11-02 "D31":
  "two pre-existing gaps in `dev` unrelated to Task 9 ... logged in BACKLOG rather than fixed here, to
  keep this PR scoped"). Same call here: **not fixed in this PR** (that's Task 4's own standalone PR,
  already named as the remediation in BACKLOG.md); deliberately **not** worked around by unsetting
  `POCT_API_KEY` either, because this task's own new route (`/api/labs/receive/message`) and its own
  new e2e test need that key actually enforced to meaningfully test the wrong-key-rejection path.
- **Net result**: `lint: 0`, `build: 0`, `clinics: 0` (4-clinic isolation) on all 3 runs. e2e
  21/27 on the clean run, with every non-passing test accounted for: 2 already in baseline as expected
  fails (`inventory: validation returns 4xx not 500`, `11 known-bug probes summary`), 4 (`07`-`10`)
  tracing to the single pre-existing, already-documented `dev`-vs-`ai-work` Task 4 gap. **No failure
  traces to this task's actual diff** (`lib/poct/*`, the new route, `lab-service.ts`'s `_count` fix,
  the Lab tab pending list, or `poct.spec.ts`) — `poct.spec.ts` itself is 4/4 pass on the clean run.
- Draft PR opened: https://github.com/Iatrum/UCC/pull/227 — but `origin/dev` had moved (PRs #225
  `ai/fix-poct-billing` and #226 `ai/task-poct-toggle` merged while this round was in progress),
  making the PR `CONFLICTING`. Merged `origin/dev` into `ai/task-10` (`ab3a180`): 2 real conflicts —
  `lib/fhir/lab-service.ts` (origin/dev's `ai/task-poct-toggle` independently fixed the exact same
  `_count` truncation bug I found, in `getClinicPoctOrders`, with a more precise
  `_count: String(patientIds.length)` instead of my flat `_count: '200'`; kept theirs there and
  updated my other 3 fixes in the same file to match that style for consistency) and
  `e2e/tests/poct.spec.ts` (pure addition conflict — both sides appended a new test at the end of the
  file; kept both). `bun run lint` clean, unit tests 10/10 pass (my 7 + their 3 new
  `module-settings.test.ts`), `poct.spec.ts` 5/5 pass (my 4 + their 1 new PATCH/DELETE-toggle test)
  after the merge. Pushed `ab3a180`.
- Full gate rerun after the merge (`check-all.sh 10-r4`) got killed mid-run (exit 137, unrelated to
  the app — a session/connection stall killed the whole process tree; confirmed via orphan-process
  check that nothing of this run was still alive). It had gotten 24+ tests in cleanly before the kill,
  with one single-run failure (the new merged PATCH/DELETE test, 1.7m then failed) that didn't
  reproduce standalone (5/5 pass twice after restarting the dev server) — treated as more collateral
  from the same box-load conditions, not a real issue, consistent with the pattern throughout this
  round.
- Reran the full gate again (`check-all.sh 10-r5`) on a freshly restarted dev server: lint/build/clinics
  all 0, 24/30 e2e. One genuinely new finding: my own consolidated `poct.spec.ts` test failed
  *only* in the full-suite context (never standalone) — screenshot showed the Glucose analyser as
  "Offline" immediately after `signGlucoseOrder`'s own `beat(true)` call, meaning the composer's
  periodic analyser-status poll lagged behind the heartbeat under the accumulated box load of running
  25+ prior tests. The pre-existing "online + Sign" test avoids exactly this by re-beating right
  before each UI action; `signGlucoseOrder` only beat once at the top. Fixed by adding a bounded
  retry (fresh beat + page reload) if the Add button isn't enabled within 10s — same spirit as the
  existing test's pattern, not a new behavior. `bun run lint` clean; pushed (`ab64598`).
  `07`-`10` and `11 known-bug probes summary` remain the only other non-passes, both already
  accounted for (Task 4 gap, baseline-expected respectively) — unchanged from the prior analysis.
- **Independent review landed on PR #227** (`.ai/REVIEW-task10.md`, written by another session while
  this one was running) and found a real MAJOR: the task brief is explicit — *"POCT Lab and POCT
  X-ray must stay modular behind the existing feature toggle... gate all new UI and API by that
  toggle"* — but decisions 5/6 above deliberately left the new `/api/labs/receive/message` route and
  the "Pending POCT Tests" card ungated, reasoning (wrongly, per the brief) that order-creation-time
  gating was sufficient. Concretely: turning `poct` off for a clinic with an order already in flight
  did not stop results from still being ingested/displayed for it — not a real kill switch. Also a
  MINOR: no idempotency guard, so an HL7/ASTM retransmission (expected analyser behaviour, not an
  edge case) would create a duplicate `DiagnosticReport`.
- **Fixed both, commit `0da4d5b`** (session-continuity note: this commit was made and pushed in a
  resumed-but-then-re-stalled turn; recovered and verified on the next resume, nothing lost):
  `ingestAnalyserMessage` now derives the clinic from the `ServiceRequest`'s own `identifier` and
  checks `isModuleEnabledForClinic('poct', clinicId)` before writing anything (403 if off, via
  `ForbiddenError`); a `completed` order's retransmission now returns the *existing* `DiagnosticReport`
  instead of creating a second one (409 `ConflictError` if a completed order somehow has none); any
  other non-`active`/`on-hold` status is also rejected (409). `getPatientPendingPoctOrders` now takes
  an explicit `clinicId`, early-returns `[]` when the module is off, and scopes its own search by
  `identifier: clinic|<id>` too. `/api/labs/results` upgraded from bare authentication
  (`getMedplumForRequest`) to `requireClinicAuth` **plus an explicit ownership check** that the
  target patient/encounter actually belongs to the caller's clinic before returning anything — closes
  a real cross-clinic read gap on this endpoint that the review didn't even need to flag separately,
  found while implementing the toggle fix in the same function. `receiveLabResults` now stamps
  `identifier: clinic|<id>` onto every `Observation` and the `DiagnosticReport` it creates (needed for
  the idempotency lookup, and a correctness fix in its own right — those resources had no clinic
  identifier before). New e2e coverage for both: a replay test (same `diagnosticReportId` returned,
  exactly one `DiagnosticReport` exists, clinic identifiers present on it and its `Observation`s), and
  a module-disabled test (ingestion 403, order status unchanged, no report created, `pending: []`,
  Lab tab shows "No lab results available", no "Pending POCT Tests" card). `bun run lint` clean,
  `bun test tests/unit/poct-messages.test.ts tests/unit/module-settings.test.ts` 10/10 pass,
  `poct.spec.ts` 5/5 pass standalone. Already pushed to `origin/ai/task-10`.
- **Final full gate, run 3 times** (`10-final`, `10-final2`, `10-final3`) to separate real signal from
  this box's now-familiar dev-server-OOM-auto-restart noise: `10-final` hit one restart mid-run
  (`socket hang up` on 3 unrelated tests — confirmed via `⚠ Server is approaching the used memory
  threshold, restarting...` in the devserver log, self-healed); `10-final2` (same server, now under
  cumulative load from 2 consecutive full gates) hit a second restart mid-`workflow.spec.ts` test 06
  (`page.reload` 240s timeout spanning the restart); `10-final3`, on a freshly restarted dev server,
  ran clean: **25/30, lint 0, build 0, clinics 0**, with only the already-confirmed `07`-`10` Task-4
  gap and the baseline-expected `11 known-bug probes summary` not passing. Every POCT-specific test
  (including both the retry-fix target and the two new review-fix tests) passed in all 3 runs.
- **Status: done.** PR #227 is open, draft, `MERGEABLE`, all commits pushed. Not merging (not this
  round's job) and not starting Task 11 (owned by a different session per this round's instructions).

## Step log
- 2026-11-04 ~18:20–20:20: built hl7.ts/astm.ts/analyser-bot.ts/receive route/lab-service
  addition/results route/Lab tab UI/sim-analyser.ts/unit tests (see Plan above), all passing lint +
  unit tests. Session stalled (dead API connection) before writing this file, committing, or running
  e2e — **zero commits**, same failure mode as the prior two attempts, just caught earlier this time.
- 2026-11-04 21:22: resumed. Confirmed uncommitted edits were intact. Fixed the lint failure
  (`check-clinic-admin-medplum.mjs` flagged the new route) by moving it under `receive/message/`
  instead of a `receive-message/` sibling (decision 7 above) — `bun run lint` now clean. Committed WIP
  244de87, pushed `ai/task-10`. Added `e2e/lib/env.ts` `POCT_API_KEY` export + extended
  `e2e/tests/poct.spec.ts` with 2 new tests; started the shared :3210 dev server from this worktree
  (`bunx next dev --webpack -p 3210`, decision 9) since nothing was serving this worktree before.
- 2026-11-04 ~22:30–23:04: ran `tests/poct.spec.ts` twice (cold, then warm-rerun). Both runs: same 3
  failures. Root-caused both (decisions 8 and the `_count` bug above) via `error-context.md` snapshots
  and `/workspace/ai-logs/task10-devserver.log`, confirmed the `_count` truncation live with a
  throwaway script against this box's actual Medplum data (42 POCT patients, only 20 resolved).
  Session got interrupted (dead API connection) right as the second rerun was still running in the
  background — no code lost (already on disk), but the fixes above (lab-service.ts `_count`, the
  1-test rewrite of poct.spec.ts, this file) weren't committed yet going into this resume.
- 2026-11-04 ~23:3x (this resume): confirmed all edits from the previous step still on disk and lint
  still clean; dev server for this worktree still up on :3210. Wrote decisions 8/9 and this log entry,
  committed (f5b73d2) and pushed. Ran `poct.spec.ts` alone in the foreground (explicit timeout, no
  backgrounding): the `_count` fix confirmed working (test 2 passes), but my own new test then failed
  on a `signGlucoseOrder` race (see Failing tests above) — reproduced on both a stale and a freshly
  restarted dev server, ruling out the server as the cause. Fixed the test race, reran: **4/4 pass**
  (`/workspace/ai-logs/task10-poct-r5`). Next: full `e2e/scripts/check-all.sh 10` gate in the
  foreground, then commit, push, open the draft PR.
- 2026-11-05 (this resume): confirmed `0da4d5b` (review-fix commit from a prior stalled-but-recovered
  turn) was already committed and pushed, nothing uncommitted. Read `.ai/REVIEW-task10.md` and
  verified the fix fully addresses both the MAJOR (module-toggle kill switch) and MINOR (idempotency)
  findings, plus the extra cross-clinic read-gap closed on `/api/labs/results` along the way. Lint,
  unit tests, and `poct.spec.ts` all pass standalone. Ran the full gate 3 times to separate 2 more
  transient dev-server OOM-restarts from real signal; `10-final3` on a fresh server: 25/30, only the
  pre-existing Task-4 gap + baseline-expected probe summary not passing. Done — PR #227 stays open,
  draft, MERGEABLE. Not merging, not starting Task 11.
