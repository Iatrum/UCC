import type { Prescription } from "@/lib/models";

function cleanPrescriptionFragment(value?: string): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const withoutLeadingFor = normalized.replace(/^(?:for\s+)+/i, "").trim();
  if (!withoutLeadingFor || withoutLeadingFor.toLowerCase() === "for") return "";

  return withoutLeadingFor;
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
