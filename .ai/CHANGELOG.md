# CHANGELOG (plain language)

## 2026-10-31 Task 1 – AI team setup
- Added `AGENTS.md` (one short rule list for all AIs); `CLAUDE.md` now imports it.
- Added `.ai/` notes folder (state, backlog, decisions, reviews, research).
- The test suite now lives in the repo under `e2e/` (no passwords in git). One command runs every check: `e2e/scripts/check-all.sh <name>`.
- Fixed a test-setup problem: test reports were written inside the app folder, which made the dev server reload pages in the middle of a test. Reports now go to `/workspace/ai-logs/e2e-reports`.

## 2026-10-31 Task 2 – Fake data for 4 clinics (local only)
- New script `e2e/scripts/seed-clinics.ts` fills the local test Medplum with obviously fake data for 4 clinics (Demo, Klinik Bravo, Charlie, Delta): 6 patients each, with visits, diagnoses, blood count lab orders and results.
- Safe to run again (it does not make duplicates). It refuses to run against anything except localhost.

## 2026-10-31 Task 3b – Composer no longer loses the first item
- **What changed:** If you added a medicine or service very quickly after opening Treatment, it could vanish a second later. The screen was still loading the saved draft and, when that finished, it wiped what you had just added. Now it keeps your items and adds any saved ones that are missing. Items you deleted stay deleted.
- **Why:** Found by recording the network calls in a test run: the draft load answered after the first add. React docs warn that late fetch answers must not overwrite newer state (react.dev/learn/you-might-not-need-an-effect#fetching-data).
- **Tests:** lint, types, build, full e2e (20/23, same as before), 4-clinic check. The "composer loses item without Firebase" known bug is now fixed.
- **Please test:** open a patient > Sign consult > Treatment, immediately add Paracetamol, wait 5 s: it should stay ("1 × RM 0.50"). Delete it and wait: it should stay deleted.

## 2026-10-31 Task 4 – Lab and X-ray result receivers are now locked
- **What changed:** The two endpoints that analysers and PACS use to send results (`/api/labs/receive`, `/api/imaging/receive`) used to accept anything from anyone if the server had no key set. Now they refuse (401) unless the device sends the right key in the `x-api-key` header. Keys are compared in a timing-safe way. Error replies no longer show internal error text. A lab result with no status used to crash (500); it is now saved as "final", and a wrong status gets a clear 400.
- **Why:** OWASP API Security 2023 (broken authentication: fail closed); FHIR R4 Observation.status is required (hl7.org/fhir/R4/observation.html).
- **Tests:** lint, types, build, full e2e now 21/23 (the "labs/receive requires a key" security test passes for the first time), 4-clinic check.
- **Before deploying:** set `POCT_API_KEY` and `PACS_API_KEY` on staging/production and give the same key to the analyser/PACS, or results will be refused.
- **Please test:** in the Labs & Imaging tab of a test patient, results sent by the e2e run still appear.

## 2026-10-31 Task 6c – Adding stock without strengths no longer crashes
- **What changed:** Adding an inventory item through the API without a "strengths" list gave a server error (500). Now a missing list is treated as empty, and bad stock / minimum stock / price values get a clear 400 message instead of a crash. Empty fields are no longer saved as blank FHIR extensions, and editing an item keeps any other extensions it already had.
- **Why:** FHIR R4 ext-1 (hl7.org/fhir/R4/extensibility.html#Extension) says every extension needs a value; OWASP API guidance says bad input should get 4xx, not 500.
