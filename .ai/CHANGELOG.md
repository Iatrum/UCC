# CHANGELOG (plain language)

## 2026-10-31 Task 1 – AI team setup
- Added `AGENTS.md` (one short rule list for all AIs); `CLAUDE.md` now imports it.
- Added `.ai/` notes folder (state, backlog, decisions, reviews, research).
- The test suite now lives in the repo under `e2e/` (no passwords in git). One command runs every check: `e2e/scripts/check-all.sh <name>`.
- Fixed a test-setup problem: test reports were written inside the app folder, which made the dev server reload pages in the middle of a test. Reports now go to `/workspace/ai-logs/e2e-reports`.

## 2026-10-31 Task 2 – Fake data for 4 clinics (local only)
- New script `e2e/scripts/seed-clinics.ts` fills the local test Medplum with obviously fake data for 4 clinics (Demo, Klinik Bravo, Charlie, Delta): 6 patients each, with visits, diagnoses, blood count lab orders and results.
- Safe to run again (it does not make duplicates). It refuses to run against anything except localhost.

## 2026-10-31 Task 6a – No more /admin redirect loop for clinic staff
- **What changed:** A signed-in clinic user (not a platform admin) who opens /admin used to bounce between /admin and the login page until the page crashed. Now they land once on the login page with "This account is not a platform admin" and two buttons: "Go to my clinic dashboard" and "Sign in as a different user". The admin area stays admin-only (server check unchanged). The `next=` link after login is now checked strictly so it can't send people to another website.
- **Why:** The login page followed `next=/admin` even when the server had just said `admin_required`. OWASP Unvalidated Redirects cheat sheet for the `next` check.
- **Please test:** sign in as a doctor, open /admin -> one notice, no flicker; button goes to the dashboard. Sign in as admin -> /admin works as before.
