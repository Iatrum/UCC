# Task 360 — integration review of PRs #236–#245

**Recommendation: resolve #245's fixture incompatibility before completing this stack. The original single integration gate is FAIL (58/62, zero skips); it must not be relabelled PASS.**

## Reproducible scope and merge order

Pinned base: `7c42a6d21cf57494d39b682f8b3413ece93f0bd0` (origin/dev at task start). Local integration: `/home/dev/ucc-int-360`, branch `int/360`, HEAD `fb77925e232a37a5e5ce1bcb4860e2e3108cbf0f`. All ten PRs were OPEN DRAFT when inspected. Remote `origin/dev` advanced independently during the run; this report does not claim to test those later commits.

Recommended order, matching the tested order: **#236 → #237 → #238 → #239 → #240 → #241 → #242 → #243 → #244 → #245**. Required dependency chains: #236 → #240 → #241 (per-device keys, X-ray links, clinic scoping), and #243 → #244 (write containment, triage/check-in coverage). #237 cleanly auto-merges its stricter assertions after #236. Reordering cannot fix #245's old function-call signatures.

| PR | Pinned head | Local merge | Conflict |
|---|---|---|---|
| [#236](https://github.com/Iatrum/UCC/pull/236) | `97d5b6ea09e5aabe6e279fa9d79b7637242e919b` | `95036ac` | None |
| [#237](https://github.com/Iatrum/UCC/pull/237) | `9c2098dd46af37a66892f3ba08d8cc7ed2f85687` | `636ed7e` | None |
| [#238](https://github.com/Iatrum/UCC/pull/238) | `7dbf97ef696b37841e870282b83d51a635f10c04` | `f543f89` | None |
| [#239](https://github.com/Iatrum/UCC/pull/239) | `e1d1676fee469d9c385a69f8d9acd2fd7eb09703` | `2a260e1` | None |
| [#240](https://github.com/Iatrum/UCC/pull/240) | `6e4cbef9161173d93c5661958078711a2ef87c98` | `cdbbd44` | None |
| [#241](https://github.com/Iatrum/UCC/pull/241) | `d5435729ebdacd4b759da50bab8c69ed9a20c9d2` | `63950df` | None |
| [#242](https://github.com/Iatrum/UCC/pull/242) | `0c46452cd3bac96111b9300988732779582aa9ee` | `a437366` | None |
| [#243](https://github.com/Iatrum/UCC/pull/243) | `72ec9707a3c8bdd84da4aae33985f5e40dd4206a` | `4489949` | None |
| [#244](https://github.com/Iatrum/UCC/pull/244) | `387aa3d159b52945877d20aa2263f42d38e8ec91` | `ff7e9a3` | None |
| [#245](https://github.com/Iatrum/UCC/pull/245) | `b1977f5fa9506e23eb6e43bf50dc13cfffd16c63` | `fb77925` | BACKLOG only |

## Every merge conflict and resolution

Exactly **one conflict**, while merging #245: `.ai/BACKLOG.md`, combined hunk `@@@ -20,4 -19,4 +20,8 @@@`, the final historical extended-header paragraph. Conflict inputs are stage-2 blob `b9b5a5d` (#236's Task 180 amendment) and stage-3 blob `6b8bf5a` (#245's Task 330 resolved entry).

- Ours: the old “New (Task 090 Phase 1.4)” entry plus #236's receive-path resolution and Device-derived clinic evidence.
- Theirs: “Resolved (Task 330, 2026-11-15)” documenting existing per-request extended reads and the new regression test.
- Resolution: use #245's resolved paragraph, retaining #236's containment evidence as the appended sentence below. No product-source conflict, no PR branch changes.

```text
**Task 180 receive-path containment remains:** the authenticated Device supplies the clinic; `assertOrderInDeviceClinic` validates the order identifier and accounts against it, with Lab/Imaging account propagation covered by `e2e/tests/clinic-isolation.spec.ts`.
```

Exact original combined diff: `/home/dev/ai-logs/int-360/conflicts-245.diff`. All ten merge logs: `merge-236.log` through `merge-245.log` in the same directory. The resolution is committed in local merge `fb77925`; `int/360` was never pushed.

## Single full gate and comparison

Invoked exactly once:

```sh
NODE_OPTIONS=--max-old-space-size=3072 bash e2e/scripts/check-all.sh int-360 /home/dev/ai-logs/feedback-rep/results.json
```

| Check | Result |
|---|---|
| Lint/types and clinic-admin guard | PASS, exit 0 |
| Next.js production build | PASS, exit 0 |
| Full Playwright, one worker | **58 passed / 4 failed / 0 skipped**, exit 1 |
| Clinic inventory/check | PASS, exit 0 |
| Historical-results comparator | FAIL, one new failing title |
| Overall original gate | **FAIL**, exit 1 |

Playwright duration: 1,196.182 seconds, completed within the existing 20-minute timeout. No full-gate rerun. Default harness scope excludes the opt-in admin audit; default clinic account mode inventories missing historical accounts rather than enforcing strict completeness.

**Baseline limit:** no clean origin/dev full-suite JSON existed on this host. The comparator uses the latest retained broad full run, `/home/dev/ai-logs/feedback-rep/results.json` (2026-11-15 19:43 UTC; 35 pass / 11 fail / 8 skip), from earlier Feedback testing, not a controlled clean-base run. Thus it detects changed outcomes but alone cannot prove PR causality. Integration has eight added passing titles, 16 formerly failed/skipped titles now passing, and no missing titles. Exact title comparison: `comparison-summary.json` beside the gate logs.

All four original failures:

| Test | Versus retained comparison | Evidence and attribution |
|---|---|---|
| POCT “Lab subscription notifications refresh results without navigation; dropped sockets poll and unmount cleans up” | **New failure** | `e2e/tests/poct.spec.ts:444`: after disabling POCT with PACS already off, expected empty state within 40s; last 8.2 mmol/L fake report remained. Websocket notification refresh and dropped-socket polling had already passed. #238 changes the live-result updater; #236 changes the fixture/ingress. Causality requires isolation; concurrent dev tasks were observed. Focused replay recorded below. |
| Staff membership CLI dry-run/apply/rollback | Failed previously | `staff-membership.spec.ts:103`: expected “No active PractitionerRole”; CLI returned its sanitized generic stop message. CLI still uses nonexistent `/workspace/ai-logs/...` backup root and creates it before role validation. CLI unchanged by all ten PRs. Host-path cause is strongly indicated, not proven by unsanitizing an exception or a second apply. |
| Time Chit toggle/composer/checkout/history | Failed previously | `time-chit.spec.ts`: 45s `page.waitForResponse` timeout. Not newly failing by this comparator; no controlled-base replay or specific PR attribution established. |
| Workflow “11 known-bug probes summary” | Existing expected failure; skipped in retained run | Reports generic lab/imaging orders written as completed Procedures at Sign. Workflow steps 01–10 all pass in this run. Do not claim this behavior was repaired or introduced by this stack. |

Relevant successes: clinic isolation; all four draft-retention tests; all seven save-state tests; all five Lab-result-state tests (including no results in composer); POCT offline/online ordering and device-key boundaries; all seven X-ray tests, including foreign patient/encounter rejection; workflow signing, real autosave, unavailable persistence, Lab ingest/display, documents and checkout. This is evidence for tested flows, not a guarantee against every regression.

## Confirmed PR attribution from supplemental unit tests

| Run | Result |
|---|---|
| Pinned clean origin/dev `7c42a6d`, unit suite | 34 pass / 0 fail |
| Integrated heads, original unit suite | **84 pass / 2 fail** |
| #245 alone (`b1977f5`), extended-account tests | 3 pass / 0 fail |
| #236 plus original #245 test file only | **1 pass / 2 fail**, same two failures |
| #236 plus scratch-only repaired #245 fixture | 3 pass / 0 fail |

**Confirmed integration test regression: #245 is incompatible with #236.** #236 requires a Device-derived `deviceClinicId` for `receiveImagingStudy` (fourth argument) and `receiveLabResults` (fifth). #245's test calls at lines 65/73 omit it and throw `ForbiddenError: Order has no clinic identifier` at `lib/fhir/clinic-tenancy.ts:287`, before account stamping. Its Organization account fixture must also match the HealthcareService tenant model. Update the test fixture, never weaken the clinic guard. Both service tests fail; the fake-client-header sanity test passes. No runtime product regression is established by these fixture failures.

Exact suggested fixture patch, validated in `/home/dev/ucc-int-360-attribution` only; **not applied to int/360 or any PR branch**:

```diff
--- a/tests/unit/extended-accounts.test.ts
+++ b/tests/unit/extended-accounts.test.ts
@@ -8 +8 @@
-const ACCOUNT = { reference: "Organization/fake-account-a" };
+const ACCOUNT = { reference: "HealthcareService/fake-account-a" };
@@ -35,0 +36,5 @@
+    async searchOne(type: string) {
+      if (type === "Organization") return { resourceType: type, id: "fake-org-a" };
+      if (type === "HealthcareService") return { resourceType: type, id: "fake-account-a" };
+      return undefined;
+    },
@@ -65 +70 @@
-    } as any, client);
+    } as any, client, "fake-clinic-a");
@@ -73 +78 @@
-    ] as any, undefined, client);
+    ] as any, undefined, client, "fake-clinic-a");
```

Unit logs: `unit-origin-dev.log`, `unit.log`, `unit-pr245-alone.log`, `unit-pr236-plus-pr245.log`, and `unit-pr236-plus-pr245-fixture-repair.log` under `/home/dev/ai-logs/int-360/`.

## Focused subscription replay

**PASS on unchanged integration code: 1/1, zero skips, ~2.6 minutes total.** Replayed only the subscription-notification test with one worker and a 300-second external timeout, sequentially with no other observed dev server. Evidence: `/home/dev/ai-logs/int-360/subscription-replay/reports/results.json` and `subscription-replay/e2e.log`. The test passed notification refresh, dropped-socket polling, POCT-off clearing, SPA unmount and no subsequent reads.

This does **not** turn the original gate into a pass. It establishes that the new full-run failure is not reproduced in isolation; no specific PR is proven to cause a runtime regression. Investigate shared-clinic toggle/test interference or timing before accepting a clean full-run claim. The confirmed #245 fixture incompatibility remains independent of this replay.

## Host adaptations and safety boundaries

Only ignored dev `.env.local` and `e2e/.secrets` copies were used; values were not printed or committed. Shared dependencies were linked without installation. `.env.local` Medplum URL host/port were checked without printing credentials: loopback port 8113 only. Existing test guards require the literal localhost spelling for that loopback service. No production containers, Docker actions, `/opt/medplum`, `/root`, Supabase, Tradebot, or real patient data were accessed.

The host has no `/workspace`. Throwaway-only modifications redirect the harness output paths and draft screenshot/staff expected-backup paths to `/home/dev/ai-logs`; environment overrides redirect other reports/evidence/screenshots. The migration CLI's hard-coded backup root was not changed. Exact host-only diff: `/home/dev/ai-logs/int-360/host-adaptations.diff`. These three tracked test/harness edits remain uncommitted in the throwaway integration worktree and are absent from the report branch. Product code was not edited.

Original :3210 server was stopped by its verified dev-only process group. The integration server used `-H 127.0.0.1 -p 3210 --webpack` and the 3072 MB heap cap, with automatic whole-group termination and original-worktree restart. Other dev servers appeared on :3412, :3340 and :3341 and exited independently; they were never killed by this task. Their concurrency makes memory/clinic-toggle interference plausible; it is not proven to explain the new subscription failure. See final restoration verification below.

No sidebar/nav or composer source changes made by this task. Firebase Storage retained. Only documentation is published on `ai/task-360-int-report`, based on the pinned initial dev. No PR created, no remote merge, no force push, and no push to PR heads or int/360.


Final restoration verified: both temporary integration process groups (731020 and 751842) are absent. Restored server process group 753896 has cwd `/home/dev/iatrum-ucc`, `NODE_OPTIONS=--max-old-space-size=3072`, and explicit `--webpack -H 127.0.0.1 -p 3210`. `/login` on 127.0.0.1:3210 and dev Medplum `/healthcheck` on 127.0.0.1:8113 both return HTTP 200. The restored original-worktree server is the explicitly requested exception to temporary-server cleanup.
