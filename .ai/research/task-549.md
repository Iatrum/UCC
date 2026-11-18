# Task 549 — MC / Time Chit / referral view + template issues

Sources: FHIR R4 Procedure (https://hl7.org/fhir/R4/procedure.html, `status` incl. entered-in-error), Medplum
5.2.8 search/update (https://www.medplum.com/docs), MDN `@page`/`break-inside`
(https://developer.mozilla.org/docs/Web/CSS/@page), MDN `Intl.DateTimeFormat` `timeZone`, MDN `HTMLIFrameElement`
+ `Window.print()`.

## Decisions
- One pure renderer `lib/document-render.ts#renderDocumentHtml` for all 3 surfaces; checkout no longer uses React-PDF.
- Dates: `lib/clinic-dates.ts` (Asia/Kuala_Lumpur = CLINIC_TIME_ZONE). `YYYY-MM-DD` handled as strings; one display
  format `dd MMM yyyy`. MC "Date Issued" = consultation date (doc.date), never today.
- Print: shared `DOCUMENT_PRINT_CSS` injected into every render (also clinic-customised templates): `@page A4`, no
  100vh, avoid break inside signature/stamp. `printHtml` = hidden iframe (no pop-up blocker, works on mobile).
- Signed docs (#10): server (`updateConsultationInMedplum`) refuses edit/delete of an existing signed document
  Procedure (409). Allowed: unchanged, new documents (reissue), or status -> `voided` + `voidedAt` (+`voidReason`)
  with every other field unchanged. Documents tab: Edit/Delete replaced by Void; voided docs render a VOID banner and
  cannot be printed. `POST /api/orders` dedupe key now includes note content for signed docs so a reissue is not dropped.
- Time Chit now in `isSignedDocumentNote` -> Provenance audit (same clinic account stamping as MC/referral).

## Not done / follow-ups
- Reprint still renders live from the current clinic template + org + patient fields (no frozen HTML snapshot).
  Issue date, signer, MMC and all document fields are frozen in the note; a full snapshot needs a storage decision.
- Existing clinic-saved templates keep their own markup: `{{clinicLogo}}` / `{{patientDob}}` / `{{mmcLine}}` appear only
  if staff add them (placeholders now listed in the editor). Print CSS applies regardless.
- `referral-letter-button.tsx` (legacy consult-page referral) still uses React-PDF `ReferralDocument`.
- No clinic-scoped running number on MC/Time Chit; overnight Time Chit still rejected by design.
- Overlap with PR #295/#300 (toggle removal): this PR does not touch `isModuleEnabledForClinic("time-chit")`,
  `timeChitEnabled` or `time-chit-guard.ts`; expect a trivial merge there.

## Verification
- `bun test tests/unit` (697 pass), `tsc --noEmit` clean.
- Fake-data render of default MC / Time Chit / referral through Playwright Chromium: each prints on exactly 1 A4 page,
  no horizontal overflow at 390px width.
- Full Playwright e2e (`check-all.sh`) NOT run in this task (shared 8 GB VPS, needs full build + seeded login);
  `e2e/tests/time-chit.spec.ts` was updated for the HTML checkout preview/iframe print but not executed.
