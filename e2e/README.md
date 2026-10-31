# UCC e2e suite (baseline "before" record)

Playwright UI workflow + API CRUD tests for the UCC app (`/workspace/iatrum-ucc`), with every persisted step verified directly in Medplum FHIR. **Fake data only.** The suite never touches the app repo.

## Run
```bash
cd /workspace/iatrum-ucc/e2e   # moved from /workspace/ucc-e2e-suite
npx playwright test          # full run (same as: bun run e2e)
bun run e2e:api              # API CRUD only (~20 s)
bun run e2e:ui               # UI patient workflow only (~8-10 min)
bun run report               # open HTML report (reports in /workspace/ai-logs/e2e-reports)
```
Prereqs: UCC dev server on `:3210` (`next dev --webpack -p 3210`), UCC Medplum on `:8113` (`/workspace/ucc-medplum`, `sudo docker-compose up -d`; seed with `bun seed.mjs` on a fresh DB).
Playwright runs headless, 1 worker. Chromium: `npx playwright install chromium-headless-shell` (or set `PW_CHROME`).

## Config (env vars)
`UCC_BASE_URL` (default http://localhost:3210) · `UCC_USER` (doctor@ucc.local) · `UCC_PASSWORD` (default: read from `.secrets/pw`, git-ignored, chmod 600) · `MEDPLUM_URL` (http://localhost:8113/) · `MEDPLUM_ADMIN_EMAIL/PASSWORD` (local Medplum defaults; read-only FHIR checks) · `UCC_EVIDENCE` (default `/workspace/iatrum-ucc-evidence/e2e`).

## What runs
- `global-setup.ts`: one API login (Medplum rate-limits auth ~5/min/IP), saves session; seeds fake catalog fixtures if missing (Paracetamol, Amoxicillin, FBC, CXR DX, US abdomen, J02.9, MC, referral, wound dressing).
- `tests/api.spec.ts`: auth guard, patient CRUD + duplicate NRIC + archive, inventory CRUD + validation, catalogs CRUD (lab/imaging/document/diagnosis), procedures, insurers (suppliers logged; feature-flagged off), anonymous `/api/labs/receive`, read-endpoint smoke.
- `tests/workflow.spec.ts` (serial, one browser page): login → register → check-in + vitals → queue → start consult → notes + diagnosis → Sign → composer (real autosave path, then plan API stubbed as "persistence unavailable" because Firestore is not configured) with med, consultation fee, lab, imaging, procedure, MC, referral → Sign → lab result ingest → **Labs & Imaging tab shows result** → Documents tab → checkout, payment, complete visitation → Invoice in FHIR → page smoke (reports, settings, POCT, PACS, admin) → known-bug summary.
- `tests/admin.spec.ts` (opt-in: `UCC_ADMIN_E2E=1 npx playwright test tests/admin.spec.ts --workers=1`): one login as the local Medplum admin, loads every admin page and runs org/clinic CRUD, module toggles, invite + edit + delete a fake user; screenshots in /workspace/ai-logs/admin-e2e/shots.

Known bugs are collected as `BUG` annotations and asserted together in test `11 known-bug probes summary`, which is **expected to fail on the baseline**. When a fix lands, that test's list shrinks; when all are fixed it passes.

## Outputs
- Screenshots + `workflow-results.json` (facts, bugs, console/HTTP issues) + `api-results.json` → `$UCC_EVIDENCE`
- `reports/results.json`, `reports/html/`, traces of failures in `reports/artifacts/`

## Gate script (AI rounds)
`e2e/scripts/check-all.sh <label>` runs lint+types, `build:ci`, the full suite (1 worker), compares with `/workspace/ai-logs/baseline/results.json`, and runs `scripts/clinic-check.ts`. Logs: `/workspace/ai-logs/<label>/`.
