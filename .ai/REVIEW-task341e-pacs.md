# Task 341e review: X-ray phase 3 (Orthanc + OHIF), branch ai/task-357-pacs

Status: **PR #255 is already MERGED** (not a draft); reviewed branch head d0dc2c1 post-merge. Read-only review, no code changes.

## Verified PASS
- Compose (`infra/pacs-dev/docker-compose.yml`): all host ports bound to 127.0.0.1 (8042, 4242, 3320), webhook relay only on the private bridge gateway 172.31.57.1; images pinned (orthanc 26.11.0, ohif v3.13.14); mem_limit + memswap_limit set (384m/128m); Orthanc auth enabled, ALWAYS_ALLOW_STORE/ECHO false, called-AET check on; no medplum-*/traefik names.
- Webhook: Lua posts only `{orthancStudyId}` with `Authorization: Bearer <device key>` read from a git-ignored mount; UCC `authenticateDeviceKey(..., 'pacs')` runs before any other work and also enforces the module toggle; UCC re-reads the study from Orthanc itself.
- Matching: AccessionNumber matched via clinic + accession identifier search and re-checked on results; one archive per clinic (`pacsServesClinic`) fails closed; ambiguous/none/closed go to a clinic review Task and never auto-attach, including on later resync.
- Viewer token: HMAC, separate derived keys per kind, bound to one clinic + one StudyInstanceUID, launch 60 s single-use, session 15 min HttpOnly/SameSite=Strict cookie scoped to /dicom-web; DICOMweb proxy is read-only, study-scoped, QIDO forced to the token study, Orthanc credentials server-side only. Link minting requires a real session, clinic-scoped study lookup and the pacs module.
- Secrets: `infra/pacs-dev/.env.local`, `secrets/`, `viewer-secret` are git-ignored and none are tracked; no secret-like literals in the branch diff. Fake DICOM only (gen-synthetic scripts).
- Gates: `tsc --noEmit` clean; `bun test tests/unit` 226 pass / 0 fail.

## Observations (no fix pushed)
1. Turning the pacs toggle off blocks new links and ingress, but an already-issued viewer session stays valid up to 15 min (the DICOMweb proxy does not re-check the module). Acceptable; documented as a limit in the plan.
2. Launch-token single-use is per process (documented); use one UCC instance or shared replay tracking in production.
3. The branch's own review says the **full e2e gate (check-all) was not completed** (group 1 19/21 from dev FHIR quota and a backup-path issue, DICOM group interrupted). I did not rerun e2e (RAM shared with production, one dev slot). Done criteria for 357 are therefore not fully met: HOLD on "no new failures" until a clean check-all run.

## Verdict
Code and security design verified; **HOLD only on the outstanding full e2e gate**. Nothing merged, nothing deployed.
