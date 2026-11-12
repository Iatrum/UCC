# Time Chit — research (plan-only task, Task 110)

Date: 2026-11-12. Read-only against the repo (`ucc-plan-timechit` worktree). No app/lib code
changed, no Medplum writes, no secrets touched. Goal: understand exactly how the existing MC
(Medical Certificate) feature is built — data model, FHIR persistence, rendering/print, billing
link, feature-toggle precedent — and what a Malaysian "time chit" is in general practice, so the
plan can reuse real patterns instead of guessing.

## tl;dr

MC is **not** one feature, it's three cooperating pieces that already exist for a reason:
1. A **catalog item** (`letter-mc`, category `document`, price 0) selectable from the consultation
   composer's "Documents" tab — this is the only way an MC gets created, there is no
   standalone "/mc" page.
2. A **data shape**: once added, the line item is a `ProcedureRecord` (`category: "documents"`)
   whose `notes` field holds a JSON blob (`{kind:"mc", title, status, mcDays, mcStartDate,
   mcDiagnosis, mcDoctorName}`). On sign, this is persisted as a FHIR `Procedure` resource under
   the consultation's `Encounter`, with that same JSON string as `Procedure.note[0].text`.
3. **Two independent render paths** for the same JSON: a `@react-pdf/renderer` component used
   once, at checkout/sign time (`components/mc/mc-document.tsx`), and a clinic-customizable HTML
   template + `window.print()` used afterwards, from the patient's "Generated Documents" list
   (`lib/document-templates.ts`, `/api/document-templates`). Both are driven by the same stored
   JSON; neither is the "real" FHIR representation.

MC has **no feature toggle today** — it's always on for every clinic, unlike POCT/PACS/Tasks
which are gated by the `modules/` + Organization-extension mechanism described below. Time Chit
should copy MC's data/render pattern but **must** gain a toggle, using that existing mechanism
verbatim (same as POCT/PACS), not invent a new one.

## 1. How MC works today, file by file

### 1.1 Catalog entry (where it starts)
- `lib/clinical-catalog.ts`: `DEFAULT_DOCUMENT_CATALOG` hardcodes `letter-mc` (`type: 'document'`,
  `category: 'Letter'`, `defaultPrice: 0`, `active: true`) and `letter-referral`. This is a
  **client-side fallback only** — `getClinicalCatalog('document')` calls `GET /api/catalogs?
  type=document`; if the clinic has zero custom `document` `ChargeItemDefinition`s in Medplum, it
  falls back to `DEFAULT_DOCUMENT_CATALOG`; if the clinic has even one custom document item, the
  hardcoded MC/referral entries disappear and only the clinic's own list shows. (Pre-existing
  quirk, not something this plan needs to fix, but it means "always visible" for MC is actually
  "visible unless a clinic has customized its document catalog" — worth knowing so Time Chit's
  default-off requirement isn't accidentally satisfied by the same fallback mechanism, see §4.)
