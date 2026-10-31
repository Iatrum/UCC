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
