# Task 714 route coverage

Baseline is local `origin/dev` at `b22d32e`. The read-only `gh pr view --json files` checks found all requested PRs open (#334 and #338–#343). Their paths are excluded from this change, including the existing Medplum mock helper edited by #340.

| Route or service | Existing coverage on origin/dev | Task 714 gap |
| --- | --- | --- |
| `GET/POST /api/document-templates`, `document-template-service` | `task682-document-templates` covers the service, including defaults and scoped Organization search | Route read and save, session scope, admin-only writes and validation |
| `GET/PUT /api/settings/follow-up`, follow-up settings service | No direct unit coverage found | Scoped read/save and admin-only writes |
| `GET/POST /api/follow-up`, `PATCH/DELETE /api/follow-up/[id]`, `POST /api/follow-up/process-due` | `task682-follow-ups` covers communication helpers, list filtering and service mutations | Schedule creation and listing, explicit send and due processing using mocked Twilio |
| `POST /api/follow-up/twilio/status` | `task680-twilio-callback-containment`, `twilio-status-signature`, and `task690-public-route-hardening` | Existing callback coverage |
| `PATCH /api/admin/clinics/[id]` and module settings | `module-settings` covers PACS and POCT opt-in, `time-chit` covers core behavior and ignoring legacy toggle values, and `module-toggle.spec` exercises PACS pages | Persist a per-clinic toggle and exercise its effect at an imaging API boundary |
| `GET /api/pacs/devices` | No direct route coverage found. The imaging-order route has `task515-xray-ux`. PACS ingest, unmatched, viewer and DICOMweb have `pacs-ingest-viewer`. Imaging report and device ingress have `imaging-report-auth` and `task691-ingress-happy-paths` | Device endpoint uses the saved PACS switch and clinic scope |
| `GET /api/analytics/[tab]` | `task688-analytics-summary` covers the summary route and service queries. `task551-analytics`, `task502-analytics-perf`, `task558-analytics-revenue` and `task564-analytics-exact` cover aggregate/query behavior | Clinical and money route responses with mixed-clinic rows, clinic-scoped counts and cache isolation |
| `GET/POST/PATCH/DELETE /api/suppliers` and `/api/purchases` | Suppliers have `task688-suppliers-enabled` and `task688-suppliers-disabled`. Purchases have `task383-purchases-scope` and `purchases-scope.spec`, including list/read/write containment and creation | Existing route coverage |

The app handlers take Web Request/Response objects via NextRequest and NextResponse, with Promise-based dynamic route params. Invoke the handlers directly in Bun. The existing in-memory Medplum helper provides deterministic fake records and write capture. The tests stub Twilio at fetch and never call a live clinical or imaging backend.

- [Next.js 16 Route Handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route)
- [Medplum 5.2.8 client source](https://raw.githubusercontent.com/medplum/medplum/v5.2.8/packages/core/src/client.ts) and [Medplum client API](https://www.medplum.com/docs/sdk/core.medplumclient)
- [FHIR R4 search and token parameters](https://hl7.org/fhir/R4/search.html)
- [DICOM PS3.18 Web Services](https://dicom.nema.org/medical/dicom/current/output/html/part18.html)
- [React 19](https://react.dev/blog/2024/12/05/react-19)

On this branch the installed Medplum client is locked separately from the server version. The tests use the existing client method signatures and leave DICOM transport to the existing PACS suites.

The lockfile installs `@medplum/core` 5.1.13 and Next.js 16.4.5. The reminder form submits a date-only value. The API also accepts a timestamp with a timezone, using the existing Zod dependency. The Twilio mock answers at the HTTP boundary so the test can assert the clinic in the signed callback URL's query.

- [FHIR R4 dateTime](https://hl7.org/fhir/R4/datatypes.html#dateTime)
- [Zod ISO date and datetime validators](https://zod.dev/api#iso-datetimes)
- [Twilio Messages resource and status callbacks](https://www.twilio.com/docs/messaging/api/message-resource)

## Draft PR title and body

**Task 714 — Cover clinic settings, follow-up and analytics routes**

### Summary

- Add 13 fake-data unit cases for document templates, follow-up settings and delivery, saved X-ray module settings, core Time Chit availability, and clinical and money analytics. The tests reuse the in-memory Medplum helper and mock Twilio at `fetch`.
- Require platform-admin permission as well as an active clinic session for template and follow-up settings writes. Clinic members can still read their clinic's settings.
- Look up follow-up settings by the authenticated clinic identifier. Looking up an Organization by the clinic ID as a resource ID could select a different clinic's Organization. Keep the same clinic identifier when reading back the saved settings.
- Return 400 for invalid follow-up dates and unknown PATCH actions before writing. Continue to accept the form's date-only input.
- Use current follow-up data for due processing and skip queued, completed and stopped deliveries so a later processing run does not send them again.

### Verification

- `tsc --noEmit --incremental false`, ESLint on changed TypeScript files, and `git diff --check` passed.
- `bun test tests/unit` produced 1,239 passes and one failure. The same scheduling clinic-containment test in `task639-scheduling-slots.test.ts` failed on untouched `origin/dev` (1,226 passes and one failure). That file is also in PRs #334 and #341.
- No dev server or Playwright run. The full `check-all.sh` gate includes a live application, Playwright and a Medplum clinic audit, which were outside this unit-only run.
