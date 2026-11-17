# Task 408 — MC and referral letter documents

## Audit of existing code (do not rebuild)
- MC / referral already exist inside the consultation composer "Documents" tab (`components/orders/order-composer.tsx`).
  Persisted as `Procedure` (category `documents`) under the visit `Encounter`, `note[0].text` = JSON blob
  (`kind: mc|referral`), clinic identifier via `withClinicIdentifiers` (`lib/fhir/consultation-service.ts`).
  Printing: HTML templates (`lib/document-templates.ts`, editable in Settings → Documents) rendered from the patient
  Documents list (`app/(routes)/patients/[id]/referral-mc-section.tsx`, `window.open` + `print()`).
- Legacy standalone `ServiceRequest` referral API (`/api/referrals`) is kept untouched.
- Follows the same storage pattern as Time Chit (`.ai/PLAN-time-chit.md`); no DocumentReference/Composition introduced
  because the Procedure+JSON pattern is what the billing/documents list already reads.

## Gaps found and fixed
| Gap | Fix |
| --- | --- |
| MC always printed the diagnosis | Hidden by default; explicit "Show diagnosis" tick (`mcIncludeDiagnosis`). Legacy custom templates with a hard-coded `Diagnosis: {{diagnosis}}` line are stripped when hidden. |
| No MMC number anywhere | `mcDoctorMmc` / `referralDoctorMmc` fields, `{{mmcLine}}` placeholder in default templates. Never invented; empty prints nothing. Last-used doctor name/MMC remembered in browser localStorage (not clinic data) for 1-click reuse. |
| Referral signature used the clinic name as "doctor" | Doctor name + MMC fields; falls back to clinic name only if blank. |
| Referral had no meds / allergies | Default letter body now lists patient current medications and allergies ("None recorded" is explicit). Source: `patient.medicalHistory`. |
| Template values were unescaped | `fillDocumentTemplate` HTML-escapes everything except explicitly raw keys. Referral body in the Documents list now keeps line breaks. |
| No print from composer | "Print MC" / "Print referral letter" buttons in the composer dialog. |
| No per-document audit | `Provenance` (CREATE/UPDATE) targeting each MC/referral `Procedure`, non-blocking, clinic account stamped (`meta.accounts` on the Procedure too). |

## Not done / follow-ups
- Practitioner MMC is not prefilled from the `Practitioner` resource (`/api/practitioners` does not return it).
- Procedures are replaced (delete+create) on consultation update, so a document gets a fresh Provenance per save.

## Task 414 follow-ups (review 409)
- Diagnosis hiding: replaced the single-shape regex with `stripDiagnosisFromTemplate` (`lib/template-diagnosis.ts`): tokenises the
  template, builds a light element tree and drops the smallest self-contained element (p/li/tr/td/short div) holding
  `{{diagnosis}}` plus a separate "Diagnosis:" label sibling; never deletes a large container. Any miss is blanked in place.
  Defence in depth: when hidden the `diagnosis`/`diagnosisBlock` values are never substituted, so a template shape we do not
  recognise can leave at worst an empty label, never the diagnosis. No HTML parser dependency exists in the repo, so none was added
  (DOM parsing on the server/print path would also need jsdom). Tests: 11 template shapes in `clinical-documents.test.ts`.
- Provenance test: helper extracted to `lib/fhir/signed-document-audit.ts`; `tests/unit/signed-document-audit.test.ts` runs the real
  `createProvenance` with a fake client and asserts target, agent, onBehalfOf, CREATE/UPDATE, clinic account stamp, skip for non-MC
  notes, non-blocking failure, and that a cross-clinic account is refused.
- ESLint errors in `order-composer.tsx` (refs during render L606, `removeEntry` self-reference in its own retry closure L738/L833)
  left as-is: fixing them means restructuring the autosave/retry callbacks of the consultation composer, not trivially safe.

## References
- FHIR R4 Provenance https://hl7.org/fhir/R4/provenance.html ; Procedure https://hl7.org/fhir/R4/procedure.html
- Medplum Provenance/AccessPolicy: https://www.medplum.com/docs/access/access-policies
