# PLAN — Time Chit (Task 110, plan + design only, no feature code)

Full background: `.ai/research/time-chit.md` (how MC works today, file by file; Malaysian
time-chit practice). This plan reuses MC's existing pipeline end to end and adds one new,
off-by-default module toggle. No sidebar/nav changes anywhere in this plan.

## 1. What a Time Chit is, for this plan

A slip certifying the patient **attended the clinic** between a start and end time on a given
day, for a partial-day absence — not a certification of unfitness for work (that's MC's job, and
MC is untouched by this plan). Fields: patient name/NRIC, clinic (letterhead), date, time in,
time out, total hours (derived), attending doctor's name, clinic stamp box. See research §2 for
why the wording must stay in "attended clinic" terms and never borrow MC's "certified unfit"
language.

## 2. Data model (reuses the MC pattern, confirmed in research §1.1-§1.4)

| Layer | MC (existing) | Time Chit (new, same shape) |
| --- | --- | --- |
| Catalog item | `letter-mc` (`DEFAULT_DOCUMENT_CATALOG`, category `document`, price 0) | `letter-time-chit`, same catalog, category `document`, price 0 default |
| Composer entry | `ProcedureRecord{category:"documents", notes: JSON{kind:"mc", mcDays, mcStartDate, mcDiagnosis, mcDoctorName, ...}}` | `ProcedureRecord{category:"documents", notes: JSON{kind:"time-chit", tcDate, tcTimeIn, tcTimeOut, tcHours, tcDoctorName, title, status}}` |
| FHIR persistence | `Procedure` under the consultation `Encounter`, `note[0].text` = JSON blob, `withClinicIdentifiers` only | Same: `Procedure` under the same `Encounter`, `note[0].text` = JSON blob, **plus `meta.accounts` stamped at create time** (new, see §6 — do not copy the identifier-only gap forward) |
| Render — at sign/checkout | `@react-pdf/renderer` `<McDocument>` | New `<TimeChitDocument>`, same library/page size/letterhead helper, different body paragraph + time-in/out/hours row |
| Render — after the fact | HTML template (`DEFAULT_MC_TEMPLATE`, `/api/document-templates?type=mc`, editable in Settings) | New `DEFAULT_TIME_CHIT_TEMPLATE`, `/api/document-templates?type=time-chit`, same editor, new tab |
| Billing | Chargeable line item like any document, price 0 default, clinic can override | Same: chargeable, price 0 default |

`tcHours` is derived (`timeOut - timeIn`, same-day only) and stored alongside the raw times so
historical records don't silently change if someone later edits the computation — same reasoning
as MC storing both `mcStartDate` and `mcDays` instead of only one.

## 3. Feature toggle (new — MC has none; Time Chit must default off)

Reuses the module mechanism verbatim (research §1.6):

- Add `'time-chit'` to `KNOWN_BRANCH_MODULE_IDS` in `lib/module-settings.ts`. **Do not** add it to
  `DEFAULT_BRANCH_ENABLED_MODULE_IDS` — default is off for every clinic, same as `poct`/`pacs`.
- New `modules/time-chit/module.config.ts`: `id: "time-chit"`, `label`, `description`, **no
  `routePath`, no `pages`** (there is nothing to route to — Time Chit only ever appears inside the
  existing consultation composer and patient document list, never as its own page). This is what
  guarantees no sidebar/nav change: `listNavigationModulesForClinic()` only adds entries that have
  both a `routePath` and a loadable page.
- `isModuleEnabledForClinic('time-chit', clinicId)` called in exactly two places, mirroring POCT's
  two-layer check:
  1. **Client gate**: `app/(routes)/patients/[id]/page.tsx` (where `poctEnabled`/`pacsEnabled` are
     already resolved server-side) resolves `timeChitEnabled` the same way and passes it to
     `order-composer.tsx` as a new boolean prop. The composer only renders the Time Chit catalog
     row/sub-form when `timeChitEnabled` is true — same as POCT's analyser section.
  2. **Server gate**: wherever `consultation.procedures` get validated/persisted
     (`saveConsultationToMedplum` in `lib/fhir/consultation-service.ts`, and the `PATCH
     /api/consultations` path `referral-mc-section.tsx` uses to edit/delete saved documents) —
     reject (or silently strip, matching whatever error contract the endpoint already uses for
     invalid procedures) any procedure whose `notes` JSON has `kind: "time-chit"` if the module is
     off for that clinic's id. This closes the exact class of gap `.ai/progress-poct-toggle.md`
     found for POCT (`PATCH`/`DELETE` had no module check even though `POST` did) — check on
     every mutating path, not just creation, from day one.
