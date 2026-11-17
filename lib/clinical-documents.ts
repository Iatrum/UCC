/**
 * Pure helpers shared by the composer and the patient Documents list for the
 * MC (medical certificate) and referral letter documents (Task 408).
 *
 * Documents are persisted as a `Procedure` (category "documents") whose note is
 * a JSON blob; these helpers only build template data / default text from it.
 */

import { stripDiagnosisFromTemplate } from "./template-diagnosis";

export type SignedDocumentKind = "mc" | "referral";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export function escapeHtmlText(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESC[c]);
}

/** "MMC No: 12345" line (empty when no number) — never invents a number. */
export function mmcLine(mmcNumber?: string | null): string {
  const value = (mmcNumber || "").trim();
  return value ? `MMC No: ${escapeHtmlText(value)}` : "";
}

/** Diagnosis is hidden on an MC unless the doctor explicitly opts in. */
export function mcDiagnosisVisible(details: { mcIncludeDiagnosis?: string | boolean | null }): boolean {
  return details.mcIncludeDiagnosis === true || details.mcIncludeDiagnosis === "true";
}

export function mcDiagnosisBlock(diagnosis: string | undefined | null, include: boolean): string {
  const value = (diagnosis || "").trim();
  return include && value ? `<p class="cert-para">Diagnosis: ${escapeHtmlText(value)}</p>` : "";
}

/**
 * Fill `{{key}}` placeholders. Values are HTML-escaped unless the key is listed
 * in `rawKeys`. When `hideMcDiagnosis` is set, the diagnosis element is removed
 * structurally (see `stripDiagnosisFromTemplate`) and the value is never filled.
 */
export function fillDocumentTemplate(
  html: string,
  data: Record<string, string>,
  opts: { rawKeys?: string[]; hideMcDiagnosis?: boolean } = {}
): string {
  const raw = new Set(opts.rawKeys ?? []);
  let out = html;
  let values = data;
  if (opts.hideMcDiagnosis) {
    out = stripDiagnosisFromTemplate(out);
    // Defence in depth: the value itself is never substituted when hidden.
    values = { ...data, diagnosis: "", diagnosisBlock: "" };
  }
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(raw.has(key) ? value : escapeHtmlText(value));
  }
  return out;
}

export interface ReferralBodyInput {
  patientName?: string | null;
  visitDate?: string | null;
  clinicalSummary?: string;
  diagnosis?: string;
  notes?: string;
  progressNote?: string;
  medications?: string[];
  allergies?: string[];
}

const clean = (list?: string[]) => (list || []).map((s) => s.trim()).filter(Boolean);

/** Referral letter default text: visit summary + current meds + allergies. */
export function buildReferralBody(input: ReferralBodyInput): string {
  const meds = clean(input.medications);
  const allergies = clean(input.allergies);
  const details = [
    input.clinicalSummary ? `Clinical summary:\n${input.clinicalSummary}` : null,
    input.diagnosis ? `Diagnosis:\n${input.diagnosis}` : null,
    input.notes ? `Additional notes:\n${input.notes}` : null,
    input.progressNote ? `Progress note:\n${input.progressNote}` : null,
    `Current medications:\n${meds.length ? meds.map((m) => `- ${m}`).join("\n") : "None recorded"}`,
    `Allergies:\n${allergies.length ? allergies.join(", ") : "No known drug allergies recorded"}`,
  ].filter(Boolean) as string[];

  const hasVisit = Boolean(input.clinicalSummary || input.diagnosis || input.notes || input.progressNote);
  if (!hasVisit && !meds.length && !allergies.length) {
    return "Please include any medical information you deem relevant for the referral";
  }
  const visit = input.visitDate ? ` during the consultation on ${input.visitDate}` : "";
  return [
    "Dear Doctor,",
    `Thank you for seeing ${input.patientName || "this patient"} for further assessment and management. The following details were recorded${visit}:`,
    ...details,
    "Kindly evaluate and advise on further management.",
    "Thank you.",
  ].join("\n\n");
}

/** Signature line: doctor name plus MMC number when known. */
export function signatureName(doctorName?: string | null, mmcNumber?: string | null): string {
  return [doctorName?.trim(), mmcNumber?.trim() ? `(MMC ${mmcNumber.trim()})` : ""].filter(Boolean).join(" ");
}

export function isSignedDocumentNote(notes?: string | null): SignedDocumentKind | null {
  if (!notes) return null;
  try {
    const kind = JSON.parse(notes)?.kind;
    return kind === "mc" || kind === "referral" ? kind : null;
  } catch {
    return null;
  }
}
