# BACKLOG

## Tonight (round 1), in order
1. [x] AGENTS.md, CLAUDE.md, .ai/, e2e suite in repo (`e2e/`, no secrets)
2. [x] Realistic dummy-data seed for 4 clinics (fake patients, encounters, orders, results)
3. [x] Composer bug: items roll back when `/api/consultations/plan` fails ("Unable to detect a Project Id") but UI still says "autosaved"
4. [x] Lock `/api/labs/receive` when `POCT_API_KEY` unset; fix 500 on lab result with no status

3b. [x] Composer hydration race (item lost if added before draft loaded)

## Later
- POCT phase 2 prerequisite: per-clinic device keys (FHIR Device per analyser) + check the ServiceRequest clinic matches the device's clinic before writing results (shared key today can write into any clinic)
- Access policy ProjectMembership leak (work in `/workspace/iatrum-ucc-ap`)
- `/admin` redirect loop; rate limit shown as "wrong password"; stock 500
- Network lockdown plan; staging plan
- UX audit
- POCT labs phases 1-3
- POCT X-ray
- Dispensing; MC/referral docs
- Task 6b follow-ups: anchor rate-limit match on code prefix; AUTH_UNAVAILABLE for token-exchange network errors
- Task 5 decision needed: local Medplum project is superAdmin=true; Medplum injects ProjectMembership/User/Project grants for every member, so any AccessPolicy cannot hide staff directory. Fix = staff in a non-superAdmin project (topology change, user decision). Policy+script committed, rolled back locally.
- Clinic clinical isolation (from Task 5): AccessPolicy clinical grants have no clinic criteria, so a staff user can read other clinics' Patient/Encounter/etc via direct FHIR. Plan: per-clinic tenant (HealthcareService/Organization) + meta.accounts backfill + parameterized policy (_compartment criteria), multi-clinic staff, admin-client paths. Needs plan + Codex/Claude security review.
- **New (Task 090 Phase 0, 2026-11-10): write-side cross-clinic containment gap, needs its own task before Phase 2 migration.** Disposable-identity test proved a policied clinic-A staff member can `POST Observation {subject: Patient/<clinic-B-patient>}` and get `201`, not the expected `403` — Medplum's per-resource `criteria` does not gate `create`/write the way it gates read/search in this version, and `createLabOrder`/`createImagingOrder` (`lib/fhir/lab-service.ts`, `imaging-service.ts`) never validate `patientId` against the caller's own `clinicId` before creating. Not an exfiltration vector (the written resource inherits the foreign patient's own account, so the writer can't read it back), but a real OWASP A01 data-integrity gap, already live today for the 4/10 memberships that already carry the real policy. Fix: add an `assertMatchesClinic(patient, clinicId)`-style check immediately after resolving `patientId` in every order-creation service function, before `createResource`. Full evidence: `.ai/research/clinic-isolation.md` "Phase 0 results", decision D36.

## USER PRIORITY CHANGE (1 Nov 10:18 MYT)
User: do POCT lab (Tasks 9-11) and POCT X-ray (Task 12) NEXT, before clinic isolation and U3a/U3b/U3c usability. Finish the current task (Task 8) cleanly, then start Task 9.

## Process gap found while rebasing Task 9's PR onto `dev` (2 Nov)
Task 4 (`/api/labs/receive` and `/api/imaging/receive` x-api-key auth, missing-status 500 fix) and Task 6c (inventory `strengths` validation guard) are committed on `ai-work` and documented as done in CHANGELOG/DECISIONS, but neither ever got its own PR into `dev` (checked `gh pr list` — no match). `dev` still has the old insecure/crashing versions of both. This is why dev-based gates for later tasks (U2c note, and now Task 9) hit unrelated failures around tests 07 ("lab result ingest", 401 invalid API key) and the inventory validation API test (500 instead of 4xx) — confirmed by diffing `origin/dev` vs `ai-work` for `lib/fhir/inventory-service.ts` and `app/(routes)/api/labs/receive/route.ts`. Action: open two small standalone PRs (`ai/task-4`, `ai/task-6c`) from `ai-work`'s existing commits into `dev` before relying on a dev-based gate again.
