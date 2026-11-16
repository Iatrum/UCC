# Task 300: POCT X-ray phase 1

Found already on dev/#236: composer X-ray section (online-device gate), `pacs` module toggle (default off), `/api/imaging/order` xray branch, per-device-key ingest, pending card in Lab tab.
Gap: `pacsUrl` was never read from or written to FHIR, `/api/imaging/results` ignored the toggle and clinic, `window.open` lacked noopener.
Change: `lib/fhir/pacs-link.ts` (sanitise/read/gate), ImagingStudy tagged `xray` + viewer-url extension on receive, results API gated by `pacs` for the caller's clinic.
Not done (phase 2): DICOM/WADO viewer embedding, per-clinic PACS host allowlist, report entry.
Docs: FHIR ImagingStudy https://hl7.org/fhir/R4/imagingstudy.html (extension element, meta.tag).
Validation: bun unit tests (38 pass), tsc clean, e2e xray.spec 6/6 on own dev server :3311. workflow.spec step 03 (dashboard queue after check-in) failed and not investigated; steps 04-11 skipped as a result.
