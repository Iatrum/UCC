/**
 * One renderer for MC, Time Chit and referral documents (Task 549).
 *
 * The composer preview, the patient Documents tab and the checkout preview/print
 * all call `renderDocumentHtml`, so they show the same letterhead, doctor + MMC
 * line, patient DOB, issue date and print layout. Pure and DOM-free (unit tested).
 */
import {
  escapeHtmlText, fillDocumentTemplate, mcDiagnosisBlock, mcDiagnosisVisible, mmcLine, SIGNED_DOCUMENT_STATUS_VOIDED,
} from "./clinical-documents";
import { formatClinicDate, hoursLabel, mcDaysLabel, mcEndDate, toClinicDate } from "./clinic-dates";
import { fillTimeChitTemplate } from "./time-chit";

export type DocumentKind = "mc" | "referral" | "time-chit";

export interface DocumentOrganization {
  name?: string | null;
  address?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
}
export interface DocumentPatient {
  fullName?: string | null;
  nric?: string | null;
  dateOfBirth?: Date | string | null;
}

/** Only render http(s) / data:image logos; anything else is dropped (never injected into HTML). */
export function clinicLogoHtml(url?: string | null): string {
  const value = (url || "").trim();
  if (!/^(https?:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(value)) return "";
  return `<img class="clinic-logo" src="${escapeHtmlText(value)}" alt="" />`;
}

export function calcAge(dob: Date | string | null | undefined, now: Date = new Date()): string {
  const iso = toClinicDate(dob);
  const today = toClinicDate(now);
  if (!iso || !today) return "";
  const [by, bm, bd] = iso.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age--;
  return age >= 0 ? String(age) : "";
}

export function multilineToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin: 0 0 12px; line-height: 1.65;">${escapeHtmlText(p.trim()).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

/**
 * Shared screen + print CSS, injected into every rendered document (default or
 * clinic-customised template): A4 page, margins, no forced 100vh (blank second
 * page), signature/stamp kept together, readable on a phone.
 */
export const DOCUMENT_PRINT_CSS = `
.clinic-logo { max-width: 72px; max-height: 72px; object-fit: contain; display: block; }
.letterhead-row { display: flex; align-items: flex-start; gap: 12px; }
.void-banner { border: 2px solid #b91c1c; color: #b91c1c; font-weight: bold; text-align: center; padding: 6px; margin-bottom: 12px; letter-spacing: 2px; }
@page { size: A4; margin: 14mm; }
@media print {
  html, body { height: auto !important; min-height: 0 !important; background: #fff !important; }
  body { display: block !important; padding: 0 !important; max-width: none !important; margin: 0 !important; }
  .content { flex: none !important; }
  .sig-block, .stamp-box, .letterhead, .patient-box { break-inside: avoid; page-break-inside: avoid; }
  .sig-block { break-before: avoid; }
}
@media screen and (max-width: 600px) {
  body { padding: 18px !important; }
  .patient-label { width: 96px !important; }
  .sig-block { flex-direction: column !important; align-items: flex-start !important; gap: 16px; }
}`;

export function withPrintCss(html: string): string {
  if (html.includes("data-ucc-print")) return html;
  const tag = `<style data-ucc-print>${DOCUMENT_PRINT_CSS}</style>`;
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${tag}</head>`) : `${tag}${html}`;
}

export interface RenderDocumentInput {
  kind: DocumentKind;
  template: string;
  /** Parsed document details (the JSON stored in the document Procedure note / draft meta). */
  details: Record<string, string | undefined>;
  patient: DocumentPatient | null | undefined;
  organization: DocumentOrganization | null | undefined;
  /** The issue date (consultation date). Never "today" when reprinting. */
  issuedDate: Date | string | null | undefined;
  /** For tests only. */
  now?: Date;
}

export function renderDocumentHtml(input: RenderDocumentInput): string {
  const { kind, details, patient, organization } = input;
  const now = input.now ?? new Date();
  const issued = formatClinicDate(input.issuedDate) || formatClinicDate(now);
  const common = {
    clinicName: organization?.name || "",
    clinicAddress: organization?.address || "",
    clinicPhone: organization?.phone || "",
    clinicLogo: clinicLogoHtml(organization?.logoUrl),
    patientName: patient?.fullName || "",
    patientNric: patient?.nric || "",
    patientDob: formatClinicDate(patient?.dateOfBirth),
    date: issued,
  };

  let out: string;
  if (kind === "time-chit") {
    const template = input.template.replaceAll("{{tcHours}} hour(s)", "{{tcHoursLabel}}");
    out = fillTimeChitTemplate(template, {
      ...common,
      tcDate: formatClinicDate(details.tcDate),
      tcTimeIn: details.tcTimeIn || "",
      tcTimeOut: details.tcTimeOut || "",
      tcHours: details.tcHours || "",
      tcHoursLabel: details.tcHours ? hoursLabel(details.tcHours) : "—",
      doctorName: details.tcDoctorName || "",
      mmcLine: mmcLine(details.tcDoctorMmc),
    }, ["clinicLogo", "mmcLine"]);
  } else if (kind === "mc") {
    const showDx = mcDiagnosisVisible(details);
    const days = Math.max(1, Number(details.mcDays || 1) || 1);
    const start = toClinicDate(details.mcStartDate) || toClinicDate(input.issuedDate) || toClinicDate(now) || "";
    const template = input.template.replaceAll("{{mcDays}} day(s)", "{{mcDaysLabel}}");
    out = fillDocumentTemplate(template, {
      ...common,
      mcDays: String(days),
      mcDaysLabel: mcDaysLabel(days),
      mcStartDate: formatClinicDate(start),
      mcEndDate: mcEndDate(start, days),
      diagnosis: showDx ? details.mcDiagnosis || "" : "",
      diagnosisBlock: mcDiagnosisBlock(details.mcDiagnosis, showDx),
      doctorName: details.mcDoctorName || "",
      mmcLine: mmcLine(details.mcDoctorMmc),
    }, { rawKeys: ["clinicLogo", "diagnosisBlock", "mmcLine"], hideMcDiagnosis: !showDx });
  } else {
    const doctor = details.referralDoctorName || details.mcDoctorName || "";
    out = fillDocumentTemplate(input.template, {
      ...common,
      patientAge: calcAge(patient?.dateOfBirth, now),
      referralTo: details.referralTo || "",
      referralFrom: doctor || details.referralFrom || organization?.name || "",
      referralBody: multilineToHtml(details.referralContent || details.instruction || ""),
      diagnosis: details.referralDiagnosis || "",
      doctorName: doctor,
      mmcLine: mmcLine(details.referralDoctorMmc),
    }, { rawKeys: ["clinicLogo", "referralBody", "mmcLine"] });
  }

  if (details.status === SIGNED_DOCUMENT_STATUS_VOIDED) {
    const when = details.voidedAt ? ` · ${escapeHtmlText(formatClinicDate(details.voidedAt))}` : "";
    out = out.replace(/<body[^>]*>/i, (m) => `${m}<div class="void-banner">VOID${when}</div>`);
  }
  return withPrintCss(out);
}
