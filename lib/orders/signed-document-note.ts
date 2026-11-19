import type { TreatmentPlanEntry } from "@/lib/treatment-plan";

type DocumentCatalogItem = { id: string; name: string; meta?: Record<string, unknown> };

export function documentKind(item: DocumentCatalogItem): "mc" | "referral" | "time-chit" | null {
  if (item.meta?.kind === "time-chit" || item.id === "letter-time-chit") return "time-chit";
  if (item.meta?.kind === "mc" || item.id === "letter-mc") return "mc";
  if (item.meta?.kind === "referral" || item.id === "letter-referral") return "referral";
  return null;
}

export function buildSignedDocumentNote(entry: TreatmentPlanEntry): string | undefined {
  const kind = documentKind({ id: entry.catalogRef || "", name: entry.name, meta: entry.meta });
  if (!kind) return entry.instruction;

  return JSON.stringify({
    kind,
    status: entry.meta?.documentStatus || "completed",
    title: entry.name,
    instruction: entry.instruction || "",
    tcDate: entry.meta?.tcDate || "", tcTimeIn: entry.meta?.tcTimeIn || "",
    tcTimeOut: entry.meta?.tcTimeOut || "", tcHours: entry.meta?.tcHours || "", tcDoctorName: entry.meta?.tcDoctorName || "", tcDoctorMmc: entry.meta?.tcDoctorMmc || "",
    mcDays: entry.meta?.mcDays || "",
    mcDiagnosis: entry.meta?.mcDiagnosis || "",
    mcStartDate: entry.meta?.mcStartDate || "",
    mcDoctorName: entry.meta?.mcDoctorName || "",
    mcDoctorMmc: entry.meta?.mcDoctorMmc || "",
    mcIncludeDiagnosis: entry.meta?.mcIncludeDiagnosis || "",
    referralDoctorName: entry.meta?.referralDoctorName || "",
    referralDoctorMmc: entry.meta?.referralDoctorMmc || "",
    referralTo: entry.meta?.referralTo || "",
    referralDiagnosis: entry.meta?.referralDiagnosis || "",
    referralContent: entry.meta?.referralContent || "",
  });
}
