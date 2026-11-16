# Task 357 phase 3 continuation review

Scope: `/home/dev/ucc-task357`, continuation of merged #255. No production actions, deployment, navigation, Firebase Storage, or consultation composer edits. No delegates used.

## Findings corrected

1. **MAJOR: archive ownership was optional.** A valid key from another enabled clinic could read an arbitrary Orthanc study and associate it with its own order. Require exactly one explicit archive clinic (`PACS_ORTHANC_CLINICS`); reject foreign device ingress before any Orthanc fetch. Also enforce this binding on manual attachment, viewer launch and DICOMweb sessions. An unbound/shared archive fails closed. Shared-archive per-study ownership is outside scope.
2. **MAJOR: unmatched studies could attach on a later resync.** If a matching order appeared after initial review creation, the next notification automatically attached the images. Existing review entries now require an explicit staff decision forever, including dismissed entries. Existing attached studies still refresh normally.
3. **Credential logging.** Default viewer nginx and Next dev logs included the one-use bearer launch query. Suppress logging for that path; document the same requirement for future reverse proxies.
4. **Test isolation.** Restore the pre-test device key rather than clearing it. The required gate accepts `UCC_LOG_ROOT` so the VPS does not need an unwritable `/workspace` directory. Defaults remain unchanged.

## Verification

Unit suite: 225 pass, zero failures. Regression tests prove foreign keys cause zero archive reads, existing viewer tokens fail after a clinic-binding change, foreign archive attachment fails before fetching pixels, and pending/dismissed unmatched studies never attach automatically on a later matching order.

Full gate, browser evidence, final lint and cleanup: in progress; final results will be recorded before completion. Earlier phase-3 evidence is retained separately in the research notes and is not represented as a new run.

## Deployment limits

Dev PACS only. One archive per clinic, TLS/private modality networking, durable notification recovery, storage/index backup and sufficient disk must be resolved before production rollout. Single-use launch tracking is per app process; use one UCC instance or shared replay tracking. Viewer sessions expire after 15 minutes; turning off PACS blocks new links. See `.ai/PLAN-xray-phase3.md` for sizing, S3 later, setup and rollback.
