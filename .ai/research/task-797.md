# Task 797 – API route security sweep

Scope: every `route.ts` under `app/api` and `app/(routes)/api` (77 files), plus server actions
(`"use server"` only appears in `lib/module-registry.ts`, which is a comment/constant, so there are **no server actions**).
Read from the code on `dev` (239510c), not from older notes. No servers, no Medplum calls: code reading, unit tests and tsc only.

Global layers checked first
- `proxy.ts`: CSRF Origin/Sec-Fetch-Site check on all mutating `/api` calls (`lib/security/csrf.ts`); exempt prefixes are only routes with their own non-cookie auth (device ingress, Twilio, bulk export). Note: headerless `POST` with `content-type: application/json` and any `PUT/PATCH/DELETE` pass when no Origin is sent (non-browser clients) – acceptable, browsers always send Origin/Sec-Fetch-Site.
- `requireClinicAuth` (`lib/server/medplum-auth.ts:410`): session → clinic from subdomain/cookie → `isValidClinicId` → `assertClinicAssignment` (PractitionerRole in that clinic Organisation). Platform admins pass for any clinic (by design).
- `requirePlatformAdmin`: Medplum `membership.admin` of the caller.
- `authenticateDeviceKey` (`lib/fhir/device-keys.ts`): SHA-256 hashed per-device key, Device must be active, bound to exactly one clinic, right type, module on. Clinic comes from the Device, never the request.

Legend – Auth: **S** = signed-in session, **C** = session + clinic assignment (`requireClinicAuth`), **PA** = platform admin, **DK** = device key, **SIG** = Twilio signature, **BS** = bearer secret, **none** = public.
Verdict: OK / OK-note (works, minor note) / FIXED (fixed in this PR) / GAP (documented, not fixed).

## Table

