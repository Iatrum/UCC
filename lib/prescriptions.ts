import type { Prescription } from "@/lib/models";

function cleanPrescriptionFragment(value?: string): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const withoutLeadingFor = normalized.replace(/^(?:for\s+)+/i, "").trim();
  if (!withoutLeadingFor || withoutLeadingFor.toLowerCase() === "for") return "";

  return withoutLeadingFor;
}

function collapseDuplicateTrailingStrength(value: string): string {
  const parts = value.split(" ");
  if (parts.length < 2) return value;

  const last = parts[parts.length - 1];
  const previous = parts[parts.length - 2];
  const isStrength = /^\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|units?)$/i.test(last);

  if (!isStrength || last.toLowerCase() !== previous.toLowerCase()) {
    return value;
  }

  return parts.slice(0, -1).join(" ");
}

export function formatPrescriptionDetails(prescription: Prescription): string {
  return [
    prescription.medication?.strength,
    prescription.frequency,
    prescription.duration,
  ]
    .map(cleanPrescriptionFragment)
    .filter(Boolean)
    .join(" · ");
}

export function formatPrescriptionLine(prescription: Prescription): string {
  const name = prescription.medication?.name || "Medication";
  const details = formatPrescriptionDetails(prescription);
  return details ? `${name} — ${details}` : name;
}

export function formatMedicationNameWithStrength(name?: string, strength?: string): string {
  const medicationName = collapseDuplicateTrailingStrength((name || "").replace(/\s+/g, " ").trim());
  const medicationStrength = (strength || "").replace(/\s+/g, " ").trim();

  if (!medicationStrength) return medicationName || "Medication";
  if (!medicationName) return medicationStrength;

  const escapedStrength = medicationStrength.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const alreadyIncludesStrength = new RegExp(`(^|\\s)${escapedStrength}(\\s|$)`, "i").test(medicationName);

  return alreadyIncludesStrength ? medicationName : `${medicationName} ${medicationStrength}`;
}