- Admin toggle UI: **no change needed** — `listAvailableBranchModules()` + the existing
  `clinic-edit-form.tsx` generically list every module from `modules/`, so `time-chit` gets a
  working on/off switch in `/admin/clinics/[id]` for free, same as POCT/PACS did.

## 4. Why Time Chit can't just hide behind the existing document-catalog fallback

Research §1.1 found `DEFAULT_DOCUMENT_CATALOG` is a client-side fallback shown whenever a clinic
has zero custom `document` catalog items — if `letter-time-chit` were added to that constant the
same way `letter-mc` is, it would show up for every un-customized clinic regardless of the module
toggle, defeating "default off." So: add `letter-time-chit` to `DEFAULT_DOCUMENT_CATALOG` (it
needs to exist as a selectable catalog id either way, same as `letter-mc`/`letter-referral`), but
gate its *visibility in the composer* purely on the `timeChitEnabled` prop (filter it out of
`unifiedCatalogRows`/search results client-side when the prop is false) — not on catalog
membership. The server-side gate in §3 is what actually prevents bypass (e.g. a direct API call
adding the catalog id without going through the composer UI).

## 5. UI flow (from consultation, no new pages)

1. Doctor opens a patient's consultation composer (existing route, existing "Documents" tab —
   tab itself stays, unconditionally, since MC/referral still live there).