| Route | Methods | Auth | Clinic scoping | Input validation | Verdict |
|---|---|---|---|---|---|
| `/api/health` | GET | none | n/a (config booleans only) | none needed | OK |
| `/api/health/deep` | GET | none | n/a (config booleans + Medplum reachability) | none needed | OK-note: unauthenticated Medplum probe per hit; fine behind the proxy |
| `/api/auth/login` | POST | none (credentials) | host/subdomain must match an assigned clinic; platform admin only on admin host | email/password presence; `next` only checked with `startsWith('/')` in the clinic branch | GAP-1 (open redirect via `//host`); file is in open PR #353, so not touched |
| `/api/auth/medplum-session` | POST/GET/DELETE | none (POST sets a cookie from a client-supplied token; GET returns the cookie token) | clinic cookie validated by `isValidClinicId`; real membership re-checked on every clinical call | token ≤ 8 KB string, clinicId pattern | OK-note: GET hands the HttpOnly session token to JS (needed by the Medplum browser client); XSS would expose it. CSP is the mitigation |
| `/api/auth/me` | GET | S | own profile | n/a | OK-note: 401 body echoes `error.message` |
| `/api/admin/users` | GET | PA | all staff (platform-wide by design) | n/a | OK |
| `/api/admin/users/[id]` | GET/PATCH/DELETE | PA | platform-wide by design | names required, orgIds filtered | OK-note: does not check the caller's Medplum project like `/status` does (see GAP-4) |
| `/api/admin/users/[id]/status` | PATCH | PA + caller project = managed project | platform-wide | boolean, no self-deactivate | OK |
| `/api/admin/users/invite` | POST | PA | clinicId from body (PA only) | required fields, password ≥ 8 | OK-note: 500 echoes `error.message` (GAP-5, in open PR #353) |
| `/api/admin/clinics` | GET/POST | PA | platform-wide | name/subdomain regex | OK |
| `/api/admin/clinics/[id]` | GET/PATCH/DELETE | PA | platform-wide | name, PACS hosts allow-listed, module ids normalised | OK |
| `/api/admin/organisation` | GET/POST/PATCH/DELETE | PA | platform-wide | name/id required | OK-note: DELETE accepts any Organisation id incl. a clinic |
| `/api/admin/create-medplum-client` | POST | PA | n/a | all three fields only checked for presence | GAP-3 (server-side request to a body-supplied URL) |
| `/api/fhir/register-extensions` | POST (GET=405) | PA | n/a | none needed | OK |
| `/api/export-to-medplum` | POST | BS (timing-safe, disabled without secret) | one clinic per run, `clinicId` regex, own-clinic Patient reuse | action/clinicId checked; Firestore doc fields trusted | OK-note: 500 and per-item errors echo `error.message` (secret holder only) |
| `/api/follow-up/twilio/status` | POST | SIG (before any Medplum call, URL-bound clinic) | clinic inside signed URL | form-encoded only | OK |
| `/api/imaging/receive` | POST | DK (pacs) | Device's clinic | 256 KB cap, rate limit, study shape | OK |
| `/api/imaging/receive/message` | POST | DK (pacs) | Device's clinic | same | OK |
| `/api/imaging/report` | POST | DK (pacs) | Device's clinic | text lengths, status enum | OK |
| `/api/labs/receive` | POST | DK (poct) | Device's clinic | `validateLabReceiveResults`, caps | OK |
| `/api/labs/receive/message` | POST | DK (poct) | Device's clinic | format enum, message string, caps | OK |
| `/api/pacs/orthanc/study` | POST | DK (pacs) + PACS serves clinic | Device's clinic | 4 KB cap, `isOrthancId` | OK |
| `/api/pacs/viewer/launch` | GET | single-use signed launch token + viewer-host header + module toggle | clinic+study in token | token HMAC | OK |
| `/api/pacs/dicomweb/[...path]` | GET | HttpOnly viewer session cookie + viewer-host header + module toggle | one clinic, one study; path/QIDO forced to that study | `scopeDicomwebRequest` | OK |
| `/api/pacs/viewer/link` | POST | C + real session + module | study searched with clinic identifier | id regex | OK |
| `/api/pacs/unmatched` | GET/POST | C + module | clinic-scoped lists/actions | id/action types | OK |
| `/api/pacs/devices` | GET | C + module | clinic devices | n/a | OK |
| `/api/poct/analysers` | GET | C + module | clinic devices | n/a | OK |
| `/api/patients` | GET/POST/PATCH/DELETE | C | service helpers take clinicId (patient read/update/archive check clinic) | required fields on POST; `limit/page` via parseInt | OK |
| `/api/patients/intake-pilot` | POST | C | clinicId passed to save | required fields | OK-note: `questionnaireResponseWarning` echoes `error.message` to a signed-in user |
| `/api/check-in` | POST | C | patient read with clinic first | patientId | OK |
| `/api/queue` | GET/POST/PATCH/DELETE | C | clinicId passed | status allow-list | OK |
| `/api/triage` | GET/POST/PATCH/DELETE | C | clinicId passed | required fields | OK |
| `/api/appointments` | GET/POST/PATCH/DELETE | C | patient-clinic check / service clinic checks | required fields | OK |
| `/api/consultations` | GET/POST/PATCH/DELETE | C | patient + encounter clinic checks | idempotency key pattern | OK |
| `/api/consultations/draft` | GET/POST/DELETE | C + Practitioner profile | draft keyed by clinic+practitioner+patient; `assertOrderClinic` | size caps, version check | OK |
| `/api/consultations/plan` | GET/POST/DELETE | C + Practitioner | same scope helper | tab allow-list | OK-note: missing patientId/draftId throws a plain Error → 500 instead of 400 |
| `/api/orders` | GET/POST/PATCH/DELETE | C | consultation read with clinic; encounter search with clinic identifier | bill-line numbers validated | OK |
| `/api/orders/billable` | GET | C | clinic queue | n/a | OK |
| `/api/billing` | GET/POST/PATCH/DELETE | C | `assertCheckoutConsultationPatient`, id safety, services take clinicId | method/amount/items checked | OK-note: GAP-6 (client-sent totals; body validated before auth) |
| `/api/documents` | GET/POST/PATCH/DELETE | C | patient check + `assertStoredResourceInClinic` before delete | PDF-only multipart; JSON path accepted any `storagePath` | **FIXED** (see below) |
| `/api/document-templates` | GET/POST | C; POST also PA | clinic-keyed template | type allow-list | OK |
| `/api/referrals` | GET/POST/PATCH/DELETE | C | referral+patient clinic checks | required fields | OK |
| `/api/procedures` | GET/POST/PATCH/DELETE | C (admin client) | clinicId passed to service | name required | OK |
| `/api/catalogs` | GET/POST/PATCH/DELETE | C (admin client) | clinicId passed | type allow-list | OK |
| `/api/diagnoses` | GET | C | clinic catalog | limit clamp | OK |
| `/api/inventory` | GET/POST/PATCH/DELETE | C (admin client) | clinicId passed; ids safety-checked on GET | `parseInventoryInput` | OK |
| `/api/suppliers` | GET/POST/PATCH/DELETE | C (admin client) | identifier search + `belongsToClinic` on id routes | name required | OK |
| `/api/purchases` | GET/POST/PATCH/DELETE | C (admin client) | `isClinicPurchaseOrder` on id routes; stock update with clinicId | numbers coerced, PATCH merges arbitrary keys | OK-note: PATCH `{...current, ...rest}` mass-assigns fields inside the clinic's own PO; feature flag gated |
| `/api/settings/insurers` | GET/POST/PATCH/DELETE | C (admin client) | `belongsToClinic` | name/value required | OK |
| `/api/settings/follow-up` | GET/PUT | C; PUT also PA | clinic settings | delivery mode allow-list | OK |
| `/api/organization` | GET/PUT | C | **parent organisation is shared by all clinics**; PUT uses the service account | name required, `logoUrl` free text | GAP-2 |
| `/api/storage/logo` | POST | C (any staff) | path `branding/…` is not clinic-scoped | `image/*`, ≤ 1 MB | GAP-7 (SVG allowed, no per-clinic path) |
| `/api/follow-up` | GET/POST | C (admin client) | clinicId passed | type/date schema | OK-note: `patientId`/`sourceId` are not verified against the clinic (stored as free text on the clinic's own follow-up) |
| `/api/follow-up/[id]` | PATCH/DELETE | C | Communication clinic checked before action | id safety, status/action allow-lists | OK |
| `/api/follow-up/process-due` | POST | C | clinic follow-ups only | none | OK |
| `/api/tasks` | GET | C + module | clinic | enum | OK |
| `/api/tasks/[id]` | PATCH | C + module | Task clinic checked | status enum | OK |
| `/api/scheduling/book` | POST | C | patient clinic check; service takes clinicId | required fields | OK |
| `/api/scheduling/manual-book` | POST | C | same | required fields | OK-note: 409 echoes service message (overlap text only) |
| `/api/scheduling/slots` | GET | C | clinicId passed | start/end required | OK |
| `/api/scheduling/slots/generate` | POST | C | schedule must be in clinic (PR #355 area) | start/end required | OK |
| `/api/scheduling/schedules` | GET/POST | C | clinicId passed | practitionerId required | OK |
| `/api/analytics/[tab]` | GET | C + module | clinicId passed | tab allow-list, range parser | OK |
| `/api/audit-log` | POST | C | actor taken from session, clinic stamped | field caps | OK |
| `/api/feedback` | POST | C + module + rate limit | clinic-scoped records | sanitiser, size cap, image type | OK |
| `/api/practitioners` | GET | C | **lists all practitioners, not just this clinic** (staff client; depends on Medplum AccessPolicy) | n/a | **FIXED** (data minimised) + GAP-8 (cross-clinic list) |
| `/api/labs/order` | POST/PATCH/DELETE | C | service takes clinicId; POCT needs Practitioner | patient/tests required | OK |
| `/api/labs/results` | GET | C | target searched with clinic identifier | one id required | OK |
| `/api/labs/subscription` | POST | C + module | patient/encounter searched with clinic identifier; subscription criteria carries clinic | id regex | OK |
| `/api/imaging/order` | POST/PATCH/DELETE | C | service takes clinicId | required fields | OK |
| `/api/imaging/results` | GET | C | target searched with clinic identifier; PACS URLs allow-listed | one id required | OK |
| `/api/fhir/export` | POST | C | encounter + patient clinic checks | zod | OK |
| `/api/ocr` | POST | S (dev bypass only outside production) + IP rate limit | n/a | zod, 20 MB cap | OK |
| `/api/referral-letter` | POST | S + IP rate limit | n/a (text in body) | zod 10k | **FIXED** (error text echoed) |
| `/api/soap-rewrite` | POST | S + IP rate limit + feature flag | n/a | zod 10k | **FIXED** (error text echoed) |
| `/api/smart-text/summary` | POST | C + IP rate limit | patient + consultations with clinic | patientId | **FIXED** (patient text in logs) |

## Fixed in this PR (small, no open PR touches these files)

1. `/api/documents` – a clinic user could save a document through the JSON path with any `storagePath`; deleting that document then removed that Storage object with the Admin SDK, including another patient's or clinic's file. Now the JSON path only accepts a file inside the patient's own `patients/<id>/documents/` folder (new `lib/fhir/document-storage-path.ts`) and DELETE never removes an object outside that folder (covers records saved before the fix; the record itself is still removed). Multipart upload (the only path the UI uses) is unchanged.
2. `/api/referral-letter`, `/api/soap-rewrite` – 500 responses returned `error.message` from the AI provider call (can contain provider URLs/key hints). Now a fixed message; detail stays in the server log.
3. `/api/smart-text/summary` – the fallback path logged the full generated summary of a patient's consultations. Those two `console.log` lines are removed.
4. `/api/practitioners` – returned name, e-mail and the organisation memberships of every practitioner; the only caller needs id and name. Response is now `{ id, name }` only.

Regression tests: `tests/unit/task797-api-sweep.test.ts` (6 tests). `bun test tests/unit` 1353 pass, `bun run lint` (tsc + clinic-admin check) clean, eslint clean on changed files.

## Confirmed gaps left for follow-up (documented only)

- **GAP-1 – open redirect in `/api/auth/login` (low).** Clinic branch accepts `next` = `//evil.example` (`startsWith('/')` only) and returns it as `redirectUrl`; the login page then calls `router.replace(redirectUrl)`. The login page filters with `safeNext` (`lib/login-redirect.ts`) but the API is callable directly (login-CSRF style). Suggested fix: run `next` through `safeNext()` server-side in all three branches. Skipped because open PR #353 edits this file.
- **GAP-2 – any clinic staff member can edit the shared parent Organisation (medium).** `PUT /api/organization` only needs `requireClinicAuth` and then writes with the service account to the parent Organisation, whose name/phone/address/logo appear for all clinics. The Settings page uses it today, so restricting it changes an existing feature. Suggested fix: add a clinic-admin role (or require platform admin) for PUT, or store the company profile per clinic Organisation instead of the shared parent; validate `logoUrl` as an `https://` URL on our storage host.
- **GAP-3 – `/api/admin/create-medplum-client` fetches a body-supplied URL (low, PA only).** It sends credentials to `medplumUrl` from the request body. Suggested fix: only accept `env.MEDPLUM_BASE_URL` (or an allow-list) and drop the three `console.log` lines; the e2e test fills the real origin, so it keeps working.
- **GAP-4 – `/api/admin/users/[id]` and invite/clinic routes do not check the caller's Medplum project (low).** Only `/status` compares `auth/me.project` with the managed project. Login pins `projectId`, so exposure needs an admin of another project to sign in; add the same check to a shared helper to be safe.
- **GAP-5 – error text echoed:** `/api/admin/users/invite` 500, `/api/auth/me` 401, `/api/export-to-medplum` 500, `/api/patients/intake-pilot` warning. Suggested fix: fixed messages + server log (invite is in PR #353).
- **GAP-6 – `/api/billing` trusts client totals (medium, business logic).** `paidAmount >= totalAmount` is checked, but `totalAmount` and item prices come from the browser and are not recomputed from catalog/consultation data; validation also runs before authentication (400 vs 401 order). Suggested fix: recompute totals server-side from the consultation and stored prices, run `requireClinicAuth` first.
- **GAP-7 – `/api/storage/logo`:** any staff member can upload; `image/svg+xml` passes the `image/*` check and the object is public via a download token under a shared `branding/` path. Suggested fix: allow only png/jpeg/webp, write under `branding/<clinic>/…`, restrict to admins.
- **GAP-8 – `/api/practitioners` lists practitioners of every clinic (medium to low).** It uses the signed-in user's client, so what is returned depends on the Medplum AccessPolicy (not verifiable without Medplum calls). Suggested fix: filter to practitioners with a PractitionerRole in the caller's clinic Organisation (needs an exported `resolveClinicOrganizationIds`), keeping platform admins in the list.
- **Systemic notes:** no per-role authorisation inside a clinic (any assigned staff can void/delete invoices, delete patients' documents, run `process-due` SMS sends); rate limits key on the left-most `X-Forwarded-For`, which is only safe while the reverse proxy overwrites the header; `/api/smart-text/summary` sends consultation text to OpenRouter (third-party egress – keep disclosed in the privacy notes).
