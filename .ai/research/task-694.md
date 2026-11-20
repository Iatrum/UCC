# Task 694 — full browser gate on the PR #334 branch (PILOT-READINESS C4)

Branch `ai/task-674-fix-failing-tests` at 869c9ec (contains current `origin/dev` b22d32e after Tasks 692/693). Production build (`check-all.sh`: lint, `build:ci`, `next start`) on `:3694`, fake data, dev Medplum `127.0.0.1:8113` only, 1 worker, heap 3072 MB, `free -m` checked first. Server killed (whole process group) afterwards. Docs: [Playwright serial/strict locators](https://playwright.dev/docs/locators#strictness), [Next.js `next start`](https://nextjs.org/docs/app/api-reference/cli/next#next-start-options), [FHIR R4 Device](https://hl7.org/fhir/R4/device.html).

## Gate counts

| Run | Passed | Failed | Skipped / did not run |
|---|---|---|---|
| Task 668 (dev 12df445) | 62 | 22 | 12 |
| Task 694 before (this branch, unchanged) | 76 | 15 | 2 + 4 |
| Task 694 after (final gate, same build mode) | **94** | **1** | 2 |

The remaining failure is `workflow 11 known-bug probes summary`, designed to fail (it re-asserts the known-bug list). The `check-all.sh` comparator still prints `NEW FAIL` for the xray-phase3 skip (baseline ran it) and `MISSING` for the renamed Time Chit test; both are baseline artefacts, not regressions. No app code changed.

## Per-spec verdicts (the 15 failures before)

| Spec(s) | Verdict | Cause and fix |
|---|---|---|
| poct x6 (offline, online+Sign, HL7/ASTM, disabled-after-order, subscription, per-device keys), xray x6 (offline, online+Sign, simulated study, disabled-after-order, per-device keys, radiology report), xray-phase2 viewer link, workflow 07 lab ingest (14 tests) | Stale test (test/runtime mismatch) | Fixtures tagged Devices `simulated`; `lib/fhir/{poct,xray}-device.ts` deliberately hide those when `NODE_ENV=production` (and the gate is a production build), so Add stayed disabled / keys got 401. Tag now opt-in via `e2e/lib/device-meta.ts` (`UCC_E2E_SIMULATED_TAG=1`, dev server only). App behaviour is correct and unchanged. |
| staff-membership CLI | Flaky (environment) | Medplum auth rate limit: the CLI's own admin login returned `429` (message now in the assertion). `cli()` waits 65 s and retries, max 3, only for `Admin login failed (429)`. Passed in isolation 3x. |
| workflow 11 known-bug summary | Real, known app behaviours (kept as designed) | (1) Generic imaging order writes a completed `Procedure` billing line at Sign (device orders do not). Changing it reshapes billing/composer: not a small contained fix, left for the owner. (2) The old `/api/labs/receive 500 without status` probe was **stale**: the route returns a deliberate 400 `results[0].status is required`; the probe is now a hard assertion of that contract. |

## Extra flakes found while re-running (fixed)

| Spec | Verdict | Fix |
|---|---|---|
| time-chit | Flaky / fixture duplicates | `TIME CHIT … RM` button matched 2 catalog entries (strict-mode violation). `.first()`, same as the MC/referral lookups in the same spec. |
| workflow 03 | Flaky (id collision) | `RUN` was minute-granular, so two gates in the same minute on the shared dev Medplum produced two queue rows with one name. `RUN` now adds seconds and a numeric random tail (still digits: api.spec derives an NRIC from it). |
| poct subscription/module-toggle, workflow 07 (403) in a mid run | Environment interference | Failed only while another agent's gate used the same dev Medplum clinic; passed in isolation and in the final gate. No change beyond the existing 5.5 s memo settle. |

## Still skipped (not failures)

- `dispense-checkout-ui:81` RM 0 / no-item checkout — explicit `test.skip` (needs #279).
- `xray-phase3` — needs a dev PACS state dir (`PACS_DEV_STATE_DIR`), not provisioned on this box.

## Constraints kept

Composer untouched, Lab/POCT results only in the Lab tab, POCT order only with an online analyser, clinic data separate, Firebase Storage unchanged, no nav changes. Raw logs retained privately in `/home/dev/ucc-694-evidence` (not committed).