2. If `timeChitEnabled`, a "Time Chit" row appears in the Documents catalog list alongside MC and
   Referral Letter (hidden entirely, not disabled/greyed-out, when the module is off — avoids
   confusing staff with a permanently-disabled option for a feature they don't know exists).
3. Selecting it opens the same inline sub-form pattern MC uses (not a separate modal): date
   (defaults today), time in, time out (both default to "now"/blank, required), doctor's name
   (free text, same as MC — no session auto-fill, confirmed in research as MC's existing
   behaviour). Hours auto-calculates and displays read-only underneath the time fields.
4. A live preview renders next to the form (`TimeChitDocumentPreview`, same inline-HTML pattern as
   `McDocumentPreview` — not react-pdf, just for the composer).
5. Saving the plan line item persists the JSON blob into `ProcedureRecord.notes` exactly like MC.
6. At sign/checkout, the Documents tab of the checkout screen shows it as a line item (price 0
   unless the clinic set a non-zero price); the print rendition there is the new
   `<TimeChitDocument>` react-pdf component.
7. After signing, it shows up in the patient's "Generated Documents" card
   (`referral-mc-section.tsx`, which needs a 3rd `kind` branch) for later view/edit/delete/reprint,
   using the new HTML template + `window.print()`, same as MC's post-hoc path.

## 6. Print layout

A4, same page shell/margins/letterhead helper as MC (clinic logo/name/address/phone from
`fetchOrganizationDetails()`), title band "TIME CHIT" / "SURAT WAKTU" instead of "MEDICAL
CERTIFICATE", same patient-details box (name, NRIC), then:

```
This is to certify that the above-named patient attended this clinic
on <date> from <time in> to <time out> (<hours> hour(s)), for medical
attendance.
```

Signature block identical to MC (doctor name line, "Medical Practitioner" / clinic role label,
issued date, dashed clinic-stamp box). Deliberately **omit** any "unfit for work" / "sick leave"
language — see research §2. See `.ai/mockups/time-chit.html` for the concrete HTML/CSS mockup
(desktop layout, matches the composer sub-form + preview + the printable slip itself).

## 7. Security / clinic isolation notes (uses `meta.accounts`, per AGENTS.md "clinic data stays
separate")

- Every Time Chit `Procedure` is created under the same `Encounter` as the rest of the
  consultation and inherits `withClinicIdentifiers(..., clinicId)` (app-level `identifier:
  clinic|<slug>`) exactly like every other procedure — no regression there.
- **New, not copied from MC**: at the point `saveConsultationToMedplum` builds each `Procedure`
  (`lib/fhir/consultation-service.ts`, "6. Create Procedures"), the function already has
  `clinicTenant` in scope (it's used two lines later for the `Provenance` call). Time Chit's
  `Procedure` creation should pass `meta: { accounts: [{ reference: clinicTenant.accountReference
  }] }` at create time — the same `clinicAccountMeta()`-style stamping `lib/fhir/catalog-service.ts`
  already does for `ChargeItemDefinition`. This makes the Time Chit record visible to Medplum's
  own `_compartment=%clinicAccount` `AccessPolicy` criteria (`scripts/setup-access-policies.ts`),
  not just the app-level identifier filter — closing, for this one new resource type, the same gap
  `.ai/research/clinic-isolation.md` (D33 finding #2) flagged for `Procedure`/`Encounter` update
  paths generally. Does **not** attempt to fix that gap for MC's existing `Procedure` records or
  any other resource type — out of scope, tracked separately under the clinic-isolation
  initiative (D33-D36).
- Server-side module check (§3) must resolve `clinicId` independently of any client-supplied
  value, same pattern already used by `isModuleEnabledForClinic` callers elsewhere (resolved from
  `requireClinicAuth`/session, never trusted from the request body) — prevents a clinic with the
  module off from being tricked into accepting a time-chit entry by a crafted request claiming a
  different clinic.
- The HTML-template extension (`https://ucc.emr/document-template/time-chit`) lives on the
  clinic's own `Organization` resource, same storage as MC/referral templates — already
  clinic-scoped by construction (one `Organization` per clinic), no new isolation surface.
- No new PHI exposure: Time Chit carries strictly less sensitive data than MC (no diagnosis field
  planned — just attendance times), so the plan does not add a diagnosis/reason field by default.
  If a future task wants one, treat it as a deliberate addition, not an oversight.

## 8. File-by-file change table (for whoever builds this — no code written in this task)

| File | Change |
| --- | --- |
| `lib/module-settings.ts` | Add `'time-chit'` to `KNOWN_BRANCH_MODULE_IDS`; leave `DEFAULT_BRANCH_ENABLED_MODULE_IDS` unchanged |
| `modules/time-chit/module.config.ts` | New. `id/label/description` only, no `routePath`/`pages` |
| `lib/clinical-catalog.ts` | Add `letter-time-chit` to `DEFAULT_DOCUMENT_CATALOG` (price 0, category `Letter`) |
| `lib/document-templates.ts` | Add `DEFAULT_TIME_CHIT_TEMPLATE` (HTML, placeholders per §6); update the placeholder-doc comment block |
| `lib/fhir/document-template-service.ts` | Widen `type: 'mc' \| 'referral'` to include `'time-chit'`; extension URL suffix `/time-chit` |
| `app/api/document-templates/route.ts` | Widen `isValidType` union to include `'time-chit'` |
| `components/settings/document-template-editor.tsx` | Add a 3rd tab/option for the time-chit template (mirrors existing mc/referral tabs) |
| `components/orders/order-composer.tsx` | New `timeChitEnabled?: boolean` prop; new `TimeChitDocumentPreview` (mirrors `McDocumentPreview`); new sub-form state (date/timeIn/timeOut/doctorName, derived hours); `documentKind()` gains `"time-chit"`; catalog-row filtering hides `letter-time-chit` when the prop is false |
| `app/(routes)/patients/[id]/page.tsx` | Resolve `timeChitEnabled` via `isModuleEnabledForClinic('time-chit', clinicId)` alongside the existing `poctEnabled`/`pacsEnabled` resolution; pass down to composer |
| `lib/fhir/consultation-service.ts` | In the Procedure-creation loop: if `proc` parses as `kind: "time-chit"`, reject when the module is off for `clinicId` (server gate); on create, stamp `meta.accounts` from `clinicTenant.accountReference` (§7) |
| `app/(routes)/api/consultations/route.ts` (or wherever the `PATCH` used by `referral-mc-section.tsx` lives) | Same module-off rejection on edit/delete of an existing time-chit entry, not just creation |
| `app/(routes)/orders/checkout/[consultationId]/checkout-client.tsx` | `renderCheckoutDocument()` gains a `kind === "time-chit"` branch rendering the new react-pdf component |
| `components/mc/time-chit-document.tsx` | New. `@react-pdf/renderer` component, same structural pattern as `mc-document.tsx`, body text per §6 |
| `app/(routes)/patients/[id]/referral-mc-section.tsx` | `signedDocumentKind()`/`getSignedDocuments()`/`buildDocumentHtml()`/edit dialog gain a 3rd `"time-chit"` branch (own field set: date/timeIn/timeOut/doctorName, no diagnosis) |
| `app/(admin)/admin/clinics/[id]/page.tsx`, `clinic-edit-form.tsx` | No change — generic module listing already picks up the new module |

## 9. e2e test list (new file `e2e/tests/time-chit.spec.ts`, pattern copied from
`module-toggle.spec.ts` + `poct.spec.ts`'s module-disabled test)

1. **Default off**: a fresh fake clinic has `time-chit` absent from its Organization extension →
   composer's Documents tab does not show a "Time Chit" row; `GET` of the module list via the
   admin edit form shows it present but unchecked.
2. **Enabled, composer flow**: enable the module for a fake clinic → open composer → Time Chit row
   appears → fill date/time-in/time-out/doctor → save plan → saved consultation's procedures
   contain a `category: "documents"` entry with `kind: "time-chit"` and the right fields.
3. **Sign/checkout renders the document**: sign the consultation → checkout screen's Documents tab
   shows the time chit as a line item → triggering the print/download path does not error (same
   assertion depth as `workflow.spec.ts`'s existing MC dialog screenshot step).
4. **Clinic isolation**: create a time chit for clinic A's patient; log in as clinic B staff;
   confirm clinic B cannot read clinic A's `Procedure`/`Encounter` containing it (reuse
   `clinic-isolation.spec.ts`'s existing cross-clinic-read assertion pattern) and that the new
   `meta.accounts` stamp is present on the created `Procedure` (direct admin-client read, same
   style `clinic-isolation.spec.ts` already uses to inspect `meta.accounts`).
5. **Module disabled after creation blocks edits, not reads**: with the module enabled, create a
   time chit; disable the module; assert `PATCH` (edit) and the delete action in
   `referral-mc-section.tsx` both now fail server-side (403/4xx, matching whatever convention
   §3's server gate uses) while the already-generated document is still viewable/printable
   (disabling a module must not erase or hide a patient's past record — same rule
   `.ai/progress-poct-toggle.md` already established for POCT's historical lab results); re-enable
   and confirm edits work again.
6. **Billing stays correct**: a clinic that sets a non-zero price on `letter-time-chit` sees that
   price reflected at checkout, same assertion style as the existing documents-billing coverage in
   `workflow.spec.ts`.
7. **Never breaks MC/referral**: run the existing `workflow.spec.ts` MC-dialog step
   (`08-mc-dialog`) and the referral flow with `time-chit` both on and off for the test clinic,
   confirming neither path's behaviour changes — directly protects the "never break existing
   features, especially the consultation composer" rule.

## 10. Self-critique (independent pass over this plan)

- **MAJOR, addressed above**: first draft of this plan put `letter-time-chit` straight into
  `DEFAULT_DOCUMENT_CATALOG` without noting the fallback-only semantics researched in §1.1 — that
  would have made Time Chit visible by default on any un-customized clinic regardless of the
  toggle, directly violating the "default off" requirement. Fixed in §4: catalog membership and
  module-gated visibility are kept as two separate, independently-checked things.
- **MAJOR, addressed above**: initial pass only planned the client-side composer gate (mirroring
  POCT's `POST`-only original gap). Added the explicit edit/delete-path server gate in §3 and test
  5 in §9, citing `.ai/progress-poct-toggle.md`'s documented regression for exactly this omission.
- **MINOR, addressed above**: did not originally plan any `meta.accounts` stamping, which would
  have silently reproduced the known clinic-isolation gap for a brand-new resource type instead of
  avoiding it. §7 now requires it at creation, reusing the existing `clinicAccountMeta()` pattern.
- **MINOR, open, flagged not fixed**: this plan does not attempt to retrofit `meta.accounts`
  stamping onto MC's or referral's existing `Procedure` records — that's the clinic-isolation
  initiative's job (tracked in `.ai/BACKLOG.md`/D33-D36), not this task's. Calling it out so a
  future reader doesn't assume this plan silently fixed MC too.
- **MINOR, open**: the plan does not specify what HTTP status/error shape the server gate in §3
  should return — deliberately left to match whatever the target endpoint already does for other
  validation failures (`consultation-service.ts`'s existing error conventions), rather than
  inventing a new one; the builder should read that file's current error handling before picking
  one, not copy POCT's `ForbiddenError`/403 convention blindly if this endpoint does something
  different.
