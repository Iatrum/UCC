# REVIEW — Task 301: independent review of Task 300 X-ray phase 1 (draft PR #240)

Reviewer: non-author. Scope: commit 6e4cbef on top of #236 (device keys). Fake data only.

## Checks
- **Toggle default-off**: `pacs` is an opt-in module (not in default enabled list in `lib/module-settings.ts`); `gateXrayStudies` hides X-ray studies/links when off. e2e verifies on and off. PASS.
- **Sidebar/nav**: no changes in diff. PASS.
- **Patient data / secrets**: only fake fixtures; `https://pacs.example.test`. PASS.
- **Composer**: no composer files touched; xray.spec composer tests 1-3, 5 pass. PASS.
- **Lab-tab-only results**: link rendered only in `ImagingResultsView`. PASS.
- **Viewer URL**: sanitised http(s), no credentials, <=2048; `noopener,noreferrer` added. PASS (phase 2: per-clinic host allowlist, noted by author).
- **Clinic scoping**: ingest stamps clinic from authenticated Device (PASS). **MAJOR (fixed here)**: `/api/imaging/results` took `clinicId` from `requireClinicAuth` but never verified the requested `patientId`/`encounterId` belongs to that clinic, so with the admin client (local-auth) or a broad policy any clinic could read another clinic's imaging studies, incl. X-ray viewer links, by id. The sibling `/api/labs/results` already did this check. Also error path returned `error.message` in a 500.
- Fix: same `searchOne(... identifier: clinic|<id>)` guard -> 403 via `handleRouteError`; new e2e test "Imaging results API is clinic-scoped".

## Validation
tsc clean; bun unit 38/38; `e2e/tests/xray.spec.ts` 7/7 on own server :3412 (worktree /home/dev/ucc-wt-301). Full check-all not run (shared VPS memory); author noted workflow.spec step 03 failing un-investigated — not related to this diff.

## Verdict
APPROVE after fix (loop 1 of 2). Residual: Task-300 note that `workflow.spec` step 03 fails should be triaged separately.
