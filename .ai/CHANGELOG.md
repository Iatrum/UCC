# CHANGELOG (plain language)

## 2026-11-01 Task 8 — fake-data staging plan
- Planned an isolated Medplum instance/non-superAdmin clinical project and separate Firebase project, Firestore and Storage. Nothing provisioned, deployed or purchased.
- Required a staging adapter that attests targets before writes; preserved current localhost safety guards. Added strict baseline validation, clinical DELETE denial and durable-save/upload acceptance.
- Validation on ai-work: task8-1101 OVERALL PASS; lint 0, build 0, e2e 22/23 (only known baseline summary fails), clinics 0. This is regression evidence, not staging readiness.
- Review: single-model review (Codex builder + fresh Codex reviewer), APPROVE after one fix loop; no remaining MAJOR/MINOR. Docs only; screenshots not applicable.
## 2026-11-01 Task 7 — Medplum network lockdown plan
- Added an inventory-first plan for private backend ports, controlled browser HTTPS access, private operator tools, device ingress, route aliases and batch-operation risks.
- All rollout/rollback work is marked USER ACTIONS. No network, production, credentials or application code changed. Receiver fail-closed authentication and clinical isolation remain deployment prerequisites.
- Validation: ai-work gate `task7-1101` PASS: lint 0, build 0, e2e 22/23 (only baseline known-bug summary), clinics 0. This validates app regression safety, not the unexecuted network plan.
- Review: single-model review (Codex builder + fresh Codex reviewer), APPROVE after one correction loop, no remaining MAJOR/MINOR. UI screenshots not applicable (docs only).


## 2026-10-31 Task 1 – AI team setup
- Added `AGENTS.md` (one short rule list for all AIs); `CLAUDE.md` now imports it.
- Added `.ai/` notes folder (state, backlog, decisions, reviews, research).
- The test suite now lives in the repo under `e2e/` (no passwords in git). One command runs every check: `e2e/scripts/check-all.sh <name>`.
- Fixed a test-setup problem: test reports were written inside the app folder, which made the dev server reload pages in the middle of a test. Reports now go to `/workspace/ai-logs/e2e-reports`.

## 2026-10-31 Task 2 – Fake data for 4 clinics (local only)
- New script `e2e/scripts/seed-clinics.ts` fills the local test Medplum with obviously fake data for 4 clinics (Demo, Klinik Bravo, Charlie, Delta): 6 patients each, with visits, diagnoses, blood count lab orders and results.
- Safe to run again (it does not make duplicates). It refuses to run against anything except localhost.

## 2026-10-31 Task 6b – "Too many attempts" no longer shown as "wrong password"
- **What changed:** When Medplum blocks sign-in for a minute (5 tries per IP per minute), the login page now says "Too many sign-in attempts. Please wait about N seconds and try again." instead of "Incorrect email or password". If Medplum is down or answers 5xx it says the sign-in server is busy/unavailable. A real wrong password still shows the same generic message (no hint whether the email exists). The API now returns 429 + `Retry-After` for this case.
- **Why:** Medplum rate limits /auth/login and answers 429 with a `RateLimit: …;t=<secs>` header (medplum.com/docs/rate-limits, checked locally); RFC 6585/9110 for 429 + Retry-After.
- **Please test:** on the login page type a wrong password 6 times quickly -> the 6th shows "Too many sign-in attempts…". Wait a minute -> normal sign-in works.
## 2026-10-31 Task 6a – No more /admin redirect loop for clinic staff
- **What changed:** A signed-in clinic user (not a platform admin) who opens /admin used to bounce between /admin and the login page until the page crashed. Now they land once on the login page with "This account is not a platform admin" and two buttons: "Go to my clinic dashboard" and "Sign in as a different user". The admin area stays admin-only (server check unchanged). The `next=` link after login is now checked strictly so it can't send people to another website.
- **Why:** The login page followed `next=/admin` even when the server had just said `admin_required`. OWASP Unvalidated Redirects cheat sheet for the `next` check.
- **Please test:** sign in as a doctor, open /admin -> one notice, no flicker; button goes to the dashboard. Sign in as admin -> /admin works as before.
