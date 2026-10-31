**REVISE** — 4 changes:

1. **Clinic isolation gap must be logged, not silently skipped.** `receiveLabResults` resolves `accountRefs` from the target `ServiceRequest` itself and never checks them against the caller — a single global `POCT_API_KEY`/`PACS_API_KEY` lets any device write Observations/DiagnosticReports into *any* clinic's ServiceRequest by ID, violating AGENTS.md's "clinic data stays separate." The plan treats this as out of scope but doesn't say so anywhere persistent. Add an explicit entry to `.ai/BACKLOG.md` (phase 2: per-clinic device keys + clinic match check before write) so it isn't forgotten.

2. **Proxy does not gate these routes — plan should say so explicitly.** `proxy.ts` only does subdomain routing/header forwarding; it has no auth logic and its matcher excludes nothing that would exempt `/api/labs/receive` or `/api/imaging/receive`. The in-route key check is the *only* defense. Plan step 2 ("call helper before any other validation") is correct, but add a line confirming this was verified — otherwise a future refactor could add proxy-level auth and someone might assume route-level checks are redundant.

3. Header-vs-body: fine as written (header preferred, body back-compat), but note in the route that body-supplied keys may land in access logs — acceptable only because it's documented legacy behavior, not a new pattern to copy elsewhere.

4. Status default to `final`: reasonable per research note, but confirm `lab-service.ts` also validates DiagnosticReport status fallback (`every r.status === 'final' ? 'final' : 'partial'`) still works once `status` can arrive validated/defaulted — currently reads `result.status` directly after the route-level default, so order of operations must be checked at implementation time.

Everything else (fail-closed 401, timing-safe compare, dropping `error.message`) is correctly scoped and matches OWASP API2:2023.