- `lib/fhir/catalog-service.ts`: real catalog items are `ChargeItemDefinition` FHIR resources,
  typed via extensions (`https://ucc.emr/catalog-type` = `document`), priced via
  `propertyGroup[0].priceComponent[0].amount` (MYR), and clinic-scoped via `meta.accounts`
  (`clinicAccountMeta()` at line ~68 stamps `meta.accounts` **at create time** — this is the
  pattern Time Chit's new resources should copy, see §6).

### 1.2 Composer UI (where it's built)
- `components/orders/order-composer.tsx`: the "Documents" tab (one of 4 fixed tabs: items,
  services, packages, documents — all always rendered, not toggle-gated) lists catalog rows;
  `documentKind(item)` maps `item.meta?.kind === "mc" || item.id === "letter-mc"` → `"mc"`.
  Adding the row creates a plan entry; a dedicated MC sub-form (days, start date, diagnosis,
  doctor name — state at lines ~391-450) feeds a **local** preview component
  `McDocumentPreview` (inline HTML/CSS, lines ~95-150, not the shared template, not react-pdf —
  a third, composer-only rendering of the same shape, kept in sync by hand).
  On save the entry becomes `{ mcDays, mcDiagnosis, mcStartDate, mcDoctorName }` serialized into
  `ProcedureRecord.notes` as JSON (line ~750).
  The composer already receives clinic-scoped feature flags as plain boolean props —
  `poctEnabled?: boolean; pacsEnabled?: boolean` (component signature, line ~1-4) — this is the
  exact shape Time Chit's `timeChitEnabled?: boolean` prop should follow.

### 1.3 FHIR persistence (what's actually saved)
- Consultation = FHIR `Encounter` (`lib/fhir/consultation-service.ts::saveConsultationToMedplum`).
  Per line item in `consultation.procedures`, a `Procedure` resource is created (§"6. Create
  Procedures", ~line 416): `code` (coding or free text), `note: [{text: proc.notes}]` (the JSON
  blob verbatim), `extension: orderExtensions(proc)` (price/qty), `encounter`/`subject`
  references, stamped with `withClinicIdentifiers(..., clinicId)` — i.e. an app-level
  `identifier: clinic|<slug>` only. **No `meta.accounts` stamping happens for `Procedure`
  resources** in this path — only the `Encounter` itself and the `Provenance` audit record get
  `meta.accounts` (via `clinicTenant.accountReference`, lines ~478-489). This is the same class of
  gap flagged for other resource types in `.ai/research/clinic-isolation.md` (D33 finding #2) —
  not yet fixed for `Procedure`, and therefore not yet fixed for MC's own `Procedure` records
  either. See §6 for what Time Chit should do differently.
- `getConsultationFromMedplum` reads the `Encounter` back and checks `matchesClinic(encounter,
  clinicId)` (app-level `identifier` check, not a Medplum-level block) before returning it.

### 1.4 Rendering / print (two independent paths, same JSON)
- **At sign/checkout time**: `app/(routes)/orders/checkout/[consultationId]/checkout-client.tsx`
  parses `documentDetails` from the procedure's `notes` JSON and renders
  `components/mc/mc-document.tsx`'s `<McDocument>` — a `@react-pdf/renderer` component (A4 page,
  explicit `StyleSheet`, letterhead/logo from `lib/org.ts`'s `fetchOrganizationDetails()`,
  signature block, dashed "Clinic Stamp" placeholder box). This produces an actual PDF
  (`pdf(...).toBlob()`), downloadable or shown in `<PDFViewer>`.
  `components/mc/mc-modal.tsx` is an older, currently-unused-in-the-main-flow standalone modal
  wrapping the same `<McDocument>` with its own day-count/date inputs — kept in the tree but not
  wired into the composer anymore (composer has its own `McDocumentPreview`). Not worth reviving;
  Time Chit does not need an equivalent standalone modal.
- **After the fact, from the patient profile**: `app/(routes)/patients/[id]/referral-mc-section.tsx`
  ("Generated Documents" card) re-derives the same fields from the saved `ProcedureRecord.notes`
  JSON (`getSignedDocuments()`), lets staff edit/delete them (`PATCH /api/consultations`
  rewriting the `procedures` array) or preview/print them. Printing here uses a **second,
  independent render path**: a clinic-customizable HTML string
  (`lib/document-templates.ts::DEFAULT_MC_TEMPLATE`, `{{placeholder}}` substitution via
  `fillPlaceholders()`), fetched from `GET /api/document-templates?type=mc`
  (`lib/fhir/document-template-service.ts`, stored as an `Organization` extension
  `https://ucc.emr/document-template/mc`, editable per clinic in Settings via
  `components/settings/document-template-editor.tsx`), shown in an `<iframe srcDoc>`, and printed
  via `window.open(blobUrl).print()` (no PDF library involved; relies on the browser's native
  print-to-PDF).
- **Net effect**: there are 3 separate hand-written renderings of "the MC document" in this repo
  (composer preview, react-pdf checkout document, HTML template). Not ideal, but it's the
  established pattern — Time Chit should follow it rather than introduce a 4th different approach
  (e.g. a shared template engine), per "never break existing features" / minimal-surprise.

### 1.5 Billing link
- Documents are chargeable line items like any other: `category: "documents"` `ProcedureRecord`s
  flow through checkout exactly like items/services/packages (`checkout-client.tsx`'s
  `CheckoutItem` type, "Documents" tab in the checkout UI, `TreatmentRows`). MC/referral both
  default to price 0 (`defaultPrice: 0` in `DEFAULT_DOCUMENT_CATALOG`), but a clinic can give any
  document catalog item a non-zero price via the catalog settings UI (`buildPrice()` /
  `PATCH` on the `ChargeItemDefinition`) — if they do, it bills like a normal item at checkout.
  There is no special-case "MC is always free" rule in code; price 0 is just the shipped default.

### 1.6 Feature toggle precedent (POCT/PACS/Tasks — what MC does *not* use)
- `modules/<id>/module.config.ts` (e.g. `modules/poct/module.config.ts`) declares `id`, `label`,
  `description`, optional `routePath` + `pages` (lazy-loaded page components). A module with no
  `routePath`/`pages` is valid (e.g. legacy `analytics`/`inventory`) and **never appears in the
  sidebar** — `listNavigationModulesForClinic()` (`lib/module-registry.ts`) only adds a module to
  nav if it has a `routePath` *and* a loadable page.
- `lib/module-settings.ts`: `KNOWN_BRANCH_MODULE_IDS` (`appointments, inventory, analytics,
  follow-up, tasks, poct, pacs`) are the ids an admin can toggle; `DEFAULT_BRANCH_ENABLED_MODULE_IDS`
  (`appointments, inventory, analytics, follow-up`) are on by default for every clinic with no
  explicit setting — `poct`/`pacs`/`tasks` are known but **not** in the default list, i.e.
  off-by-default. The actual per-clinic state is one JSON-array `Organization.extension`
  (`https://ucc.emr/organization-enabled-module-ids`), read/written by
  `getEnabledModuleIdsFromOrganization`/`withEnabledModuleIdsExtension`.
- `lib/module-registry.ts::isModuleEnabledForClinic(moduleId, clinicId)` is the one function
  everything calls: client pages call it server-side to decide what to pass down as a prop
  (`app/(routes)/patients/[id]/page.tsx` → `poctEnabled`/`pacsEnabled` → composer props), and API
  routes call it again, independently, before accepting a write
  (`app/api/poct/analysers/route.ts`, `lib/fhir/lab-service.ts`'s `createLabOrder`'s `order.poct`
  branch, `lib/poct/analyser-bot.ts`) — **both layers check**, so a disabled module is enforced
  even if someone calls the API directly. `.ai/progress-poct-toggle.md` documents a past bug where
  only the POST path checked and PATCH/DELETE didn't — the fix pattern (check at every mutating
  entry point, not just creation) is directly relevant to Time Chit.
