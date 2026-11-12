# Progress: Time Chit (Task 110, plan + design only)

Branch: `ai/plan-time-chit`. No app/lib code changes in this task — research, plan, and a static
HTML mockup only. Working directory: `/workspace/ucc-plan-timechit` (not `/workspace/iatrum-ucc`,
which Codex is using concurrently — untouched).

## Status: in progress

- [x] Read the existing MC feature end to end: catalog item → composer sub-form/preview →
  `ProcedureRecord` JSON → FHIR `Procedure` persistence → two render paths (react-pdf at
  checkout, HTML template afterwards) → billing link. Also read the module-toggle mechanism
  (`modules/`, `lib/module-registry.ts`, `lib/module-settings.ts`, admin clinic-edit-form) using
  POCT/PACS as the precedent, and `lib/fhir/clinic-tenancy.ts` + `.ai/research/clinic-isolation.md`
  for the `meta.accounts` isolation mechanism.
- [x] Researched Malaysian time-slip/time-chit practice in general terms (web search, 4 sources,
  recorded in the research doc) to ground the print wording (attendance, not unfitness) and field
  set (date, time in/out, hours, doctor, clinic).
- [x] `.ai/research/time-chit.md` written: MC architecture file-by-file, time-chit general
  practice, and the consequences for the plan.
- [x] `.ai/PLAN-time-chit.md` written: data model table (MC pattern reused per layer), new
  off-by-default module toggle (`time-chit`, no `routePath`/`pages` so nav/sidebar never changes),
  why the catalog fallback alone can't satisfy "default off" (and the fix), UI flow from the
  consultation composer, print layout, clinic-isolation notes (new `meta.accounts` stamping at
  creation, not retrofitted onto MC), file-by-file change table, e2e test list (7 tests), and a
  self-critique pass (2 MAJOR findings fixed in-document: catalog-fallback visibility leak, and a
  missing edit/delete-path server gate mirroring a real POCT regression documented in
  `.ai/progress-poct-toggle.md`).
- [ ] UX design note + `.ai/mockups/time-chit.html` static mockup (composer sub-form + preview +
  printable slip).
- [ ] Final review pass of both docs against this progress file; last commit + push.

## Key decisions made while researching (not yet in DECISIONS.md — this task doesn't touch shared
round-log files per its brief, scope is the 4 named deliverables only)

- Time Chit is **not** a routed module (no `/time-chit` page) — it only ever surfaces inside the
  existing consultation composer and the patient's "Generated Documents" list, both pre-existing
  UI. This is what lets the toggle satisfy "no sidebar/nav changes" for free, the same way the
  legacy `analytics`/`inventory` module ids already have no nav entry.
- Catalog membership (`DEFAULT_DOCUMENT_CATALOG`) and module-gated visibility are two separate
  mechanisms that must both be set correctly — adding the catalog entry alone would have made it
  visible by default on any clinic with no custom document catalog, defeating the toggle.
- New Time Chit `Procedure` records should get `meta.accounts` stamped at creation (reusing the
  pattern already live in `lib/fhir/catalog-service.ts`'s `clinicAccountMeta()`), rather than
  copying forward the known MC/Procedure gap (identifier-only stamping) documented in the ongoing
  clinic-isolation work. Explicitly scoped as new-code-only — not a retrofit of MC.

## Next step if resumed

Build `.ai/mockups/time-chit.html` (plain static HTML/CSS, no build step, matches §5/§6 of the
plan), then re-read both docs once more end to end, commit, push.
