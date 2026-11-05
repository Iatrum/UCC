# Plan: Task 12 — POCT X-ray

Status: **plan only**, no code changes, no PR. Written against `origin/dev` (not `ai-work`'s
working tree — `ai-work` on this round only carries `.ai/*` documentation commits; the actual
POCT lab code from Tasks 9-11 lives on `origin/dev` via merged PRs #223/#224/#226/#227/#228. This
plan was researched by reading that real code, not the docs-only `ai-work` tree.)

## 1. What "POCT X-ray" means here (scope decision — confirm with user before building)

`BACKLOG.md` has only one line: "POCT X-ray", under the same "Later" bullet that already lists
"POCT labs phases 1-3" as a separate, prior item. There is no detailed spec in the repo for Task
12 specifically (`.ai/DECISIONS.md` D27: "Tasks 10-12 have no detailed specification in repo yet").
Two readings are possible:

- **(A) Narrow — recommended.** Mirror what Tasks 9-11 built for lab: an **in-clinic, online,
  no-manual-entry X-ray *device*** (a point-of-care digital X-ray unit on the clinic's own network,
  the imaging equivalent of a glucose/HbA1c analyser), ordered from the composer only when that
  device reports online, with the study image arriving automatically through a device bridge —
  never typed in by staff. This sits *alongside* the already-existing, broader `pacs` module
  (CT/MRI/ultrasound/referral-style imaging with a human-typed radiologist report), which this
  plan does not change.
- **(B) Broad.** Retrofit the *entire* existing `pacs` module (`app/(routes)/pacs/*`,
  `/api/imaging/*`, `components/imaging/*`) into the POCT device-gated pattern — i.e. no imaging
  order of any modality without an online device, and no typed radiologist report either.

Reading (A) matches the task's own name ("POCT **X-ray**", not "POCT imaging" or "gate PACS") and
is the only one consistent with the already-merged `ai/task-poct-toggle` decision (§2 below) that
generic/referral imaging ordering is a separate, module-independent feature predating `poct`/`pacs`
and must not be broken ("Never break existing features"). Reading (B) would also make typed
radiology reports impossible, which has no basis in `AGENTS.md` (the "no manual result entry"
rule is written only for POCT, not for imaging generally) and no existing analyser-equivalent
concept for CT/MRI/ultrasound exists to gate on. **This plan builds (A).** If the user actually
means (B), stop and ask before writing code — it is a much larger, more disruptive change.

## 2. What already exists and will be reused unchanged

Verified by reading `origin/dev`, not guessed:

- **Module toggle**: `pacs` is already a `KNOWN_BRANCH_MODULE_IDS` entry in `lib/module-settings.ts`,
  not in `DEFAULT_BRANCH_ENABLED_MODULE_IDS` → **already default-off** for every clinic, same as
  `poct`. The admin toggle UI (`app/(admin)/admin/clinics/[id]/clinic-edit-form.tsx`) already lists
  it generically. **No new module id needed** — Task 12 reuses `pacs`, it does not invent an
  `xray`/`poct-xray` module.
- **Route-level gate**: `app/(routes)/pacs/layout.tsx` already calls
  `loadEnabledModulePage("pacs")`, so `/pacs` and `/pacs/new` already 404/`<ModuleUnavailable/>`
  when off (covered by `e2e/tests/module-toggle.spec.ts`, already passing).
