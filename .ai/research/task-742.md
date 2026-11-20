# Task 742 — security review of API/lib changes merged to origin/dev in the last 3 days

Scope: `git log origin/dev --since='3 days ago'` (Tasks 645–732 era): 29 non-test route files and ~70 lib files changed.
Checklist: session required, clinic scoping (Tasks 396/400/422/645 404/403 rules), CSRF Origin coverage (Tasks 720/721), input
validation, error-message leakage, secrets in code/logs. Method: read each route end to end, read the diffs of the shared libs.
References: OWASP CSRF Cheat Sheet (Origin verification), OWASP Unvalidated Redirects, FHIR R4 `id` datatype, Twilio webhook security docs.

## Findings fixed (2, both low severity, defence in depth)
1. `POST /api/auth/login` trusted `next` from the body (`startsWith('/')` only). `//evil.example` is a protocol-relative URL: on the admin
   host `adminPathForHost` returned it unchanged, on the clinic host it was returned as `redirectUrl`. The login page runs `safeNext`
   before sending, and the client navigates to `redirectUrl`, so the UI is not exploitable, and a cross-origin login is blocked by the CSRF
   guard, but the API itself was not safe. Fix: server runs the existing `safeNext` (rejects `//`, `\`, control chars, other origins);
   `lib/auth-medplum.tsx` also sanitises the returned `redirectUrl` with `safeNext`. Test: `tests/unit/task742-login-next.test.ts`.
2. `POST /api/admin/users/invite` returned `error.message` for every unexpected failure (500). That text can carry Medplum diagnostics
   (hosts, ports, ids, "non-JSON response (HTTP n)"). Fix: only the fixed-text 403/409 outcomes are echoed; all else is a generic 500,
   logged server side (message only). Test added in `tests/unit/task708-user-admin.test.ts`.

## Reviewed, no change needed (verdict OK)
- `lib/security/csrf.ts`, `proxy.ts`: mutating methods checked, `//` collapsed, Origin host vs forwarded host/allow-list, Sec-Fetch-Site fallback, exempt list = device-key / Twilio-signature / bearer-secret routes only. OK. Residual: requests with neither Origin nor Sec-Fetch-Site pass (non-browser clients cannot carry a victim's cookies; accepted by design in Task 720).
- `app/api/fhir/register-extensions` (platform admin, POST only, GET 405), `app/api/pacs/orthanc/study` (rate limit + body cap, device key before anything, clinic from key, generic errors), `lib/server/device-ingress-http.ts`, `lib/rate-limit.ts` (bounded map). OK. Note: rate limit key uses the first X-Forwarded-For hop; fine behind Traefik, best-effort in-memory only.
- `app/api/auth/medplum-session` (clinicId validated with `isValidClinicId`, token size capped, generic errors; GET returns the token to same-origin JS by design, pre-existing).
- `app/api/export-to-medplum` (bearer secret, constant-time compare, one clinic per run, own-clinic Patient reuse). Echoes `error.message` but only behind the secret; not changed.
- `app/api/follow-up/*`, `settings/follow-up` (platform admin for writes, ISO due date, `assertSafeFhirId`), `follow-up/twilio/status` (signature verified before Medplum, clinic inside the signed URL, fails closed), `lib/server/twilio-signature.ts` (timingSafeEqual).
- `app/api/tasks/[id]` (safe id, clinic of Task compared, 404 otherwise), `audit-log` (actor from session, clinic stamped, bounds), `feedback` (413 cap).
- `lib/server/medplum-auth.ts`, `auth-memo.ts`: memo keyed by sha256(token)+scope, failures not cached, token never stored; clinic id validated before use. Residual: an approved clinic assignment / deactivation can take up to 10 s to take effect (documented in Task 547).
- `lib/server/clinic-id.ts`, `lib/fhir/clinic-tenancy.ts`, `write-containment.ts` and the clinic routes (appointments, billing, consultations, documents, inventory, orders, patients, purchases, queue, referrals, settings/insurers, suppliers, triage, document-templates, analytics, audit-log): every handler calls `requireClinicAuth`/`requirePlatformAdmin`; clinic stamped/filtered; cross-clinic reads return 404.
- `NEXT_PUBLIC_DISABLE_AUTH` is ignored when `NODE_ENV=production` in both places it is read.
- Secrets: no keys, tokens or passwords in the changed code or logs; unexpected errors log `error.message` only. No GET handler under `app/api` writes.

## Verification
`bunx tsc --noEmit` and `bun test tests/unit` (see PR). No dev server used.
