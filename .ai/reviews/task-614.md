# Task 614 — review of Task 613 (PR #317, branch claude/perf-591)

Verdict: **APPROVE** (one small fix pushed).

- Merged origin/dev: already up to date.
- Loading vs empty: `getCatalogSearchState` returns results > loading > empty > idle; "No matches." only shows once catalogs have settled. `loadingCatalog={!catalogsSettled}`; failure also settles (no endless Loading…). Default `loadingCatalog=false` so other callers are unchanged (no other callers pass it).
- Fix: after a failed load, reopening the drawer retried silently while the composer showed "No matches"; now `setCatalogsSettled(false)` before each request so retry shows Loading… again.
- Add/save/plan flows: composer add/save/plan code untouched apart from the state label; `buildSignedDocumentNote`/`documentKind` moved verbatim to `lib/orders/signed-document-note.ts` and re-exported from order-composer (import compat kept). Catalogs are only consumed by the treatment drawer, loaded on first open.
- Perf (591/601): Encounter search patient+clinic scoped and paged; catalogs lazy; dynamic tab chunks; no regression from 613.
- Clinic scope: Encounter search still sends the clinic identifier AND patient identifier; client-side clinic/patient filter retained; tenant memo keyed per clinic.
- Checks: tsc (tsconfig.lint.json) clean; unit tests 591/593/601/613 = 27 pass; eslint on changed files: only pre-existing react-hooks findings in order-composer.tsx, identical to dev. E2E not run (no dev server started).