- **Generic imaging ordering stays untouched**: the composer's existing "Investigations" tab lets
  staff order *any* catalog imaging procedure (`kind: "imaging"` in `lib/treatment-plan.ts`,
  `patient-profile-workspace.tsx` `imagingSelections` → `POST /api/imaging/order`) with **no**
  module/device check at all, by design (`.ai/progress-poct-toggle.md` on `dev`, the corrected
  "What already works" section: this predates `poct`/`pacs` and gating it would break
  `workflow.spec.ts` test 06/07's baseline). Task 12 must not touch this path — it adds a
  *new, separate* ordering path for the POCT-style device-gated X-ray, the same way `poct`'s
  analyser-gated lab ordering sits next to (and does not replace) generic lab ordering.
  `app/(routes)/api/imaging/order/route.ts`, `lib/fhir/imaging-service.ts`'s existing functions,
  `components/imaging/imaging-order-form.tsx` and the standalone `/pacs` worklist are all reused
  as-is for anything that is *not* the new POCT-X-ray flow.
- **FHIR shape to reuse**: imaging orders are already `ServiceRequest`s carrying
  `identifier: [{ system: 'clinic', value: <clinicId> }]` (`lib/fhir/imaging-service.ts` ~line
  111) — the exact pattern `lib/fhir/clinic-tenancy.ts`'s `getClinicIdentifierValue()` and
  `lib/fhir/poct-device.ts`'s `deviceForClinic()` already read for labs. Results are
  `DiagnosticReport`s with `category` RAD (`lib/fhir/imaging-service.ts` `createImagingReport`).
  `ImagingStudy` already models DICOM-ish study/series/instance metadata
  (`lib/fhir/imaging-constants.ts`).
- **Device ingestion endpoint already exists**: `POST /api/imaging/receive` (device-key via
  `verifyDeviceApiKey(..., 'PACS_API_KEY')`) already accepts study metadata JSON shaped like
  `ImagingStudyData` and calls `receiveImagingStudy`. It is currently **unrestricted** to any
  `ServiceRequest` (no POCT-style tag check, no module-toggle check) — same starting state
  `/api/labs/receive` was in before Task 9/10 hardened it for the analyser-tagged case. Task 12
  adds a *new*, tag-restricted, module-gated variant next to it (see §4), it does not retrofit
  this existing open route (which the broader referral-imaging flow may still rely on).

## 3. Two real, concrete gaps found while researching (fix as part of this task, don't rediscover them)

These were only found by reading the actual merged code, not from any doc:

1. **`POST /api/labs/subscription` (Lab tab live updates, Task 11) hard-codes the `poct` module
   check**: `if (!(await isModuleEnabledForClinic('poct', clinicId))) throw new ForbiddenError(...)`.
   Its `criteria` is `DiagnosticReport?subject=Patient/<id>&identifier=clinic|<id>[&encounter=...]`
   — generic by *resource type*, not lab-specific. If X-ray results are delivered as
   `DiagnosticReport`s the same way (which they already are for imaging, see above), the Lab tab's
   live-update channel will refuse to open for a clinic that has `pacs` on but `poct` off, and (per
   point 2 below) wouldn't match imaging reports even if it did open. Needs a decision: either
   generalize this one subscription to accept "poct OR pacs enabled" and widen `criteria`
   appropriately, or add a second, pacs-scoped subscription endpoint/criteria next to it.
2. **Imaging `DiagnosticReport`s don't carry the `identifier: clinic|<id>` the subscription
   filters on.** `createImagingReport` (`lib/fhir/imaging-service.ts` ~line 294) sets
   `subject`/`encounter`/`category`/`conclusion`/etc. but clinic scoping is done via
   `assignResourceToAccountReferences` (Medplum `meta.account`), a *different* mechanism than the
   plain `identifier` array `lab-service.ts` uses for its `DiagnosticReport`s. The existing
   `/api/labs/subscription` criteria (`identifier=clinic|<id>`) would silently never match an
   imaging report even after fixing point 1. Fix: either add the same `identifier: clinic|<id>` to
   the X-ray `DiagnosticReport` this task creates (consistent with how its own `ServiceRequest`
   already carries it), or change the subscription criteria to filter by `encounter`/`subject`
   only (it already does, as an `&`) and rely on the existing per-patient read-auth check instead
   of the identifier for this narrower case.

## 4. New things Task 12 builds

Modeled 1:1 on the already-shipped POCT lab pattern (file-for-file analogue), reusing the
`pacs` module id instead of introducing a new one.

| Lab/POCT (already built) | X-ray/POCT equivalent (new) |
|---|---|
| `lib/fhir/poct-device.ts` (`deviceForClinic`, `listPoctAnalysers`, `requireOnlineAnalyser`, heartbeat ≤90s = online) | `lib/fhir/xray-device.ts` — same shape, own `POCT_TYPE_SYSTEM`-equivalent URLs scoped to X-ray (e.g. `https://ucc.emr/xray/device-type`), reusing the identical `clinic|<id>` identifier + heartbeat-property pattern. Kept as a sibling file, not a shared abstraction — matches this codebase's existing convention of parallel, non-shared `lab-service.ts`/`imaging-service.ts`, `lab-constants.ts`/`imaging-constants.ts`. |
| `app/api/poct/analysers/route.ts` (`GET`, 404 when `poct` off) | `app/api/pacs/devices/route.ts` (`GET`, 404 when `pacs` off, lists online X-ray devices for the clinic) |
| `lib/fhir/lab-constants.ts` `POCT_TESTS` (code/name/unit/analyserType/unitPrice) | New `XRAY_STUDIES` catalog (e.g. Chest PA, Chest lateral, limb views) with LOINC/CPT code, unit price, `deviceType: 'xray'` — reuses `lib/fhir/imaging-constants.ts`'s existing `IMAGING_PROCEDURES` codes where they already match (e.g. `36643-5` Chest X-ray) rather than inventing new codes |
| `lib/treatment-plan.ts` `PoctEntryMeta` (`kind: "poct"`) | New `XrayEntryMeta` (`kind: "xray"`, code/deviceId/deviceName) |
| `components/orders/poct-section.tsx` (`PoctSection`) | New `components/orders/xray-section.tsx` (`XraySection`) — identical structure: poll `/api/pacs/devices` every 15s, recheck at add-time, disable "+ Add" when offline, copy text "Only online, connected devices can be ordered. No manual results." |
| `order-composer.tsx` `poctEnabled` prop + `<PoctSection/>` | `order-composer.tsx` gets a parallel `pacsEnabled` prop + `<XraySection/>`, resolved the same way (`isModuleEnabledForClinic("pacs", clinicId)` server-side in `app/(routes)/patients/[id]/page.tsx`, threaded through `PatientProfileWorkspace` → `OrderComposer`) |
| `createLabOrder`'s `order.poct` branch (`requireOnlineAnalyser` + 403 `ForbiddenError`) | New `order.xray` branch in `createImagingOrder` (or a sibling `createXrayOrder`): `requireOnlineXrayDevice`, tag the `ServiceRequest` with an `xray`-equivalent of `POCT_TAG_SYSTEM`, throw `ForbiddenError` when `pacs` disabled |
| `updateLabOrder`/`deleteLabOrder`'s POCT-tag-conditional `isModuleEnabledForClinic` check (PR #226 fix, learned the hard way) | **Build this in from day one** for the X-ray-tagged branch of `updateImagingOrder`/`deleteImagingOrder` — don't ship it ungated and need a follow-up PR like labs did |
| `handleTreatmentSign`'s `poctEntries` branch (block if `!poctEnabled`, `POST /api/labs/order` with `poct: {...}`, no completed Procedure) | Parallel `xrayEntries` branch: block if `!pacsEnabled`, `POST /api/imaging/order` with a new `xray: { code, deviceId, entryId }` field, excluded from the completed-Procedure path the same way `poctEntries`/`labEntries` already are |
| `lib/poct/hl7.ts` + `lib/poct/astm.ts` (hand-written ORU^R01/ASTM encode-decode, round-trip unit tested) | New minimal, hand-written **DICOM-shaped study-metadata message** — *not* real binary DICOM (no new npm dependency, same precedent as labs: "hand-written minimal encode/decode... scoped to a simulated analyser, not any real vendor's profile"). This is really just the existing `ImagingStudyData` JSON shape (`lib/fhir/imaging-constants.ts`) that `/api/imaging/receive` already accepts — reused as the message payload, not reinvented. |
| `lib/poct/analyser-bot.ts` (`ingestAnalyserMessage`, Bot-handler shape, only acts on `poct`-tagged `ServiceRequest`s, idempotent on `completed`, module-toggle-gated **from Task 10's own fix forward**) | New `lib/pacs/xray-device-bot.ts` (`ingestXrayStudy`), same Bot-handler shape, only acts on the new X-ray tag, same idempotent-on-`completed` guard (learned from Task 10's MINOR finding — build the duplicate-message guard in immediately, don't ship without it), and **gated by `isModuleEnabledForClinic('pacs', clinicId)` from day one** (the MAJOR finding Task 10 had to fix after the fact for labs — don't repeat that mistake here) |
| `app/(routes)/api/labs/receive/message/route.ts` (device-key auth, Bot-shaped bridge entry point) | New `app/(routes)/api/imaging/receive/message/route.ts`, same device-key contract (reuse `PACS_API_KEY`, already defined and used by the existing `/api/imaging/receive`), calling `ingestXrayStudy` |
| `scripts/poct/sim-analyser.ts` (`device`/`heartbeat`/`send-result` CLI, simulated-clinic allowlist, `production` guard) | New `scripts/pacs/sim-xray.ts`: `device <clinicId>` / `heartbeat <deviceId> [--offline]` / `send-study <serviceRequestId> --study-uid ... --modality DX ...`, same `demo`/`clinicb`/`clinicc`/`clinicd`-only + non-production guard |
| `components/labs/lab-results-view.tsx` "Pending POCT Tests" card (`getPatientPendingPoctOrders`) | New "Pending X-ray" card in the same Labs & Imaging tab (or a small addition to `components/imaging/imaging-results-view.tsx`, whichever the Lab tab actually renders for imaging — confirm at build time) backed by a new `getPatientPendingXrayOrders` in `lib/fhir/imaging-service.ts`, same `_count` override lesson from Task 10 (explicit page size, don't rely on Medplum's default 20) |
| `lib/poct/live-results.ts` (`startLabResultUpdates`, WebSocket + 30s poll fallback) | Reuse this file's logic if §3's subscription gap is fixed by widening the existing endpoint/criteria to cover `pacs`; otherwise a small parallel `startXrayResultUpdates`. Prefer the widen-in-place fix — avoids a second WebSocket/poll loop per Lab tab render. |

## 5. Data model (FHIR)

| Thing | Resource |
|---|---|
| X-ray device | `Device`: `identifier: [{system:'clinic', value:<clinicId>}]`, `type.coding` on a new `xray/device-type` system (e.g. `chest-dx`), `status active/inactive`, `property` last-heartbeat, `meta.tag` `simulated` for fake devices (same non-production + fixed-clinic allowlist as POCT) |
| Order | `ServiceRequest`: `status active`, `category` Imaging (SNOMED `363679005`, already used), new tag for "ordered via the online-device X-ray flow" (distinguishes from generic/referral imaging the same way `POCT_TAG_SYSTEM` distinguishes POCT from generic lab), `identifier clinic|<id>`, `performer: Device/<id>` |
| Result | `ImagingStudy` (already modeled) + `DiagnosticReport` (RAD category, already modeled) — **add** `identifier: clinic|<id>` to the `DiagnosticReport` per §3 point 2 |
| Done | Device bridge sets `ServiceRequest.status = completed` once the study (and, if applicable, a report) is recorded — no completed `Procedure`, same as POCT lab |
| Bill | Unchanged — same composer bill-line mechanism Task 9 already built for POCT (Encounter `investigation-billing` extension), reused as-is |

## 6. Open questions (need a decision before/while building, same style as the original POCT canvas doc)

1. Confirm §1's scope reading (A) vs (B) with whoever owns the requirement — this plan assumes (A).
2. Does an X-ray *report* (radiologist findings/impression) exist for this device-gated flow, or is
   the study image itself (with a flag like "abnormal"/"needs review" if the device/vendor provides
   one) the only output, same as a POCT lab result has no separate "report" step beyond the
   `DiagnosticReport`? Existing `POST /api/imaging/report` is a manually-typed findings/impression
   entry point with only an API-key check (no module gate, no tag restriction) — decide whether the
   new X-ray flow uses it as-is (a human radiologist still reads the image, just the image capture
   itself is device-only/no-manual-entry) or bypasses it entirely. Recommend: keep it as-is and
   unchanged, since "no manual result entry" in `AGENTS.md` is written for POCT's structured
   analyte *values*, not for radiology interpretation text, and this endpoint pre-exists Task 12.
3. Which X-ray studies count as "POCT" for v1 — likely just Chest PA (and maybe Chest PA+lateral,
   limb views) rather than the full `IMAGING_PROCEDURES` catalog; confirm the short list before
   seeding `XRAY_STUDIES`.
4. §3's subscription fix approach (widen existing endpoint vs. new parallel one) — recommend
   widening, flag for review either way since it touches already-shipped, working Task 11 code.

## 7. Phased build order (mirrors how Tasks 9-11 shipped, each its own small PR)

1. **Catalog + Device**: `xray-device.ts`, `XRAY_STUDIES`, admin/e2e fixture for creating a
   simulated Device (no composer change yet; unit-test the online/offline heartbeat logic the same
   way `poct-device.ts`'s equivalent would be tested).
2. **Composer ordering**: `XraySection`, `pacsEnabled` threading, `order.xray` branch in
   `createImagingOrder`, `handleTreatmentSign` dispatch, PATCH/DELETE module-gated from the start
   (§4 table, don't defer this like labs did). e2e: offline device blocks ordering; online + Sign
   creates an active, un-completed `ServiceRequest`; generic imaging ordering (test 06/07's
   baseline) still works unchanged.
3. **Results path**: `getPatientPendingXrayOrders`, Lab-tab pending card, §3's subscription fix
   (or parallel endpoint), `/api/imaging/receive/message` + `xray-device-bot.ts` with the
   duplicate-message guard built in, `sim-xray.ts`. e2e: simulated device sends a study, Lab tab
   shows it without a reload; module toggle off blocks both ordering *and* ingestion/visibility of
   in-flight orders (apply Task 10's MAJOR-finding lesson here from the start, not as a follow-up).
4. **Full-suite gate** once per phase (`e2e/scripts/check-all.sh <label>`), baseline is whatever
   `ai-work`'s current gate shows (29/30 per `.ai/STATE.md`'s latest Task 10 entry) — do not
   regress; known pre-existing failures (inventory validation 500, the long-tracked "known-bug
   probes summary") are not this task's to fix.

## 8. Explicitly out of scope

- Any change to the existing broad `pacs` referral-imaging flow (CT/MRI/ultrasound, `/pacs/new`,
  generic catalog imaging ordering in the composer) — reading (A), see §1.
- Per-clinic device *keys* (shared `PACS_API_KEY`/`POCT_API_KEY` today can write into any clinic) —
  already a named `BACKLOG.md` item ("POCT phase 2 prerequisite: per-clinic device keys"), applies
  equally to X-ray, not solved by this task.
- Clinic AccessPolicy clinical isolation — separate named `BACKLOG.md` item, unrelated.
- Real binary DICOM (PS3.10 files, C-STORE, WADO-RS) — out of scope for a simulated/demo device,
  same reasoning Task 10 used for HL7/ASTM (hand-written minimal metadata only).

## Sources read for this plan (no guessing)

`origin/dev` tip (`01cf848`, includes merged PRs #223/#224/#226/#227/#228): `lib/module-settings.ts`,
`lib/fhir/poct-device.ts`, `app/api/poct/analysers/route.ts`, `components/orders/poct-section.tsx`,
`components/orders/order-composer.tsx`, `app/(routes)/patients/[id]/patient-profile-workspace.tsx`,
`lib/fhir/lab-constants.ts`, `lib/treatment-plan.ts`, `lib/poct/analyser-bot.ts`,
`scripts/poct/sim-analyser.ts`, `lib/poct/live-results.ts`, `components/labs/lab-results-view.tsx`,
`app/(routes)/api/labs/subscription/route.ts`, `.ai/progress-poct-toggle.md`,
`.ai/REVIEW-task10.md`, `e2e/tests/module-toggle.spec.ts`; plus the current `ai-work` tree for
`modules/pacs/*`, `lib/fhir/imaging-constants.ts`, `lib/fhir/imaging-service.ts`,
`components/imaging/*`, `app/(routes)/api/imaging/*`, `app/(routes)/pacs/*` (these are identical
between `ai-work` and `origin/dev` — imaging/PACS has had no code changes since before Task 9).