- Admin UI (`app/(admin)/admin/clinics/[id]/clinic-edit-form.tsx` + `page.tsx`) lists
  **every** module generically via `listAvailableBranchModules()` (reads `modules/` dir configs,
  falls back to the legacy `lib/modules.ts::MODULES` map for ids without a package) — **adding a
  new `modules/time-chit/module.config.ts` with no `routePath`/`pages` automatically gets a
  working on/off toggle in this admin screen with zero changes to the admin UI itself.**
- `e2e/tests/module-toggle.spec.ts` shows the exact test pattern (`setModuleEnabled()` helper
  flips the Organization extension directly via a disposable fake-clinic patient, asserts
  UI/route behaviour, restores the prior value in a `finally`).

## 2. Malaysian "time chit" practice (general, non-legal summary)

A **time slip / "time chit"** ("surat waktu" colloquially) is a short note a Malaysian clinic
gives a patient confirming they were physically at the clinic between a start and end time on a
given day — it certifies **attendance**, not **unfitness for work**. This is distinct from, and
has no statutory status equivalent to, a **Medical Certificate (MC)**:

- Under the Employment Act 1955 (s.60F), an MC — a doctor's certification that the employee is
  unfit for work for a stated period — is what triggers paid sick-leave entitlement. A time chit
  does not; attending a clinic for an hour or two is not, by itself, a certified sick day.
