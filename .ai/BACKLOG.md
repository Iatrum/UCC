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

- **New (Task 090 Phase 1.4, 2026-11-10): `meta.accounts`/`meta.account` are invisible to every non-extended Medplum read, and the app never requests extended mode.** Confirmed from the live `medplum/medplum-server:latest` container's bundled source: the server only includes `meta.accounts`/`meta.account`/`meta.compartment` in a response when the request carries `X-Medplum: extended`; `lib/server/medplum-admin.ts`'s `getAdminMedplum()` (and every other `MedplumClient` instance in this codebase) never sets that header, and the installed `@medplum/core` SDK version (`^5.1.13`) has no built-in option for it. Practical effect: `getResourceAccountReferences()` (`lib/fhir/clinic-tenancy.ts`), called on a resource that was just `readResource`'d (not one still in-memory from its own `createResource` call), always sees an empty `meta.accounts` — so the `accountRefs` it returns is always `[]` today, making `assignResourceToAccountReferences(..., accountRefs)` a silent no-op at `imaging-service.ts`'s `receiveImagingStudy`/`createImagingReport` and `lab-service.ts`'s Observation/DiagnosticReport account-propagation calls (and, by extension, this task's own Phase 1.2 Provenance-account-stamping wherever it reused the same `accountRefs` variable at those sites). Not fixed in this task — the backfill script (`scripts/access-policy/backfill-clinic-accounts.mjs`) works around it locally with its own raw-fetch `X-Medplum: extended` header, but the app's own service-layer code does not. Needs its own follow-up: either find how to set a custom header per-request on this SDK version, or stop relying on read-then-reuse and have `receiveImagingStudy`/`receiveLabResults` resolve the clinic independently (e.g. from the Device/API-key identity once per-clinic device keys land, BACKLOG line above).
