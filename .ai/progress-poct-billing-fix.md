# Task: fix POCT billing regression after PR #224 (21a8768)

## Setup
- Fresh worktree: `/workspace/ucc-pr-poct-billing-fix`, branch `ai/fix-poct-billing`, based on `origin/dev` @ 21a8768.
- `bun install` done. `.env.local` and `e2e/.secrets/{pw,poct_key,pacs_key}` copied from `/workspace/ucc-pr-poct-toggle` (gitignored, not committed).
- Dev server on **`:3213`** (not 3210/3211/3212, those belong to other worktrees/tasks).
  Start: `NODE_OPTIONS=--max-old-space-size=1536 bun run dev -- -p 3213` (background nohup, logs `/tmp/poct-billing-dev.log`).
  If unresponsive: `kill -9 <next-server pid from ss -tlnp | grep 3213>`, `rm -rf .next`, relaunch same command. Never touch :3210/:3212.
- Medplum (`:8113`) is shared infra, untouched.
- e2e run: `cd e2e && UCC_BASE_URL=http://localhost:3213 NODE_OPTIONS=--max-old-space-size=1536 UCC_REPORTS=/workspace/ai-logs/poct-billing-fix-reports npx playwright test <specs> --workers=1`.

## Investigation / root cause

Diff of PR #224 (262aec8, task9-fixes): only touches
`lib/fhir/lab-service.ts` (new `getClinicPoctOrders`/`PoctOrderSummary`/`getPatientDisplayName`,
pure additions), `app/(routes)/poct/page.tsx` (render real data), `app/(routes)/poct/new/page.tsx`
(retire legacy ungated form), `app/(routes)/patients/[id]/patient-profile-workspace.tsx`
(Consultation History table CSS only — **not** `handleTreatmentSign`), `e2e/tests/poct.spec.ts`
(added the `/poct` worklist assertion at the end of the "online + Sign" test).

**Confirmed NOT broken:** `handleTreatmentSign` (the Sign button handler that POSTs
`/api/labs/order` then `/api/orders`) and `app/api/orders/route.ts` (billing) are byte-identical
before/after #224. Verified by diff and by running the test repeatedly — `POST /api/orders` always
returned 200 in every run I captured (see dev server log), billing items / checkout price
(`Glucose (capillary)` RM 5.00) always correct when reached.

**Real bug found (in the new #224 code, reproduced 1-in-3/4 runs, deterministic once triggered):**
`lib/fhir/lab-service.ts` `getClinicPoctOrders()` searches `ServiceRequest` with an explicit
`_count: '200'`, but the follow-up `Patient` lookup
(`client.searchResources('Patient', { _id: patientIds.join(',') }, ...)`) had **no `_count`**, so
it fell back to Medplum/SDK's default page size of **20** (`DEFAULT_SEARCH_COUNT` in
`@medplum/core`). Once a clinic's shared Medplum instance (shared `:8113` across every worktree —
confirmed many stale `Glucose (capillary)` POCT `ServiceRequest`s already present from past task
runs, 10+ distinct patients) has more than 20 distinct patients with POCT orders, the Patient search
silently drops some IDs and `patientMap.get(patientId)` misses — `getClinicPoctOrders` falls back to
rendering the raw Patient UUID instead of the name. That's exactly what
`e2e/tests/poct.spec.ts:139` (`expect(page.getByText(f.patientName, {exact:true})).toBeVisible()`)
catches: reproduced via a full playwright run, screenshot/error-context showed the test's own
just-created patient's order row linking to `/patients/<uuid>` with the UUID as link text instead of
"POCT Fake bc233f48".

This is a genuine, real, accumulation-triggered bug introduced by #224's new worklist code — not a
test-expectation mismatch, and not the billing path (which I verified multiple times is unaffected).
It is the standing explanation for "POCT online + Sign ... preserves bill" intermittently failing on
this shared box, since the shared Medplum instance accumulates POCT orders across every task that
exercises `poct.spec.ts`.