- Employers are not legally required to grant paid sick leave on the strength of a time chit
  alone; whether the hours it covers are treated as paid time off, annual leave, unpaid leave, or
  made up later is an **internal HR policy decision**, not a legal entitlement — this is why the
  document should avoid MC-style language like "certified unfit for work."
- Typical real-world use: an employee needs a few hours off during the working day for a
  short clinic visit (follow-up, vaccination, minor treatment, specialist review) that doesn't
  warrant a full MC. The clinic issues a chit stating arrival/departure time so the employee has
  something to show HR, without the doctor having to certify a day of unfitness that wasn't
  medically warranted.
- Because it has no statutory force, format is not standardized by law the way MC content
  loosely is — clinics use their own letterhead and wording. Common fields in practice: patient
  name/NRIC, date, time in, time out, total duration, attending doctor's name, clinic
  name/address/stamp. This maps directly onto what Task 110 asks for (date, time in/out, hours,
  doctor, clinic) and onto the MC template's existing field set (minus "day(s) unfit", plus
  explicit time-in/time-out).

Sources (general background, not used for any code decision):
[Time Slip vs MC in Malaysia: What's the Difference?](https://www.ajobthing.com/resources/blog/time-slip-vs-mc-in-malaysia-what-difference),
[Time Slip vs MC — Key Differences Every Malaysian Employee Must Know](https://www.ricebowl.my/career-advice/blog/en/33698/time-slip-vs-mc-malaysia-guide),
[MC vs Time Slip in Malaysia｜Agensi Pekerjaan Reeracoen Malaysia](https://www.reeracoen.com.my/articles/mc-vs-time-slip-malaysia-hr-guide),
[Malaysia Medical Leave (MC) & Hospitalization Leave Guide 2026](https://duittools.com/blog/malaysia-medical-leave-mc-hospitalization-leave-guide-2026).

## 3. Consequence for the plan

- Time Chit = a 4th document kind alongside `mc`/`referral`, reusing the exact catalog → composer
  tab → `ProcedureRecord` JSON → `Procedure` → (react-pdf at checkout + HTML template afterwards)
  pipeline — not a new subsystem.
- Time Chit = a **new, off-by-default module id** (`time-chit`) added to `KNOWN_BRANCH_MODULE_IDS`
  but *not* `DEFAULT_BRANCH_ENABLED_MODULE_IDS`, with a `modules/time-chit/module.config.ts` that
  has **no `routePath`/`pages`** (so it can never appear in the sidebar — satisfies "no sidebar/nav
  changes" automatically, the same way `analytics`/`inventory` already don't need one).
  `isModuleEnabledForClinic('time-chit', clinicId)` gates: (a) whether the composer shows the
  Time Chit catalog row/sub-form (client), and (b) whether the consultation-save path accepts a
  `time-chit` document entry at all (server) — mirroring POCT's two-layer check and the
  PATCH/DELETE gap `.ai/progress-poct-toggle.md` had to close after the fact.
- The content should say "attended clinic from HH:MM to HH:MM" / "requires time off work for
  medical attendance", never "certified unfit for work" — that phrase is reserved for MC and
  mixing them would misrepresent what the clinic is attesting to.
- New `Procedure` records for Time Chit should be stamped with `meta.accounts` **at creation**
  (the `clinicAccountMeta()` pattern already used in `catalog-service.ts`), not copy forward the
  known MC/Procedure gap of identifier-only stamping — cheap to do correctly since it's new code.
