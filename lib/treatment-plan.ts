export type TreatmentPlanTab = "items" | "services" | "packages" | "documents";

export interface TreatmentPlanEntryInput {
  id?: string;
  tab: TreatmentPlanTab;
  catalogRef?: string;
  name: string;
  quantity?: number;
  unitPrice?: number;
  instruction?: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  meta?: Record<string, string>;
}

export interface TreatmentPlanEntry {
  id: string;
  tab: TreatmentPlanTab;
  catalogRef?: string;
  name: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  instruction?: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  meta?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface TreatmentPlanSummary {
  subtotal: number;
  total: number;
  currency: string;
  itemCount: number;
}

export interface TreatmentPlanSnapshot {
  draftId: string;
  patientId: string;
  consultationId?: string;
  entries: TreatmentPlanEntry[];
  summary: TreatmentPlanSummary;
  updatedAt: string;
}

const CURRENCY = "MYR";

export function normalizeTreatmentPlanEntry(
  input: TreatmentPlanEntryInput,
  nowIso: string,
  existing?: TreatmentPlanEntry
): TreatmentPlanEntry {
  const name = (input.name || "").trim();
  if (!name) {
    throw new Error("Treatment plan entry name is required.");
  }

  const quantity = Number.isFinite(input.quantity as number)
    ? Math.max(0, Number(input.quantity))
    : Number(existing?.quantity ?? 1);
  const unitPrice = Number.isFinite(input.unitPrice as number)
    ? Math.max(0, Number(input.unitPrice))
    : Number(existing?.unitPrice ?? 0);
  const lineTotal = Number((quantity * unitPrice).toFixed(2));

  return {
    id: input.id || existing?.id || crypto.randomUUID(),
    tab: input.tab,
    catalogRef: input.catalogRef || existing?.catalogRef,
    name,
    quantity,
    unitPrice,
    lineTotal,
    instruction: input.instruction ?? existing?.instruction,
    dosage: input.dosage ?? existing?.dosage,
    frequency: input.frequency ?? existing?.frequency,
    duration: input.duration ?? existing?.duration,
    meta: input.meta ?? existing?.meta,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
  };
}

export function computeTreatmentPlanSummary(entries: TreatmentPlanEntry[]): TreatmentPlanSummary {
  const subtotal = Number(entries.reduce((sum, entry) => sum + entry.lineTotal, 0).toFixed(2));
  return {
    subtotal,
    total: subtotal,
    currency: CURRENCY,
    itemCount: entries.length,
  };
}

