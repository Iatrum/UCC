# Task 357 phase 3 continuation self-review

Scope: `/home/dev/ucc-task357`, continuation of merged #255. No production actions, deployment, navigation, Firebase Storage, or consultation composer edits. No delegates used.

## Findings corrected

1. **MAJOR: archive ownership was optional.** A valid key from another enabled clinic could read an arbitrary Orthanc study and associate it with its own order. Require exactly one explicit archive clinic (`PACS_ORTHANC_CLINICS`); reject foreign device ingress before any Orthanc fetch. Also enforce this binding on manual attachment, viewer launch and DICOMweb sessions. An unbound/shared archive fails closed. Shared-archive per-study ownership is outside scope.
2. **MAJOR: unmatched studies could attach on a later resync.** If a matching order appeared after initial review creation, the next notification automatically attached the images. Existing review entries now require an explicit staff decision forever, including dismissed entries. Existing attached studies still refresh normally.
3. **Credential logging.** Default viewer nginx and Next dev logs included the one-use bearer launch query. Suppress logging for that path; document the same requirement for future reverse proxies.
4. **Test isolation.** Restore the pre-test device key rather than clearing it. The required gate accepts `UCC_LOG_ROOT` so the VPS does not need an unwritable `/workspace` directory. Defaults remain unchanged.

5. **Existing study readiness.** A tagged device-reported study with the same UID now gets the server-only stored marker when its pixels are confirmed in Orthanc, preserving its id and associations while enabling the scoped viewer.

## Verification

Unit suite: 226 pass, zero failures. Regression tests prove foreign keys cause zero archive reads, existing viewer tokens fail after a clinic-binding change, foreign archive attachment fails before fetching pixels, and pending/dismissed unmatched studies never attach automatically on a later matching order.

Lint and production build PASS. Synthetic DICOM -> Orthanc Lua -> UCC ImagingStudy -> scoped launch/session -> OHIF frame retrieval PASS (47.9 s), including anonymous denial, foreign-clinic 403, another-study refusal, replay denial and review-list behavior. New screenshots were visually inspected: OHIF renders the synthetic image and thumbnails. POCT 8/8, phase-2 viewer guards 2/2, and the retention/Lab-state/save-state group 16/16 PASS.

**HOLD for the required full gate.** No complete no-new-failures gate is claimed. Retained failures/interruption details are in the research log: dev auth/FHIR throttling, unwritable legacy fixture paths, one shell-file edit during execution, and proactive RAM shutdowns. The latest completed group 1 is 19/21 (isolation FHIR quota, staff backup path); the DICOM group has 12 passes and an interrupted remaining X-ray run, not an application failure verdict. Test-only quota retry/backup-path corrections and finer groups are committed, but have not completed a subsequent full live gate. Another Task 352 run owns the sole dev slot again; no owned server or background gate remains running.

Next: obtain an exclusive dev slot, freeze gate sources, run `UCC_LOW_MEMORY_GATE=1` check-all with writable logs/evidence, verify all 68 tests are represented without interruption, and record the baseline comparison. Production remains outside scope.

## Deployment limits

Dev PACS only. One archive per clinic, TLS/private modality networking, durable notification recovery, storage/index backup and sufficient disk must be resolved before production rollout. Single-use launch tracking is per app process; use one UCC instance or shared replay tracking. Viewer sessions expire after 15 minutes; turning off PACS blocks new links. See `.ai/PLAN-xray-phase3.md` for sizing, S3 later, setup and rollback.
