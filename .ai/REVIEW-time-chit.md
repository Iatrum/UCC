# Task 140 review

Self-review (single agent; no delegation requested). Scope: changes relative to origin/dev.

- Module registry: `time-chit` is known but absent from default enabled ids; empty route/pages
  satisfy existing types and do not create a navigation entry. Generic clinic admin form discovers it.
- Composer: filters all Time Chit catalog rows while disabled, including custom-catalog variants.
  Adds a fallback when custom clinic catalogs omit it. Existing MC/referral branches retained.
- Authorization: clinic id comes from requireClinicAuth/server scope. Shared consultation service
  gates creation/replacement/removal before writes; orders POST gates before billing writes as well.
  Entire-consultation deletion checks the scoped encounter and existing Time Chits before removal.
- Data: shared date/time/doctor validation; positive same-day interval; duration recomputed on server.
  Time Chit Procedures carry clinic identifiers and explicit account metadata on create/replacement.
  Missing tenancy blocks creation. Historical view/reprint has no module gate.
- Rendering: attendance-only wording, no diagnosis field; A4 PDF and editable HTML template use the
  MC shell, time-in/out/duration row, doctor signature/stamp and attendance-only disclaimer.
  New HTML interpolation escapes values and does a single substitution pass.
- POCT/X-ray components, Lab results, sidebar/navigation and Firebase Storage unchanged.
- Local validation evidence and final outcomes are recorded in progress-time-chit.md.

Limits: existing service replaces all procedures for a document edit, so module-off checks block
that replacement if it includes an existing Time Chit. No MC tenancy retrofit, transactions or
new draft-storage backend is included. Full-suite/build gate intentionally excluded by user scope.

## Task 141 — independent review (Claude, 2026-11-14)

Scope: `git diff origin/dev...HEAD` (post-merge with `origin/dev` 2f56211, Phase 2 isolation
included) against OWASP A01/A03 (clinic scoping, module-toggle gating, template escaping/XSS),
FHIR R4 Procedure usage, interaction with the merged Phase 2 clinic AccessPolicy, and regressions
in the composer, MC/referral, Lab/POCT/X-ray.

### MAJOR (found and fixed in this worktree)

`updateConsultationInMedplum` (`lib/fhir/consultation-service.ts`) added an **unconditional**
`resolveClinicTenant(client, clinicId)` call on every consultation update — not just ones touching
a Time Chit. `resolveClinicTenant` throws (does not return `null`) whenever the clinic's
Organization or Account `HealthcareService` can't be resolved for the caller's Medplum context.
Before this PR, `updateConsultationInMedplum` never called it at all, so chief-complaint/notes/
diagnosis/prescription edits had no dependency on clinic-tenant resolution. After this PR, *any*
edit to *any* consultation — MC, referral, prescriptions, diagnosis, nothing-to-do-with-Time-Chit
— would start throwing for a clinic whose Organization/Account tenancy doesn't resolve on that
request path, even with Time Chit off. This is the same class of collateral failure D40 found for
Device lookups: a module-specific guard leaking into a shared code path and breaking unrelated
features for policy-bearing/edge-case clinics. The companion `saveConsultationToMedplum` (create
path) already had this same unconditional call *before* this PR (not introduced here, out of
scope to fix), so clinics able to create consultations today happen not to hit it — but update is
a new, PR-introduced exposure with no such precedent.

Fix (applied, typechecked, lint-clean, both e2e specs green after the fix — see below): only
resolve/require `clinicTenant` inside `updateConsultationInMedplum` when `updates.procedures` is
present *and* actually contains a Time Chit procedure, matching the already-correct narrower gate
used by `assertTimeChitMutationAllowed`. No behavior change for Time Chit itself; removes the
blanket dependency for every other edit.

### Confirmed clean (no action needed)

- Clinic scoping: `requireClinicAuth` supplies `clinicId` server-side on every route touched
  (`/api/orders`, `/api/consultations`, `/api/document-templates`); `assertMatchesClinic` guards
  the encounter on update/delete. No client-supplied `clinicId` path found.
- Module-toggle gating: `assertTimeChitMutationAllowed` runs before writes on consultation
  create/update/delete and on `/api/orders` POST/PATCH/DELETE (via `updateConsultationInMedplum`),
  including whole-consultation deletion. Historical view/print is intentionally gate-free
  (read-only), consistent with the MC/referral precedent.
- XSS/template escaping: `fillTimeChitTemplate` escapes `& < > " '` before `{{placeholder}}`
  substitution and is the only path used for the composer preview `iframe srcDoc` and the
  historical reprint HTML; the PDF path uses `@react-pdf/renderer` (`Text`/`View`), not
  `dangerouslySetInnerHTML`, so there's no separate unescaped sink.
- FHIR R4 / Phase 2 AccessPolicy interaction: Time Chit Procedures stamp `meta.accounts` with the
  resolved clinic `HealthcareService` reference, the same compartment pattern already used by
  `catalog-service.ts`, `inventory-service.ts` and `scheduling-service.ts` for the merged Phase 2
  `clinic-access-policy.ts` compartment rule (`meta.accounts.exists() and ...`). A policy-bearing
  migrated doctor who can already use the composer can create/print Time Chits; no new Device-style
  blanket 403 found once the MAJOR above is fixed (that fix is precisely what prevents the D40-style
  regression here).
- Composer / MC / referral / Lab / POCT / X-ray: no Lab, POCT, X-ray, Firebase Storage, or
  sidebar/navigation files touched by this diff.

### Re-run after merge + fix (all green)

- `npx tsc --noEmit -p tsconfig.lint.json` — PASS
- `node scripts/check-clinic-admin-medplum.mjs` — PASS
- `bun test tests/unit/module-settings.test.ts tests/unit/time-chit.test.ts` — 8 pass, 27 assertions
- `playwright test tests/time-chit.spec.ts --workers=1` (UCC_BASE_URL=:3214) — 1 passed (36.2s).
  First attempt in this review hit a strict-mode locator failure caused by an **orphaned test
  catalog item** (`Time Chit Fake 3ffbf161`) left over from an earlier interrupted session's failed
  teardown (`ECONNRESET` on its cleanup `DELETE`) — not a code regression. Deleted the orphan via
  `DELETE /api/catalogs`, re-ran clean.
- `playwright test tests/workflow.spec.ts --workers=1 --grep '(01 login|02 register|03 check-in|04
  start|06 composer|08 documents)'` (UCC_LOCAL_DOCUMENTS_ONLY=1) — first attempt: test 2 ("02
  register patient") timed out waiting for post-submit navigation on a freshly (cold-)started dev
  server; no `/patients/new` file is touched by this diff and the retry passed cleanly in 6.6s with
  no code change, confirming a cold-compile/hydration timing flake, not a regression. Re-run: 6
  passed (1.2m).

### Verdict: **APPROVE**

One MAJOR found (unconditional `resolveClinicTenant` call added to `updateConsultationInMedplum`,
a Device-D40-style collateral regression breaking all consultation edits for clinics whose tenant
doesn't resolve) — fixed in this worktree, re-verified lint/typecheck/unit/both e2e specs green.
No other MAJOR or security findings. Approved to merge once the fix commit is pushed.
