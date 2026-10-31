# Task 6a addon: admin E2E

Read AGENTS.md, e2e README/env/config/global setup, all admin pages/forms/layout,
all app/api/admin routes, the routes-group client endpoint, sidebar and admin service.

Official references verified:
- https://playwright.dev/docs/api/class-apirequestcontext — isolated request context; storageState passes cookies to browser.
- https://nextjs.org/docs/app/api-reference/functions/redirect — server redirect terminates rendering (modules redirects to organisation).
- https://react.dev/reference/react/useState — forms keep initial state; reload to verify persistence.
- https://www.medplum.com/docs/api/fhir/operations — FHIR operation framework.
- https://hl7.org/fhir/R4/organization.html — Organization hierarchy via partOf.

Safety/scope: exact local URLs only, one POST auth/login, no global doctor setup,
no app/lib edits. Settings has no save. User role selector and separate deactivate
are absent; clinic assignment and Delete User are present. Client creation always
logs in again server-side: cannot exercise success under the user's one-login rule;
exercise missing-fields validation without credentials and explicitly record gap.
Use only owned RUN-tagged resources, UI actions plus API readback, cleanup in finally.
The user explicitly requires ONLY admin.spec.ts, so do not run check-all (full suite).

Run completed once: 2.4 minutes, exit 1 with four soft failures. See
/workspace/ai-logs/admin-e2e/FINDINGS.md and 35 screenshots. Organisation/clinic
CRUD and seven module toggles passed; cleanup passed. Invite: HTTP 500 HTML JSON
parse. Local SDK verification (no auth) confirms getBaseUrl has trailing slash;
admin-service.ts:736 adds another slash. Read-only malformed-path GET returns
404 text/html. User detail/edit/delete blocked (no user created). Client validation
returns expected 400 but strict console check flags browser HTTP error. Client
success not submitted because it performs a forbidden second login. One initial
page load hit Next heap restart, but organisation creation subsequently passed.
No app/lib changes, no second login/server, no full check-all per user scope.
