# Task 783 — C4 full browser gate on current `origin/dev`

Head under test: `239510c` (origin/dev, merge of #359). Fake data only, dev Medplum `127.0.0.1:8113` (health `5.2.15-4d86215`, `ucc-medplum-dev`; production version parity is still unverified). Production build (`bun run build:ci` = `next build --webpack`, Node 22.23.5, 3072 MB heap, built in 2m12s), served with `next start` on port 3783 in its own process group, Playwright 1.59 with `--workers=1`, the opt-in admin audit (`UCC_ADMIN_E2E=1`), `warmup.mjs` first and `prune-fake-queue.ts` before. The whole run was timeout-wrapped (45 min cap; actual 15.9 min). The server group was killed afterwards (no `next start` or Playwright process left, port closed). Raw logs stay outside the repo in `/home/dev/task783-logs/`.

No `/workspace/ai-logs/baseline/results.json` exists on this host, so `compare.mjs` was not run; the comparison with Task 722/775 below is by hand.

## Results

| Run | Passed | Failed | Skipped | Total |
|---|---:|---:|---:|---:|
| Task 722 start (`aa19928`) | 94 | 2 | 2 | 98 |
| Task 722 final | 95 | 1 | 2 | 98 |
| **Task 783, `origin/dev` `239510c`, before fix** | **98** | **1** | **2** | **101** |
| Task 783 after the one test fix (failing spec re-run on the same build, warm-cache scenario) | 3/3 in that run | 0 | – | – |

Lint step (`tsc --noEmit -p tsconfig.lint.json` + clinic-admin check) and the production build passed. `clinic-check.ts` exit 0, `problems: []`, accounts `invalid: 0` (851 legacy `missing` are inventory only in phase-1 mode). The invalid dev record from Task 722 is gone (Task 775 finding confirmed). Both Task 722 failures are gone: workflow 11 (generic imaging billing, fixed by PR #352 / Task 775) passes, and the clinic data audit is clean. Three more tests than in Task 722 (101 vs 98) all passed.

## Remaining failure and skips

| Case | Class | Evidence | Action |
|---|---|---|---|
| `xray-phase2.spec.ts:46` X-ray viewer link | **Test/fixture race (not an app defect)** | Passed alone and with `xray.spec.ts`; failed in the full run. The ingest call answers `403 {"error":"PACS module is disabled for this clinic"}`. The test enables the `pacs` module by writing the Organization directly in Medplum, then ingests at once. The app memoises each clinic's enabled modules for 5 s (`lib/server/module-ids-memo.ts`, Task 547), so a warm cache from a previous test is stale. Reproduced deterministically: a warm-up spec that loads `/patients` and `/pacs` right before it fails the test with exactly that 403 (1.2 s). | Fixed: the `ingest` helper retries only the 403 "PACS module is disabled" case for up to 12 s; any other status fails immediately and the assertion now prints status and body. The same warm-up scenario then passes (7.7 s). |
| `dispense-checkout-ui.spec.ts:81` RM 0 / no-item checkout | Skip, known | Tracked in #279. | None. |
| `xray-phase3.spec.ts:90` stored DICOM matched by accession | Skip, environmental | Needs a dev PACS state directory and a callback configured for this app port. | None. |

Observation, not changed: device ingress uses the memoised module check, so for up to 5 s after an admin turns PACS off, X-ray ingress can still accept a study. `isModuleEnabledForClinicStrict` bypasses the memo and could be used there if that window matters. This is a hardening decision for the owner, not a pilot blocker.

## Honesty notes
- The final state is one full run (101 tests, 1 test fixture failure) plus a targeted re-run of the fixed spec. A second complete run after the fix was not done.
- Only one of the two permitted fixes was needed. No composer, sidebar/nav or POCT behaviour changed.

## References
[Playwright retries and polling](https://playwright.dev/docs/test-assertions#expecttopass) · [Next.js `next start`](https://nextjs.org/docs/app/api-reference/cli/next#next-start-options) · [FHIR R4 Organization](https://hl7.org/fhir/R4/organization.html)
