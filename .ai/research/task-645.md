# Task 645 - API route security audit (pilot)

Base: origin/dev @ 805106a. Scope: all 61 `route.ts` under `app/api`. Method: static read of every handler plus the
service call it reaches. No live traffic; fake data only in the tests. Not audited: Medplum AccessPolicy contents
(covered by `tests/unit/clinic-staff-policy-drift.test.ts`) and login brute-force/rate limiting.

References: FHIR R4 search escaping and OR semantics (`,` = OR, `|` = system/code) - https://hl7.org/fhir/R4/search.html#escaping ;
Medplum search - https://www.medplum.com/docs/search/basic-search ; status rule from `.ai/research/task422.md`
(id-addressed foreign/missing = 404, payload reference foreign/missing = 403).

## Shared facts
- `requireClinicAuth` (`lib/server/medplum-auth.ts`): token from Bearer/cookie -> clinic id from Host subdomain, else the `medplum-clinic` cookie -> `assertClinicAssignment` (platform admin bypasses). Staff calls then run as the user, so the clinic AccessPolicy filters in Medplum. **Routes that use `getAdminMedplum()` bypass the policy, so their app-level clinic checks are the only barrier.**
- Missing clinic context stays 400 `NO_CLINIC_CONTEXT` (existing client contract); a *malformed* clinic id is now 403.
- `NEXT_PUBLIC_DISABLE_AUTH=true` bypass only works when `NODE_ENV !== 'production'` (`isLocalAuthDisabled`). Fail-closed in prod; would fail open if a deployment ran with NODE_ENV unset/dev AND the flag set. Deployment note, not changed.

## Gaps found

