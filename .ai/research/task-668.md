# Task 668 — C4 pilot release rehearsal

## Scope and versions

- Git refs fetched on 2026-11-19. `origin/main` was `7b024d10e0aede85f77557cab2c21455d9b8d992` (PR #253, 2026-11-16, app package `0.1.1`, Next.js `16.2.1`). `origin/dev` was `12df44577c9b94fd22448dfbdba1260633f8c0cb` (PR #328, Next.js `16.4.5`). Both frozen lockfiles resolve `@medplum/core` to `5.1.13`. The Git refs identify app source versions.
- The only Medplum endpoint used was `http://127.0.0.1:8113`. Its FHIR metadata reported Medplum `5.2.15-4d86215`, FHIR `4.0.1`. The runbook records a historical `5.2.8` brief and requires the owner to confirm the running production backend version. The Git refs contain no attestation of that runtime. The main-app smoke can exercise the exact Git revision against the authorized backend. If production uses a different Medplum patch, the backend requirement remains open until a rehearsal on an isolated fake-data instance of the confirmed patch. [Release hold and preconditions](../RUNBOOK-task5-production-migration.md#release-hold-and-what-has-actually-been-tested) · [FHIR R4 capabilities](https://hl7.org/fhir/R4/http.html#capabilities) · [FHIR R4 CapabilityStatement](https://www.hl7.org/fhir/R4/capabilitystatement.html)
- Reviewed the tagged Medplum access-policy implementation and version releases, the App Router build and start commands, React 19, and the DICOMweb transaction scope. The DICOMweb standard covers the Orthanc/OHIF transport tested by phase 3, which requires a separate synthetic PACS fixture. [Medplum 5.2.8](https://github.com/medplum/medplum/releases/tag/v5.2.8) · [Medplum 5.2.8 access-policy source](https://github.com/medplum/medplum/blob/v5.2.8/packages/server/src/fhir/accesspolicy.ts) · [Medplum 5.2.15](https://github.com/medplum/medplum/releases/tag/v5.2.15) · [Next.js 16 guide](https://nextjs.org/docs/app/guides/upgrading/version-16) · [Next.js CLI](https://nextjs.org/docs/app/api-reference/cli/next) · [React 19](https://react.dev/blog/2024/12/05/react-19) · [DICOM PS3.18](https://dicom.nema.org/medical/dicom/current/output/html/part18.html)

## Rehearsal and gate results

Both checkouts used the frozen lockfile and the local fake clinical environment. Each app ran with `next start` bound to loopback, one at a time, after a Webpack build. The app ports were `3668` for dev and `3669` for main. Available memory was checked before build/start/browser work, with a 2,560 MiB floor and a 3,072 MiB Node heap cap. Playwright used one worker, no retries, traces off and an outer timeout. Raw reports and server logs are retained privately under `/home/dev/ucc-task-668-evidence`.

The first dev gate attempt used the numeric loopback address as the app origin. Playwright's API requests lost the Secure session cookies and authenticated checks failed in setup. That attempt was stopped. The reported gate reran from the start using `localhost` for the app origin. Medplum stayed on `127.0.0.1:8113`.

### Exact main app

The exact `7b024d1` checkout passed lint and the Webpack production build. The fake clinician signed in and reached Dashboard. Registration then returned HTTP 500 from `POST /api/patients`. Medplum reported `OperationOutcomeError: Forbidden` after app validation. This is an app/AccessPolicy compatibility blocker for the release rehearsal. Main submits the Patient create with the clinician's Medplum client, and the current dev staff policy denies direct Patient create (recorded in `.ai/DECISIONS.md`: "Deny raw staff Patient creation; the authenticated registration server route creates/stamps Patients"; `app/api/patients/route.ts` on main calls `savePatientToMedplum` with the clinician client, on dev `savePatientToMedplumWithAdmin`). The Forbidden log line is the runtime evidence; the live policy resource was not separately dumped. Current dev's authenticated route uses its server-side registration path to assign the Patient to the authenticated clinic. The policy and the exact main code were left in place. The end-to-end check-in, sign, treatment, checkout and dispense sequence was blocked at registration.

An independent display smoke used a disposable Patient, Observation and DiagnosticReport with the fake clinician's clinic identifier and account, then removed them. The clinician read the same-clinic chart (HTTP 200), opened the editable Consult composer, saw the synthetic critical result and warning only in Labs & Imaging, and returned to the composer with neither displayed. The Billing & Documents page at `/orders` also rendered. This tested scoped chart and Lab rendering using fixtures; device ingestion, POCT online ordering and writes after registration were outside that smoke. [Medplum account assignment](https://www.medplum.com/docs/api/fhir/operations/set-accounts)

### Current-dev gate

`e2e/scripts/check-all.sh task-668` used the same local Task 341f baseline as Task 665. Lint/types, build, server readiness, and the clinics inventory exited 0. Playwright completed against `12df445` with **62 passed, 22 failed, 12 skipped, 0 flaky, and 0 global errors** across 96 tests in 12m 11s. Playwright exited 1 and `check-all.sh` ended **OVERALL: FAIL**. The local comparator marked 33 non-passing titles new, including skips, and one old Time Chit title missing after the rename to “Time Chit is core…”. The renamed Time Chit test passed. The clinics audit found 13 dev fixture clinics, 0 invalid account associations and 587 historical account omissions in its inventory mode. The run did not use strict account mode.

On an isolated recheck of `workflow.spec.ts` against the same dev app build, login, registration, check-in, consult signing and both composer checks passed. Lab ingest reproduced the historical HTTP 401 from the simulated-device guard and skipped the four later serial steps. The login timeout did not recur. The full-gate result remains the release evidence.

The gate passed the clinic-isolation spec, the checkout/dispense checks, the composer draft and save checks, and the explicit Lab-results-in-composer exclusion. The standard config excludes the opt-in admin audit. One checkout test is explicitly skipped. The Orthanc/OHIF phase-3 test skipped because this worktree had no dev PACS state. The other ten skips came from the serial workflow stopping at login.

Eighteen of the 21 Task 665 failures recurred. Patient CRUD and deep health passed, and the workflow's Lab ingest step was skipped before execution. The four additional failures relative to the Task 665 full report were:

| Test | Classification and cause |
| --- | --- |
| `dashboard-load-errors.spec.ts:8` Billing loading, error, Retry and list | Stale UI expectation. The mocked 500 surfaces “Failed to fetch consultations” from `describeFetchError`, and the spec waits for “Failed to load billable consultations.” |
| `dashboard-load-errors.spec.ts:31` Appointments error and Retry | Stale UI expectation. The mocked 500 surfaces “Failed to fetch appointments”, and the spec waits for “Failed to load appointments.” |
| `staff-membership.spec.ts:22` Membership CLI dry run, apply, isolation and rollback | Integration/fixture failure. The first valid dry run exited 1 in the full gate. In isolation the single-clinic scenario completed, then the multi-clinic dry run exited 1 at the same assertion. The report has only the exit code, so the reason remains unverified. |
| `workflow.spec.ts:33` Workflow login | Login/setup timeout. The browser did not reach the dashboard within 120 seconds. The isolated recheck passed login. The initial HTTP status was unavailable. |

## Task 665 failure inventory

Task 665's full report on `e072e57` recorded 69 passes, 21 failures and 6 skips. The subsequent targeted report on its then-current dev `fbdc693` reproduced 20 of the 21 failures. The table records the first failed check for each test. A check that failed in setup did not reach its later assertions.

| Test | Reproduced on Task 665 dev | Classification and cause |
| --- | --- | --- |
| `api.spec.ts:17` Patient CRUD, duplicate NRIC and archive | No | Test/environment flake. Initial registration failed once, then passed on dev. The report does not capture the failing HTTP status or establish a duplicate-fixture collision. |
| `api.spec.ts:84` Read endpoints return no 5xx | Yes | Environment/readiness. `/api/health/deep` returned 503 and was the sole 5xx. |
| `feedback.spec.ts:58` Enabled feedback, repeat count and scrubbing | Yes | Fixture timing suspected. The feedback trigger never appeared after the direct FHIR module write, which bypasses app-side module cache invalidation. |
| `module-toggle.spec.ts:66` Disabled PACS pages | Yes | Fixture timing suspected. The expected disabled message never appeared after the direct FHIR module write. |
| `poct.spec.ts:77` Offline analyser and clinic/server guards | Yes | Test/runtime mismatch. The production-mode app filters Devices tagged `simulated` before the offline state can be asserted. |
| `poct.spec.ts:101` Online analyser Sign, bill and no completed Procedure | Yes | Test/runtime mismatch. The simulated analyser was filtered, leaving Add disabled before Sign. |
| `poct.spec.ts:151` Disabled module hides composer and refuses order | Yes | Fixture timing suspected. The analysers API returned 200 after the direct FHIR disable write where the test expected 404. |
| `poct.spec.ts:245` HL7/ASTM bridge, Lab result and pending order | Yes | Test/runtime mismatch. The simulated analyser was filtered, leaving Add disabled before bridge assertions. |
| `poct.spec.ts:323` Disabling POCT blocks existing order mutation | Yes | Test/runtime mismatch. The initial order for the simulated analyser failed before the disable/mutation assertions. |
| `poct.spec.ts:374` Lab notifications, polling and socket cleanup | Yes | Test/runtime mismatch. The simulated device was rejected at message ingestion before notification and polling assertions. |
| `poct.spec.ts:469` Lab subscription auth, clinic scope and POCT toggle | Yes | Fixture timing suspected. The immediate toggle checks observed stale state and switched between module-denied 403 and transport-unavailable 503. A 503 is permitted with the channel enabled. |
| `poct.spec.ts:514` Device key rejection and foreign-clinic order protection | Yes | Test/runtime mismatch on the full run. Production-mode projection rejected the simulated device before the expected scope result. The targeted dev recheck stopped earlier when the POCT region was absent. |
| `workflow.spec.ts:165` Lab ingest and Labs & Imaging tab | Yes | Test/runtime mismatch. The simulated device was rejected with 401 before the result reached the Lab tab. |
| `xray-phase2.spec.ts:45` Viewer HTTPS allowlist, modality and default denial | Yes | Test/runtime mismatch. Ingest for a simulated device failed before the viewer assertions. |
| `xray.spec.ts:85` Offline X-ray device and clinic/server guards | Yes | Test/runtime mismatch. The simulated Device was filtered before the offline state could be asserted. |
| `xray.spec.ts:110` Online X-ray Sign, bill and no completed Procedure | Yes | Test/runtime mismatch. The simulated Device was filtered, leaving Add disabled before Sign. |
| `xray.spec.ts:153` Disabled X-ray module hides composer and refuses order | Yes | Fixture timing suspected. The device list returned 200 after the direct FHIR disable write where the test expected 404. |
| `xray.spec.ts:183` Simulated study, pending card, duplicates and bad key | Yes | Test/runtime mismatch. Add stayed disabled because the simulated device was filtered before study submission. |
| `xray.spec.ts:268` Disabling X-ray blocks existing order mutation | Yes | Test/runtime mismatch. The initial order for the simulated device failed before the disable/mutation assertions. |
| `xray.spec.ts:315` Device key permission and foreign-clinic order protection | Yes | Test/runtime mismatch. The production-mode projection rejected the simulated device with 401 before the scope check. |
| `xray.spec.ts:373` Radiology report authentication, scope and module toggle | Yes | Test/runtime mismatch. The production-mode projection rejected the simulated device with 401 before the scope check. |

The runtime mechanism is explicit in `lib/fhir/poct-device.ts` and `lib/fhir/xray-device.ts`. Their projections suppress simulated devices when `NODE_ENV=production`. `lib/fhir/device-keys.ts` uses those same projections before clinic/module authorization. The Task 665 gate used `next start`. The module fixture diagnosis is based on `lib/module-registry.ts`, `lib/server/module-ids-memo.ts` and the specs' direct Organization writes. There is no proof here of behavior after saving module changes through the app UI.

## Unit failures

Both Task 665 failures reproduced on `12df445` (`bun run test:unit`, 1,034 passed and 2 failed).

| Test | Classification and cause |
| --- | --- |
| `tests/unit/task643-checkout-invoice.test.ts:302` Foreign clinic invoice void/delete is denied and changes nothing | Stale test expectation. The scoped void lookup rejects with “Invoice not found.” and the first assertion expects “Access denied”. The later delete assertion was not reached. |
| `tests/unit/task639-scheduling-slots.test.ts:85` Refuses another clinic's schedule | Stale test expectation. The scoped lookup rejects with “Schedule unavailable in current clinic” and the assertion expects “does not belong”. |

## Task 669 independent review

Re-checked against the retained raw reports: main checkout `7b024d1` and the dev checkout (`12df445`-based tree) were clean at the stated revisions; Medplum was only `127.0.0.1:8113` with fake accounts. The Playwright JSON gives 62/22/12/0 flaky over 96 tests; the 22 failures are exactly the 18 recurring Task 665 titles plus the 4 listed. The 12 skips are 10 workflow steps, one dispense-checkout test and xray-phase3. Task 665's JSON (69/21/6) matches its stated numbers, and the only titles absent from the 668 failures are `api.spec.ts:17`, `api.spec.ts:84` and `workflow.spec.ts:165`, as stated. The renamed Time Chit test passed. Only this file and row C4 of `.ai/PILOT-READINESS.md` changed. Remaining unverified items are unchanged: staff-membership failure reason, production Medplum version, and the PACS fixture.