I was not able to reproduce the *literal* "times out waiting for POST /api/orders" symptom quoted in
the task description — billing POST always completed in every run I captured, including the one
that failed later at the `/poct` worklist assertion. My working theory is the reporter's exact line
number was an approximation of "this test failed after Sign" rather than a literal timeout on that
specific fetch; the only reproducible, data-dependent failure in this exact test, under this exact
shared-infra condition, is the `_count` bug above.

## Fix applied
`lib/fhir/lab-service.ts`: added `_count: String(patientIds.length)` to the Patient `_id` lookup in
`getClinicPoctOrders`, so the number of patients requested always matches the number of distinct
patient IDs needed (bounded by the `_count: '200'` cap on the ServiceRequest search already in
place).

## Status / remaining steps
- [x] Root cause found, fix applied (lab-service.ts `_count` fix).
- [x] Committed (e6928fd) and pushed `ai/fix-poct-billing` to origin.
- [x] Re-ran `poct.spec.ts` alone (3/3 pass) and `poct.spec.ts + workflow.spec.ts` together:
      poct.spec 3/3 pass, workflow.spec 01-05 pass, **06 "composer (plan API stubbed...) -> Sign"
      failed** with `OperationOutcomeError: Unauthorized` from the e2e helper's own admin Medplum
      client (`e2e/lib/fhir.ts` `byPatient()`, line 135 of workflow.spec.ts), test took 2.7 minutes
      (vs ~18s for the adjacent test 05) — abnormal duration, box was under heavy memory pressure
      (13-14Gi/15Gi used, <500Mi free) from concurrent dev servers on :3210/:3212/:3213 etc.
      **Not caused by my change**: `getClinicPoctOrders` (the only function I touched) is called
      exclusively from `app/(routes)/poct/page.tsx`; workflow.spec test 06 never visits `/poct` —
      it only exercises meds/services/labs/imaging/MC/referral in the composer and then queries
      MedicationRequest/ServiceRequest/Procedure/DocumentReference/Encounter directly via the
      admin FHIR client. No code path overlap with the one line I changed. The admin client's
      session (`e2e/lib/fhir.ts`, memoized per worker process, logged in once at suite start) ran
      out — almost certainly because the test itself took far longer than normal under memory
      pressure (typeahead/UI actions slowed down), pushing elapsed time past the admin token's
      expiry with no refresh-token fallback in that *test helper* (separate from the app's own
      session refresh in `lib/server/medplum-auth.ts`). This is a pre-existing environmental/infra
      flake, not a regression from this diff — did not attempt a fix (out of scope, and a `dev`
      HEAD re-run would cost more box resources for a logically-impossible-to-relate failure).
- [x] `api.spec.ts:32` inventory POST without strengths returning 500: fixed in
      `app/api/inventory/route.ts` POST — added `Array.isArray(data?.strengths)` 400 check
      alongside the existing `name` check (the crash was `data.strengths.map(...)` in
      `lib/fhir/inventory-service.ts:67` when `strengths` is omitted). Verified:
      `api.spec.ts` (12/12) + `poct.spec.ts` (3/3) together pass, 15/15.
- [ ] Full e2e suite once, foreground, `:3213`, `--workers=1`, `NODE_OPTIONS=--max-old-space-size=1536`.
- [ ] Commit (no secrets), push `ai/fix-poct-billing` (normal push).
- [ ] Open draft PR into `dev`, verify `gh pr view --json mergeable` is `MERGEABLE`.
- [ ] Write summary to `/workspace/ai-logs/ucc-poct-billing-fix.md`.
- [ ] Stop the `:3213` dev server.

## Environment notes
- System under heavy memory pressure (12-14Gi/15Gi used) from many concurrent worktree dev servers
  (3210, 3212, 3300, 14007, etc. — other parallel tasks). This causes some genuine flakiness
  (slow Turbopack compiles, occasional session-refresh 401s) independent of the code bug above —
  don't over-index on any single flaky run; the `_count` bug is the one I could deterministically
  explain and reproduce.
