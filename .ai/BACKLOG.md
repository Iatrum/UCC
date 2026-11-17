# BACKLOG

## Tonight (round 1), in order
1. [x] AGENTS.md, CLAUDE.md, .ai/, e2e suite in repo (`e2e/`, no secrets)
2. [x] Realistic dummy-data seed for 4 clinics (fake patients, encounters, orders, results)
3. [x] (Task 354, 2026-11-16: plan route is Medplum-backed since U1b so no Project Id source remains; composer no longer guesses "unavailable" from error text and keeps the item on a failed save; was) Composer bug: items roll back when `/api/consultations/plan` fails ("Unable to detect a Project Id") but UI still says "autosaved"
4. [x] (Task 180, device keys: `/api/labs/receive` + imaging receive routes now fail closed without a valid per-device key; shared env keys removed) Lock `/api/labs/receive` when `POCT_API_KEY` unset; fix 500 on lab result with no status
5. [x] (Task 355, 2026-11-16: now per-device-key auth, Device-derived clinic, 403 cross-clinic, pacs-toggle gated; was) `/api/imaging/report` (radiologist report) still fails open when `PACS_API_KEY` is unset and does no clinic check; it is not device ingress so Task 180 left it. Needs session or per-clinic auth.

- Existing queue pagination limit (found during Task 5 validation): `getTriageQueueForToday` reads only the first 200 date-ascending Encounters, including finished visits. A new checked-in patient can be omitted once today's matches exceed 200. Direct staff reads still succeed. Needs a separate pagination/cap fix; Task 5 leaves application behavior unchanged and backs up/removes only its own accumulated synthetic fixtures before validation. Evidence: `.ai/research/task5-topology.md`.

## Later
- Access policy ProjectMembership leak (work in `/workspace/iatrum-ucc-ap`)
- `/admin` redirect loop; rate limit shown as "wrong password"; stock 500
- [x] (Task 385, plan only: `.ai/PLAN-network-lockdown-staging.md`; user runs the runbook, build tasks 385a-e not started) Network lockdown plan; staging plan
- UX audit
- POCT labs phases 1-3
- POCT X-ray
- Dispensing; MC/referral docs
- Task 6b follow-ups: anchor rate-limit match on code prefix; AUTH_UNAVAILABLE for token-exchange network errors
- Task 5 topology approved 16 Nov: dev clinical project is non-superAdmin with clinic AccessPolicy isolation and a separate dedicated operator. Migration/rollback, live isolation and admin API checks verified; final full gate/publication pending. Production remains a manual Hidayat migration; see `.ai/RUNBOOK-task5-production-migration.md` and `.ai/REVIEW-task5.md` (D46).

- **New (Task 090 Phase 0, 2026-11-10): write-side cross-clinic containment gap, needs its own task before Phase 2 migration.** Disposable-identity test proved a policied clinic-A staff member can `POST Observation {subject: Patient/<clinic-B-patient>}` and get `201`, not the expected `403` — Medplum's per-resource `criteria` does not gate `create`/write the way it gates read/search in this version, and `createLabOrder`/`createImagingOrder` (`lib/fhir/lab-service.ts`, `imaging-service.ts`) never validate `patientId` against the caller's own `clinicId` before creating. Not an exfiltration vector (the written resource inherits the foreign patient's own account, so the writer can't read it back), but a real OWASP A01 data-integrity gap, already live today for the 4/10 memberships that already carry the real policy. Fix: add an `assertMatchesClinic(patient, clinicId)`-style check immediately after resolving `patientId` in every order-creation service function, before `createResource`. Full evidence: `.ai/research/clinic-isolation.md` "Phase 0 results", decision D36.

- **Resolved (Task 330, 2026-11-15): `meta.accounts` extended-header gap.** The per-request header was already supported without SDK changes: `readResource(type, id, { cache: 'no-cache', headers: { 'X-Medplum': 'extended' } })` is used by `receiveImagingStudy`, `createImagingReport`, `receiveLabResults` and `createProvenance` (commit 8792c52), so `accountRefs` is populated and `$set-accounts` fires. This note was stale. Regression coverage: `tests/unit/extended-accounts.test.ts` (fake server hides `meta.accounts` without the header; verified failing when the header is removed). Remaining caveat: any NEW read-then-reuse of `meta.accounts` must pass the header explicitly; `getAdminMedplum()` itself still sets none. **Receive-path containment (Task 180):** the clinic comes from the authenticated Device; `assertOrderInDeviceClinic` checks the order identifier and `meta.accounts` against that clinic, and `e2e/tests/clinic-isolation.spec.ts` covers account propagation through both receive paths.