| # | Gap | Class | Severity | Status |
|---|-----|-------|----------|--------|
| G1 | `POST/GET /api/fhir/register-extensions` had **no auth**; any caller triggered service-account writes and got `error.message` back | (a) | High | FIXED: `requirePlatformAdmin`, generic errors |
| G2 | The clinic id from the client-writable `medplum-clinic` cookie went **unvalidated** into `identifier=clinic\|<id>` searches and `assertClinicAssignment`. A value like `mine,clinic\|other` is an OR query, so it passes the assignment check (own org matches) and widens every clinic-filtered search - decisive for platform admins and all `getAdminMedplum()` routes | (b)+(c) | High | FIXED: `isValidClinicId` in `requireClinicAuth`, `requireClinicPageAuth`, and when `/api/auth/medplum-session` stores the cookie (400) |
| G3 | `POST /api/audit-log`: any signed-in user (any clinic, any profile type) wrote AuditEvents via the admin client with a **spoofable `userId`**, unbounded fields, no clinic | (a) | Medium | FIXED: clinic auth, actor from the session profile, clinic stamped, fields clamped. No in-repo caller sends `userId` |
| G4 | Foreign id on update/delete paths threw plain `Error` -> **500** with `Access denied ... clinic '<id>'` (patient, consultation/encounter, invoice, triage encounter, procedure, catalog item) | (b) | Low-Med (no data written, but wrong status and message echoed clinic id) | FIXED: `NotFoundError` (404) for id-addressed; `ForbiddenError` (403) for a payload `scheduleId` |
| G5 | `GET /api/billing` (`id`,`patientId`,`consultationId`) and `GET /api/inventory` (`id`,`dispensesFor`) put raw query ids into search strings (`,`/`\|` change meaning). Post-filters and G2 limited impact | (c) | Low | FIXED: `isSafeFhirId`, malformed id -> 404 |
| G6 | `export-to-medplum` compared the bearer secret with `!==` (fail-closed when unset, fine) | (a) | Low | FIXED: constant-time compare |
| G7 | `PUT /api/organization` lets **any clinic staff** edit the shared parent Organisation (name/logo/phone used on every clinic's letterheads) through the admin client | (a)/(b) | Medium | **OPEN - product decision.** The Settings page uses it; restricting it to platform admin would break that screen. Options: per-clinic branding, or admin-only with the admin portal (`/api/admin/organisation`) |
| G8 | `POST /api/storage/logo`: any clinic staff, path not clinic-prefixed (`branding/logo-*`), download token URL is the capability | (b) | Low | OPEN (cosmetic; fix together with G7) |
| G9 | `POST /api/auth/medplum-session` is unauthenticated (stores whatever token it is given; useless without a valid token) and `GET` returns the HttpOnly token to JS (used by the browser Medplum client) | (a) | Low | OPEN, by design; note for XSS posture (CSP is nonce-based) |
| G10 | `GET /api/suppliers` searches **all** supplier Organizations with `_count=200` and filters by clinic afterwards; clinics beyond the first 200 suppliers overall lose rows. Not a leak | (b) | Low (correctness) | OPEN: add the clinic identifier to the search |
| G11 | `/api/health/deep` is anonymous and reports which env vars are set (ok/missing, no values) | (a) | Info | OPEN, acceptable for an uptime probe |

## Route table

Legend - Auth: `PA` platform admin; `CA` `requireClinicAuth`; `CA+S` CA plus a real-session check (bypass disabled); `key` per-device key; `sig` HMAC signature; `tok` viewer token; `bearer` shared secret; `none` anonymous. Clinic scope: how reads/writes are bounded (`pol` = staff client under the AccessPolicy; `app` = admin client with app-level check; `id->404` foreign/missing id returns 404).

| Route | Methods | Auth | Clinic scope | Verdict |
|---|---|---|---|---|
| admin/clinics, admin/clinics/[id] | GET POST / GET PATCH DELETE | PA | n/a (platform) ; subdomain regex `^[a-z0-9-]+$` | OK |
| admin/organisation | GET POST PATCH DELETE | PA | n/a | OK |
| admin/users, users/[id], users/[id]/status, users/invite | various | PA (+ managed-project check on status; self-deactivate refused) | n/a | OK |
| analytics/[tab] | GET | CA + module flag | clinic passed to queries, `pol` | OK |
| appointments | GET POST PATCH DELETE | CA | `getAppointmentForClinic`, `*ForClinic`, patient checked via `getPatientFromMedplum` | OK (id->404) |
| audit-log | POST | CA (was any session) | clinic stamped, actor from session | FIXED (G3) |
| auth/login | POST | public by design (credentials) | host clinic must match membership | OK (rate limiting not audited) |
| auth/me | GET | session | own profile only | OK |
| auth/medplum-session | POST DELETE GET | none (cookie setter) | cookie value validated on write | OK / G9 |
| billing | GET POST PATCH DELETE | CA | `invoiceBelongsToClinic` on every read/write, `assertPatientInClinic` on create | FIXED (G4, G5) |
| catalogs | GET POST PATCH DELETE | CA | `app`: `resourceMatchesClinicTenant` | FIXED (G4, 500->404) |
| check-in | POST | CA | patient via `getPatientFromMedplum`, `assertPatientInClinic` | OK |
| consultations | GET POST PATCH DELETE | CA | clinic-scoped getters, patient checked, id->404 | FIXED (G4) |
| consultations/draft, /plan | GET POST DELETE | CA | draft scope keyed by clinic+patient+practitioner | OK |
| diagnoses | GET | CA | static catalog, `q` is filtered in memory (no search string) | OK |
| document-templates | GET POST | CA | `app`: template keyed by clinic; `type` whitelisted | OK |
| documents | GET POST PATCH DELETE | CA | patient checked first; `assertStoredResourceInClinic` | OK |
| export-to-medplum | POST | bearer (503 if secret unset) | one clinic per run, id regex, `makeClinicStamper` | FIXED (G6) |
| fhir/register-extensions | POST GET | **none -> PA** | n/a | FIXED (G1) |
| feedback | POST | CA + rate limit + module flag | admin client, always keyed by clinic | OK |
| follow-up, [id], process-due | GET POST PATCH DELETE | CA | `app`: clinic identifier filter + `getFollowUpClinicId` (id->404); `assertPatientInClinic` on create | OK |
| follow-up/twilio/status | POST | sig (403 if token/URL unset or bad signature) | looks up by MessageSid | OK (fail closed) |
| health, health/deep | GET | none | no data | OK / G11 |
| inventory | GET POST PATCH DELETE | CA | `app`: clinic filter in service; dispenses read as staff (`pol`) | FIXED (G5) |
| orders, orders/billable | GET POST PATCH DELETE | CA | clinic-scoped consultation getter -> 404 | OK |
| organization | GET PUT | CA | **shared parent org, admin client** | G7 OPEN |
| pacs/devices, poct/analysers | GET | CA+S + module flag | clinic-filtered Device search | OK |
| pacs/dicomweb/[...path] | GET | tok (HttpOnly viewer session) + viewer host header + module re-check | one study, one clinic; path/QIDO forced to study | OK |
| pacs/orthanc/study | POST | key (device) | device clinic only; `pacsServesClinic` | OK (fail closed) |
| pacs/unmatched | GET POST | CA+S + module flag | clinic-keyed review list; attach checks order clinic | OK |
| pacs/viewer/launch | GET | tok (single use) | token carries clinic; module re-check before consume | OK |
| pacs/viewer/link | POST | CA+S + module flag | id regex + clinic AND id in one search, re-checked | OK |
| patients, patients/intake-pilot | GET POST PATCH DELETE / POST | CA | `getPatientFromMedplum(id, clinic)`; search post-filtered with `matchesClinic`; free text only in `name:contains`/`phone:contains` (fixed keys) | FIXED (G4); search text safe |
| practitioners | GET | CA | staff client; Practitioner/PractitionerRole policy-scoped (`clinic-staff-policy-drift.test.ts`) | OK |
| procedures | GET POST PATCH DELETE | CA | `app`: `isProcedureForClinic` | FIXED (G4) |
| purchases | GET POST PATCH DELETE | CA | `app`: `isClinicPurchaseOrder`, 404 | OK |
| queue | GET POST DELETE PATCH | CA | `assertPatientInClinic`, clinic-scoped queue | OK |
| referrals | GET POST PATCH DELETE | CA | referral + its patient checked, 404 | OK |
| scheduling/book, manual-book | POST | CA | patient checked; slot/schedule clinic-checked | OK |
| scheduling/schedules, slots, slots/generate | GET POST | CA | `listClinicSchedules`; foreign `scheduleId` -> 403 | FIXED (G4) |
| settings/follow-up, settings/insurers | GET PUT / GET POST PATCH DELETE | CA | `app`: clinic identifier, 404 on foreign | OK |
| storage/logo | POST | CA | unscoped path | G8 OPEN |
| suppliers | GET POST PATCH DELETE | CA | `app`: `belongsToClinic`, 404 | OK / G10 |
| tasks, tasks/[id] | GET / PATCH | CA + module flag | `getBillingTaskClinicId` -> 404 | OK |
| triage | GET POST PATCH DELETE | CA | patient checked; encounter checked | FIXED (G4) |

## Search-string review (c)
Free text reaches Medplum only as the *value* of fixed keys (`name:contains`, `phone:contains`, `identifier=nric|<text>`); keys are never user-controlled, so no `_filter`/param injection. In `identifier=<system>|<text>` a `,` makes an OR, but those sub-queries are post-filtered with `matchesClinic`, so a widened query cannot return another clinic's rows. Ids (`Patient/${id}`, `_id`, consultation ids) are now shape-checked where they come straight from the query string, and the clinic id is checked once centrally (G2). Service-level `readResource(type, id)` paths are URL path reads, not searches.

## Tests
`tests/unit/task645-api-audit.test.ts`: id/clinic shape tables; forged cookie -> `ForbiddenError` with no network call; `register-extensions` GET/POST and `audit-log` -> 401 anonymous (nothing called) and 403 with a forged clinic cookie; foreign catalog/procedure id -> `NotFoundError`. `clinic-boundary.test.ts` updated: void of a foreign invoice is now `NotFoundError` (was a generic "Access denied" error).
