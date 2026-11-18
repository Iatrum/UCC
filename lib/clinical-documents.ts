/**
 * Pure helpers shared by the composer and the patient Documents list for the
 * MC (medical certificate) and referral letter documents (Task 408).
 *
 * Documents are persisted as a `Procedure` (category "documents") whose note is
 * a JSON blob; these helpers only build template data / default text from it.
 */

import { stripDiagnosisFromTemplate } from "./template-diagnosis";

export type SignedDocumentKind = "mc" | "referral" | "time-chit";

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
  /** Medicines/items ordered in this consult (from the treatment plan). */
  orderedMedications?: string[];
  allergies?: string[];
}

const clean = (list?: string[]) => (list || []).map((s) => s.trim()).filter(Boolean);

/** Referral letter default text: visit summary + current meds + allergies. */
export function buildReferralBody(input: ReferralBodyInput): string {
  const meds = clean(input.medications);
  const allergies = clean(input.allergies);
  const ordered = clean(input.orderedMedications);
  const medLines = [
    ...meds.map((m) => `- ${m}`),
    ...ordered.map((m) => `- ${m} (ordered in this consult)`),
  ];
  const details = [
    input.clinicalSummary ? `Clinical summary:\n${input.clinicalSummary}` : null,
    input.diagnosis ? `Diagnosis:\n${input.diagnosis}` : null,
    input.notes ? `Additional notes:\n${input.notes}` : null,
    input.progressNote ? `Progress note:\n${input.progressNote}` : null,
    `Current medications:\n${medLines.length ? medLines.join("\n") : "Not documented (see attached prescription, if any)"}`,
    `Allergies:\n${allergies.length ? allergies.join(", ") : "Allergies not documented"}`,
  ].filter(Boolean) as string[];

  const hasVisit = Boolean(input.clinicalSummary || input.diagnosis || input.notes || input.progressNote);
  if (!hasVisit && !medLines.length && !allergies.length) {
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
    return kind === "mc" || kind === "referral" || kind === "time-chit" ? kind : null;
  } catch {
    return null;
  }
}

/**
 * Kind of a document Procedure: the JSON note wins; if the note cannot be parsed
 * fall back to the catalogue id / name (e.g. a direct `letter-time-chit` write).
 */
export function signedDocumentKind(proc: { notes?: string | null; procedureId?: string | null; name?: string | null }): SignedDocumentKind | null {
  const fromNote = isSignedDocumentNote(proc.notes);
  if (fromNote) return fromNote;
  const key = `${proc.procedureId || ""} ${proc.name || ""}`.toLowerCase();
  if (key.includes("letter-time-chit") || key.includes("time chit") || key.includes("time-chit")) return "time-chit";
  if (key.includes("letter-mc") || key.includes("medical certificate") || /\bmc\b/.test(key)) return "mc";
  if (key.includes("letter-referral") || key.includes("referral")) return "referral";
  return null;
}

export const SIGNED_DOCUMENT_STATUS_VOIDED = "voided";

function parseDetails(notes?: string | null): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(notes || "");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as object).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortKeys(x)]));
  return v;
}

/** `existing` with only the void markers added (status voided, voidedAt, optional voidReason). */
function isVoidTransition(existing: Record<string, unknown>, incoming: Record<string, unknown>): boolean {
  if (existing.status === SIGNED_DOCUMENT_STATUS_VOIDED) return false;
  if (incoming.status !== SIGNED_DOCUMENT_STATUS_VOIDED || typeof incoming.voidedAt !== "string" || !incoming.voidedAt) return false;
  const { status: _s, voidedAt: _a, voidReason: _r, ...rest } = incoming;
  const { status: _es, ...existingRest } = existing;
  return sameJson(rest, existingRest);
}

/**
 * A signed MC / Time Chit / referral is a legal record: a Procedure replacement
 * may keep it unchanged, add new documents (reissue), or flip an existing one to
 * `voided` (record retained). Any other edit or removal is refused (returns the
 * message); the caller turns that into a 409.
 */
export function signedDocumentMutationError(
  existing: Array<{ notes?: string | null }>,
  incoming: Array<{ notes?: string | null }>
): string | null {
  const remaining = incoming.map((p) => parseDetails(p.notes));
  for (const proc of existing) {
    const prev = parseDetails(proc.notes);
    if (!prev || !isSignedDocumentNote(proc.notes)) continue;
    let idx = remaining.findIndex((n) => n && sameJson(n, prev));
    if (idx < 0) idx = remaining.findIndex((n) => n && isVoidTransition(prev, n));
    if (idx < 0) return "Signed documents cannot be edited or deleted. Void the document and issue a new one.";
    remaining.splice(idx, 1);
  }
  return null;
}
