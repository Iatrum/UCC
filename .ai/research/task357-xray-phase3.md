# Task 357: X-ray phase 3 (Orthanc + OHIF, ImagingStudy ingress, scoped viewer)

Plan, setup and production notes: `.ai/PLAN-xray-phase3.md`. This file records what was checked and where.

## Checked against official docs
- Orthanc Lua (`OnStableStudy(studyId, tags, metadata)`, fired after `StableAge` seconds without a new instance; `HttpPost(url, body, headers)`; one Lua context, callbacks in mutual exclusion; "odds are high that you meet a deadlock" when the called service calls back into Orthanc's REST API; make it asynchronous): https://orthanc.uclouvain.be/book/users/lua.html
- Orthanc DICOMweb plugin (`Enable`, `Root`, `EnableWado`; host for returned URLs guessed from `Host` / `X-Forwarded-Host` / `Forwarded`; from plugin 1.25 `AllowedHosts` or `Host` should be set; shares the HTTP server's authentication): https://orthanc.uclouvain.be/book/plugins/dicomweb.html
- `orthancteam/orthanc` image, env-var configuration (`ORTHANC__...`, `DICOM_WEB_PLUGIN_ENABLED`): https://orthanc.uclouvain.be/book/users/docker-orthancteam.html
- OHIF DICOMweb data source (`wadoRoot`, `qidoRoot`, `thumbnailRendering`, `bulkDataURI`, `dicomUploadEnabled`): https://docs.ohif.org/configuration/dataSources/dicom-web . `omitQuotationForMultipartRequest` is not on that page; it is taken from OHIF's Orthanc example config and works here.
- FHIR R4 ImagingStudy (`subject` 1..1, so an unmatched study cannot be an ImagingStudy; Study Instance UID as identifier `urn:dicom:uid` / `urn:oid:<uid>`; `basedOn`): https://hl7.org/fhir/R4/imagingstudy.html
- FHIR R4 Task (`status` requested/completed/rejected, `intent`, `focus`, `input`): https://hl7.org/fhir/R4/task.html
- DICOM: AccessionNumber (0008,0050) is VR SH, 16 characters max (PS3.5 section 6.2); DICOMweb QIDO-RS/WADO-RS resources (PS3.18): https://dicom.nema.org/medical/dicom/current/output/html/part18.html
- Next.js `after()` from `next/server` (runs work after the response; route handlers; Next 16.2.1 installed): https://nextjs.org/docs/app/api-reference/functions/after
- Next.js 16 route handlers, `params` is a Promise: https://nextjs.org/docs/app/api-reference/file-conventions/route

## Checked on the live dev containers
- Orthanc 26.11.0: anonymous requests get 401; plugins loaded: `dicom-web` 1.24, `gdcm`, `orthanc-explorer-2`.
- Deadlock reproduced: UCC reading `/studies/{id}` while the Lua `HttpPost` was waiting timed out at 15 s and Orthanc logged HTTP 502 from the hook. Fixed by answering 202 and ingesting after the response.
- `Forwarded: host=...;proto=...` is honoured by plugin 1.24: `BulkDataURI` values switch from `http://127.0.0.1:8042/...` to the forwarded origin.
- Lua can read a file with `io.open` (key file mounted read-only), so the device key rotates without a restart.
- OHIF v3.13.14 renders the synthetic DX study through the UCC proxy in headless Chromium (screenshot in `.ai/ux-shots/task357/`).

## Design decisions
- Webhook payload is only a pointer (`orthancStudyId`); UCC reads tags from Orthanc itself.
- Unmatched studies are FHIR `Task` resources (code `https://ucc.emr/pacs/task|unmatched-study`), read and written with the server client scoped by the caller's clinic, like X-ray Devices.
- The "stored in PACS" marker (`meta.tag` `https://ucc.emr/pacs|orthanc`) is set only by the server-side ingress, never from a device JSON payload, so a device cannot make UCC mint a viewer link for an arbitrary Study UID.
- Viewer capability = signed token, not the UCC session: the viewer is another origin, and the session cookie must not be shared with it.

## Validation
- `bun test tests/unit`: 180 pass. `tsc --noEmit -p tsconfig.lint.json` and `scripts/check-clinic-admin-medplum.mjs` clean. eslint on touched files: one error, pre-existing (`components/labs/lab-results-view.tsx` set-state-in-effect at line 32, same on origin/dev).
- E2E on an own dev server (:3357, stopped afterwards) against dev Medplum :8113 and the dev PACS: `xray.spec.ts` + `xray-phase2.spec.ts` + `xray-phase3.spec.ts` 11/11; `workflow.spec.ts` tests 01 to 07 (composer) 7/7.
- One earlier run of the three X-ray specs had a single failure in `xray.spec.ts` "Radiology report ingress"; it passed alone and in the next full run, and the failure output was not captured. Treated as a flake, not explained.
- Not run: `e2e/scripts/check-all.sh` (hardcodes `/workspace/ai-logs`, not writable on this VPS, as in Tasks 351/355), `next build`, the full e2e suite, the admin suite.
- `tests/unit/admin-status-route.test.ts` was changed to keep the real exports in its module mocks: its partial mock of `medplum-auth` broke any later unit file importing other names from it.


## 357b continuation (2026-11-16)
- Resumed `/home/dev/ucc-task357`, fetched origin, confirmed all local code commits already merged in #255. New branch `ai/task-357b-pacs` starts at origin/dev; local setup/research/changelog preserved as a8a43e3. Draft #256 opened early. Explicit task authorization overrides the standing no-remote rule for normal milestone pushes and draft PRs only.
- Re-read official Orthanc Lua, OHIF DICOMweb, FHIR R4 ImagingStudy, DICOM PS3.18 and Next after docs above. Medplum searchResources accepts URLSearchParams and fetch options: https://www.medplum.com/docs/sdk/core.medplumclient.searchresources . React effect cleanup: https://react.dev/reference/react/useEffect . Installed client SDK in this VPS node_modules is 5.1.13 (not claimed as 5.2.8); no SDK API changes made.
- Security finding: optional/multi-clinic Orthanc allowlist allowed any enabled clinic's device to read any archive study and potentially claim it. Require exactly one explicit owning clinic, reject foreign devices before archive access, and enforce the same binding for staff attachment and existing launch/session tokens. Shared-archive ownership is not implemented.
- Required gate previously hardcoded unwritable `/workspace` output. Add an optional `UCC_LOG_ROOT` override retaining existing defaults so this VPS can run the real check-all script under `/home/dev`.
- Bearer launch URLs were also being recorded by default nginx and Next dev access logs. Disable nginx access logging for `/launch` and exclude the UCC launch path from Next incoming-request logs (supported by installed Next 16.2.1 config types). Official option: https://nextjs.org/docs/app/api-reference/config/next-config-js/logging . Apply the same redaction to any future external reverse proxy; no production proxy edited.
- Review persistence finding: a previously unmatched/dismissed study could auto-attach on resync if a matching order was created later. Existing review entries now block automatic matching permanently; staff must explicitly attach. Regression covers both requested and dismissed entries, plus staff attachment with a foreign archive binding.
- First full gate (`/home/dev/ai-logs/task357b/task357b`) passed lint/build but browser global setup got 429 on all three fixed-65s login retries; zero browser tests executed, clinic inventory also hit the same dev Medplum auth cooldown. Original FAIL retained. A diagnostic emitted only HTTP status/Retry-After (429, 48 seconds). Browser setup now honours the existing login route's Retry-After response, avoiding retry storms on the shared dev auth service. Retry after cooldown with the same scoped synthetic tests; no auth/server settings weakened.
