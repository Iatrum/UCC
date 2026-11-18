# Task 601 - snappiness round 3 (continues PR #317 / Tasks 591, 593)

Follow-ups from `task-593.md` section 6. Method as in 593: `next build --webpack` + `next start -p 3601` (ONE server,
`--max-old-space-size=3072`, killed afterwards), dev Medplum `:8113`, fake demo clinic, `globalThis.fetch` preload logging every FHIR call,
headless Chromium for the client side. Same session/patient for before and after; "before" = this branch without the Task 601 commit.
Wall-clock is noisy on this shared box, so the table uses **counts and bytes**; no test asserts timing.

## Changes
1. **Composer catalogs on demand.** `patient-profile-workspace.tsx` fetched `/api/procedures`, 3x `/api/catalogs?type=`, `/api/inventory`
   on every profile mount. Only the Treatment drawer (`OrderComposer`) uses them. Now `shouldLoadComposerCatalogs(drawerMode, panelOpen, alreadyRequested)`
   (`lib/orders/composer-catalogs.ts`) triggers one `loadComposerCatalogs` the first time the Treatment drawer opens (once per page; the
   composer mounts at the same moment and fills in as before, i.e. the same async-catalog behaviour as the old mount-time fetch).
   Same endpoints, same per-clinic server scoping, no new client or server cache, so nothing to key per clinic.
2. **Lazy tabs / drawer.** `next/dynamic` for `OrderComposer`, `LabResultsView`, `ImagingResultsView`, `PatientDocuments`, `ReferralMCSection`
   (each already mounts only when its tab/drawer is shown; fallback is a plain "Loading..." line, no layout redesign).
   `buildSignedDocumentNote` + `documentKind` moved to `lib/orders/signed-document-note.ts` (re-exported from `order-composer.tsx`) so the
   workspace no longer statically imports the composer module. The consult editor (RichTextEditor, DiagnosisSearch) is deliberately NOT
   lazy: it is the consultation composer and is used on first interaction.
3. **Duplicate `/auth/me`.** `draftScope` called `medplum.getProfileAsync()` (an uncached `/auth/me`) although `requireClinicAuth` already
   loaded the profile through the token-memoised `loadMe`. `draftScope` now uses `loadMe` (same Practitioner check). Used by
   `/api/consultations/draft` and `/api/consultations/plan`.

## Before / after (profile `/patients/[id]`, prod build)
| | before | after |
|---|---|---|
| Post-hydration JSON fetches (excl. `_rsc` prefetch) | session, me, procedures, 3x catalogs, inventory, draft = 8 | session, me, draft = 3 |
| Browser requests, document to network idle | 47 | 42 |
| FHIR calls caused by one page load (page + its client APIs) | 27 | 21 |
| FHIR calls, `/patients/[id]` server render (warm) | 15 | 15 (unchanged; 3 dependent waves from Task 593) |
| FHIR calls, `/api/consultations/draft` warm / cold | 6 / 9 (cold has 2x `/auth/me`) | 5 / 8 (1x `/auth/me`) |
| JS first load, wire (Chromium) | 34 files, 459 KB | 32 files, 434 KB (-25 KB, -5%) |
| JS first load, decoded | 1497 KB | 1405 KB (-92 KB, -6%) |
| Composer catalogs requested before the Treatment drawer opens | 5 | 0 |

Honest read: the request/FHIR savings are real and deterministic; the bundle saving is modest because most first-load JS is the shared
framework/UI chunk set, and the profile still ships the consult editor. Dependent client round-trip depth (session -> me -> draft) is
unchanged; the five catalog calls no longer compete with the draft load and are not paid by clinicians who never open Treatment.
Further bundle work would need the consult editor lazy-loaded (composer decision) or a look at the shared chunk (next build analyzer).

## Verification (production build, dev Medplum, fake data)
- Existing `composer-plan`, `composer-plan-unsaved` specs pass (5 tests), plus new `e2e/tests/task601-composer-lazy.spec.ts`:
  no catalog request before Treatment opens; opening it issues exactly procedures x1, inventory x1, catalogs lab/imaging/document;
  Paracetamol added, saved (server), Sign -> `POST /api/orders` 200; Labs & Imaging and Documents tabs render without a stuck "Loading...".
- `time-chit.spec.ts` fails at line 128 (`PATCH /api/consultations` -> 409 where 200 expected, after checkout). That is an API-only call on a
  route this task does not touch; not re-run on the baseline build, so treat as pre-existing/unverified rather than proven.
- Unit: `tests/unit/task601-perf.test.ts` (draftScope: one `/auth/me` shared with `loadMe`, non-practitioner rejected; catalog gate; loader
  mapping/active filter; signed-document-note). Full unit suite 746 pass. tsc (tsconfig.lint.json) clean; eslint clean on changed files
  (order-composer.tsx keeps its 4 pre-existing react-hooks errors, identical before the move).
