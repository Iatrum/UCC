# CHANGELOG (plain language)

## 2026-10-31 Task 1 – AI team setup
- Added `AGENTS.md` (one short rule list for all AIs); `CLAUDE.md` now imports it.
- Added `.ai/` notes folder (state, backlog, decisions, reviews, research).
- The test suite now lives in the repo under `e2e/` (no passwords in git). One command runs every check: `e2e/scripts/check-all.sh <name>`.
- Fixed a test-setup problem: test reports were written inside the app folder, which made the dev server reload pages in the middle of a test. Reports now go to `/workspace/ai-logs/e2e-reports`.
