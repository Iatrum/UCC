# Task 722 — C4 browser gate on PR #334

The starting PR head is `aa19928`, which already contains `origin/dev` at `b22d32e`. The requested merge reported “Already up to date.” The isolated worktree uses the checked-in lockfile. Medplum health on `127.0.0.1:8113` reports `5.2.15-4d86215` under `ucc-medplum-dev`. This rehearsal uses fake data on that instance, so exact production-version parity remains unverified.

The browser gate uses Next.js 16.4.5, React 19.2.6, Medplum SDK 5.1.13, Playwright 1.59.1, and Node 22.23.5. The app is built with `bun run build:ci` and served with `next start` at `localhost:3222`. Each full run uses `check-all.sh`, timeout-wrapped Playwright, one worker, the opt-in admin audit, and a 3072 MB Node heap cap. The gate wrapper owns the app process group and shuts it down at exit. Raw evidence is held privately outside the worktree.

The first rebuild was stopped when available host memory went below 400 MB. The retry used the documented `webpackBuildWorker` and `webpackMemoryOptimizations` settings for compilation, with TypeScript checking enabled. The worktree config was restored before serving the build. [Next.js memory usage](https://nextjs.org/docs/app/guides/memory-usage)

## Official references

- Next.js 16 documents `next build` followed by `next start` for production mode. The repository’s `build:ci` selects Webpack. [Next.js CLI](https://nextjs.org/docs/app/api-reference/cli/next) · [Next.js 16 upgrade guide](https://nextjs.org/docs/app/guides/upgrading/version-16)
- React 19 documents the client and server rendering behavior used by the app. [React 19 release](https://react.dev/blog/2024/12/05/react-19)
- The Medplum 5.2.8 release is the requested reference. Server results below are for the version reported by dev health. [Medplum v5.2.8](https://github.com/medplum/medplum/releases/tag/v5.2.8)
- FHIR R4 defines `ServiceRequest`, `Observation`, `DiagnosticReport`, and `ImagingStudy` and their diagnostic workflow relationships. DICOM PS3.18 covers DICOMweb access to images and related objects. [FHIR R4 Diagnostics Module](https://hl7.org/fhir/R4/diagnostics-module.html) · [DICOM PS3.18](https://dicom.nema.org/medical/dicom/2026b/output/chtml/part18/PS3.18.html)
- A FHIR R4 `Procedure` records an action that is or was performed. The `completed` event status indicates that the action ended. [FHIR R4 Procedure](https://hl7.org/fhir/R4/procedure.html) · [FHIR R4 EventStatus](https://hl7.org/fhir/R4/codesystem-event-status.html)
- Playwright documents strict locators, isolation and production server orchestration. [Locators](https://playwright.dev/docs/locators#strictness) · [Web server](https://playwright.dev/docs/test-webserver)

## Gate results

| Playwright run | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Before (`aa19928`) | 94 | 2 | 2 |
| After app fixes, before admin and clinic test fixes | 93 | 3 | 2 |
| After admin and clinic test fixes, before POCT locator fix | 94 | 2 | 2 |
| After all fixes | 95 | 1 | 2 |

The two skips are the zero-item checkout scenario tracked in #279 and the live DICOM scenario, which requires a dev PACS state directory and a callback configured for this app port. The X-ray module-toggle, ingress, and clinic-scoped viewer-link tests ran.

The corrected POCT worklist assertion passed three consecutive targeted runs against the same production build.

The final `check-all.sh task-722-verified` run passed lint, build, and the Playwright baseline comparison with zero new browser failures. The raw Playwright run failed on the known imaging issue. `check-all.sh` reported overall failure because the separate clinic data audit still found the pre-existing dev record described below. The test server process group exited and port `3222` closed.

Standalone `tsc --noEmit`, `bun run lint`, and all 1,227 unit tests passed after the app fixes. Repo-wide `bun run lint:eslint` produced identical output before and after, with two `react-hooks/refs` errors in `lib/hooks/use-consultation-draft.ts` and nine warnings. ESLint passed on the five changed source and test files.

## Failure triage

| Case | Classification and evidence | Resolution |
| --- | --- | --- |
| Admin audit, baseline | Test configuration. It compared `UCC_BASE_URL` to `http://localhost:3210` and failed on `:3222` before login. Its request allowlist and evidence path were also fixed to the reference environment. | Validate a loopback app origin and the dev Medplum origin, scope the browser allowlist to those origins, and put evidence under `UCC_EVIDENCE`. Use the separate **Save details** and **Save modules** controls from Task 510. |
| Admin Branches and Users, focused run | App defect. Both pages streamed an RSC error. The server named the `onFocus` function emitted by the shared `Input`. Creating a branch, inviting a user, and deleting a user also reported render errors on their destination lists. | Mark `Input` as a client entry point so it can retain its numeric-focus behavior. [Next.js client boundary](https://nextjs.org/docs/app/api-reference/directives/use-client) |
| Admin retained session, focused run | App defect. The list request immediately after deactivation received HTTP 200. Medplum rejected the scoped search with an `Unauthorized` OperationOutcome, which the patient list service caught and converted to an empty result. | Propagate unauthenticated outcomes to the existing route error handler, which returns 401. The browser assertion continues to require 401 or 403. [Medplum isUnauthenticated](https://www.medplum.com/docs/sdk/core.isunauthenticated) |
| Admin organisation cleanup, focused run | Test timing. Navigation to the organisation detail reached the 240-second `networkidle` timeout. | Wait for DOM content and keep the existing visible main content and heading assertions. [Playwright navigation](https://playwright.dev/docs/api/class-page#page-goto) |
| Admin Branches and Users, first full rerun | Test selector. The server rendered the pages after the app fix. React streaming exposed one visible `main` and a hidden duplicate while the DOM settled, and the CSS selector failed strict mode. | Locate the accessible `main` landmark and scope the visible heading or card title assertion to it. |
| Clinic isolation login, first full rerun | Environment rate limit. Medplum returned 429 on the admin login immediately after the opt-in audit. The same fixture passed in the baseline. | Retry that login once, only for 429, honoring the route's `Retry-After` value within a bounded wait. |
| POCT online + Sign, subsequent full rerun | Test selector. The order, billing, and checkout assertions passed. The worklist text matched a visible patient link and a hidden streamed duplicate with the same href. | Assert the accessible patient link by its exact name. |
| Workflow 11 | App defect, reproduced. Workflow 06 persisted a generic imaging request alongside an `Imaging:` Procedure with `status=completed` at Sign. Workflow 11 reports that evidence. | Follow-up below. |
| Clinic data audit | Existing dev-data defect. Both the missing clinic identifier and the invalid account reference point to one record. Its reported last update and only history version precede the baseline by nearly eight hours. Clinic-isolation browser coverage passed. | Leave the shared record in place for the owner to investigate. |

## Follow-up for generic imaging billing

`handleTreatmentSign` in `patient-profile-workspace.tsx` includes generic imaging in billable procedures, and `consultation-service.ts` writes those entries as completed FHIR Procedures. The order route separately writes a ServiceRequest. Move generic imaging billing to the encounter's investigation billing representation. The change spans Sign, checkout, and historical billing reads. Verify that a pending order produces one charge and no completed Procedure, and that legacy billed encounters remain readable without duplicate charges.
