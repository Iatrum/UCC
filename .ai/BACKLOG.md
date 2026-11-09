# BACKLOG

## Tonight (round 1), in order
1. [x] AGENTS.md, CLAUDE.md, .ai/, e2e suite in repo (`e2e/`, no secrets)
2. [x] Realistic dummy-data seed for 4 clinics (fake patients, encounters, orders, results)
3. [ ] Composer bug: items roll back when `/api/consultations/plan` fails ("Unable to detect a Project Id") but UI still says "autosaved"
4. [ ] Lock `/api/labs/receive` when `POCT_API_KEY` unset; fix 500 on lab result with no status

## Later
- Access policy ProjectMembership leak (work in `/workspace/iatrum-ucc-ap`)
- `/admin` redirect loop; rate limit shown as "wrong password"; stock 500
- Network lockdown plan; staging plan
- UX audit
- POCT labs phases 1-3
- POCT X-ray
- Dispensing; MC/referral docs
- Task 6b follow-ups: anchor rate-limit match on code prefix; AUTH_UNAVAILABLE for token-exchange network errors
- Task 5 decision needed: local Medplum project is superAdmin=true; Medplum injects ProjectMembership/User/Project grants for every member, so any AccessPolicy cannot hide staff directory. Fix = staff in a non-superAdmin project (topology change, user decision). Policy+script committed, rolled back locally.

- **New (Task 090 Phase 0, 2026-11-10): write-side cross-clinic containment gap, needs its own task before Phase 2 migration.** Disposable-identity test proved a policied clinic-A staff member can `POST Observation {subject: Patient/<clinic-B-patient>}` and get `201`, not the expected `403` — Medplum's per-resource `criteria` does not gate `create`/write the way it gates read/search in this version, and `createLabOrder`/`createImagingOrder` (`lib/fhir/lab-service.ts`, `imaging-service.ts`) never validate `patientId` against the caller's own `clinicId` before creating. Not an exfiltration vector (the written resource inherits the foreign patient's own account, so the writer can't read it back), but a real OWASP A01 data-integrity gap, already live today for the 4/10 memberships that already carry the real policy. Fix: add an `assertMatchesClinic(patient, clinicId)`-style check immediately after resolving `patientId` in every order-creation service function, before `createResource`. Full evidence: `.ai/research/clinic-isolation.md` "Phase 0 results", decision D36.
