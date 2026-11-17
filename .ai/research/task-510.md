# Task 510 notes
- `updateOrganizationDetailsInMedplum` (lib/fhir/admin-service.ts) keeps existing module/PACS extensions when `enabledModuleIds` / `pacsViewerHosts` are undefined (`withPacsHostsExtension` returns input for undefined), so a details-only PATCH is safe; PATCH route requires `name`, so the modules save re-sends the last-saved details.
- Search is a plain GET form (`?q=`) on server components; no client state, works with the existing status filter on Users.
- Next.js 16: `searchParams` is a Promise (already handled in users page).
- Docs: https://nextjs.org/docs/app/api-reference/file-conventions/page#searchparams-optional
