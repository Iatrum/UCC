import type { MedplumClient } from '@medplum/core';
import type {
  Bundle,
  BundleEntry,
  Extension,
  Medication as FHIRMedication,
  MedicationDispense,
} from '@medplum/fhirtypes';
import { INVENTORY_EXTENSION_URL } from './structure-definitions';
import { CLINIC_IDENTIFIER_SYSTEM, resourceMatchesClinicTenant } from './clinic-tenancy';

/**
 * Auto-deduct inventory at checkout (Task 358, user decision 16 Nov).
 *
 * Model: one MedicationDispense per (consultation, inventory medication), updated in the
 * same FHIR transaction as the Medication stock change, so the audit record and the stock
 * can never disagree. Stock is a clinic-scoped Medication (see inventory-service.ts).
 *
 * - Idempotent: the dispense records the quantity already deducted; a re-run only applies
 *   the difference (zero on retry / re-checkout with identical items).
 * - Never blocks checkout on low stock: stock may go negative; the inventory view flags it.
 * - Reversible: void/delete of the invoice cancels the dispenses and restores the stock.
 */

export const DISPENSE_IDENTIFIER_SYSTEM = 'https://ucc.emr/dispense/checkout';
export const DISPENSE_INVOICE_EXTENSION_URL = 'https://ucc.emr/dispense/invoice';
export const DISPENSE_STOCK_BEFORE_EXTENSION_URL = 'https://ucc.emr/dispense/stock-before';
export const DISPENSE_STOCK_AFTER_EXTENSION_URL = 'https://ucc.emr/dispense/stock-after';
const INVENTORY_IDENTIFIER_SYSTEM = 'https://ucc.emr/inventory/medication';
const INVENTORY_IDENTIFIER_VALUE = 'catalog-item';
const MAX_ATTEMPTS = 4;

export type DispenseLineInput = { name: string; type?: string; quantity: number };

export type CheckoutDispenseInput = {
  clinicId: string;
  consultationId: string;
  patientId: string;
  invoiceId?: string;
  items: DispenseLineInput[];
};

export type CheckoutDispenseResult = {
  /** Medications whose stock changed in this run. */
  adjusted: Array<{ medicationId: string; name: string; delta: number; stockAfter: number }>;
  /** Item lines that matched no (or more than one) inventory medication; nothing deducted. */
  unmatched: string[];
  /** Medications whose stock is now below zero. */
  negativeStock: string[];
};

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isClinicInventory(resource: FHIRMedication, clinicId: string): boolean {
  return (
    (resource.identifier ?? []).some(
      (i) => i.system === INVENTORY_IDENTIFIER_SYSTEM && i.value === INVENTORY_IDENTIFIER_VALUE
    ) && resourceMatchesClinicTenant(resource as any, clinicId)
  );
}

function strengthsOf(resource: FHIRMedication): string[] {
  const root = resource.extension?.find((e) => e.url === INVENTORY_EXTENSION_URL);
  return (root?.extension ?? []).filter((e) => e.url === 'strength' && e.valueString).map((e) => e.valueString!);
}

export function readStock(resource: FHIRMedication): number {
  const root = resource.extension?.find((e) => e.url === INVENTORY_EXTENSION_URL);
  const stock = root?.extension?.find((e) => e.url === 'stock');
  return Number(stock?.valueInteger ?? stock?.valueString ?? stock?.valueDecimal ?? 0) || 0;
}

/** Returns a copy of the Medication with only the stock sub-extension changed. */
export function withStock(resource: FHIRMedication, stock: number): FHIRMedication {
  const extension: Extension[] = (resource.extension ?? []).map((ext) => {
    if (ext.url !== INVENTORY_EXTENSION_URL) return ext;
    const children = (ext.extension ?? []).filter((c) => c.url !== 'stock');
    return { ...ext, extension: [...children, { url: 'stock', valueInteger: stock }] };
  });
  return { ...resource, extension };
}

/** Whole units to deduct for a billed quantity (stock is stored as an integer). */
export function dispensedUnits(quantity: number): number {
  return Number.isFinite(quantity) && quantity > 0 ? Math.ceil(quantity) : 0;
}

/**
 * Resolve an invoice line name ("Name" or "Name 500mg") to exactly one clinic inventory item.
 * Returns undefined when nothing or more than one item matches (never guess).
 */
export function matchInventoryItem(name: string, catalog: FHIRMedication[]): FHIRMedication | undefined {
  const target = normalizeName(name);
  if (!target) return undefined;
  const hits = catalog.filter((med) => {
    const base = normalizeName(med.code?.text ?? '');
    if (!base) return false;
    if (base === target) return true;
    return strengthsOf(med).some((s) => normalizeName(`${base} ${s}`) === target);
  });
  return hits.length === 1 ? hits[0] : undefined;
}

function dispenseKey(consultationId: string, medicationId: string): string {
  return `${consultationId}:${medicationId}`;
}

async function findDispenses(
  medplum: MedplumClient,
  clinicId: string,
  consultationId: string
): Promise<MedicationDispense[]> {
  const found = (await medplum.searchResources('MedicationDispense', {
    context: `Encounter/${consultationId}`,
    identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}`,
    _count: '200',
  })) as MedicationDispense[];
  return found.filter(
    (d) =>
      resourceMatchesClinicTenant(d as any, clinicId) &&
      d.identifier?.some((i) => i.system === DISPENSE_IDENTIFIER_SYSTEM)
  );
}

function recordedQuantity(dispense: MedicationDispense | undefined): number {
  if (!dispense || dispense.status !== 'completed') return 0;
  return Number(dispense.quantity?.value ?? 0) || 0;
}

function medicationIdOf(dispense: MedicationDispense): string | undefined {
  return dispense.medicationReference?.reference?.replace(/^Medication\//, '');
}

function versionMatch(resource: { meta?: { versionId?: string } }): string | undefined {
  return resource.meta?.versionId ? `W/"${resource.meta.versionId}"` : undefined;
}

function isConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /412|precondition|version|conflict/i.test(message);
}

/** Apply `delta` (positive = deduct) to one medication together with its dispense record. */
async function applyDelta(
  medplum: MedplumClient,
  ctx: CheckoutDispenseInput,
  medicationId: string,
  targetQty: number,
  action: 'checkout' | 'reverse'
): Promise<{ delta: number; stockAfter: number; name: string } | null> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const medication = (await medplum.readResource('Medication', medicationId)) as FHIRMedication;
    if (!isClinicInventory(medication, ctx.clinicId)) return null;

    const existing = (await findDispenses(medplum, ctx.clinicId, ctx.consultationId)).find(
      (d) => medicationIdOf(d) === medicationId
    );
    const delta = targetQty - recordedQuantity(existing);
    if (delta === 0) return null;

    const before = readStock(medication);
    const after = before - delta;
    const name = medication.code?.text ?? 'Medication';
    const now = new Date().toISOString();

    const dispense: MedicationDispense = {
      ...(existing ?? {}),
      resourceType: 'MedicationDispense',
      // Same clinic tenant (Account) as the stock item it draws from.
      meta: medication.meta?.accounts ? ({ accounts: medication.meta.accounts } as any) : undefined,
      status: targetQty > 0 ? 'completed' : 'cancelled',
      identifier: [
        { system: DISPENSE_IDENTIFIER_SYSTEM, value: dispenseKey(ctx.consultationId, medicationId) },
        { system: CLINIC_IDENTIFIER_SYSTEM, value: ctx.clinicId },
      ],
      medicationReference: { reference: `Medication/${medicationId}`, display: name },
      subject: { reference: `Patient/${ctx.patientId}` },
      context: { reference: `Encounter/${ctx.consultationId}` },
      quantity: { value: targetQty > 0 ? targetQty : (existing?.quantity?.value ?? 0), unit: 'units' },
      whenHandedOver: targetQty > 0 ? now : existing?.whenHandedOver,
      extension: [
        ...(ctx.invoiceId
          ? [{ url: DISPENSE_INVOICE_EXTENSION_URL, valueReference: { reference: `Invoice/${ctx.invoiceId}` } }]
          : []),
        { url: DISPENSE_STOCK_BEFORE_EXTENSION_URL, valueInteger: before },
        { url: DISPENSE_STOCK_AFTER_EXTENSION_URL, valueInteger: after },
      ],
      note: [{ time: now, text: action === 'reverse' ? 'Reversed: checkout voided.' : 'Auto-deducted at checkout.' }],
    };

    const entries: BundleEntry[] = [
      {
        request: {
          method: 'PUT',
          url: `Medication/${medicationId}`,
          ...(versionMatch(medication) ? { ifMatch: versionMatch(medication) } : {}),
        },
        resource: withStock(medication, after),
      },
      existing?.id
        ? { request: { method: 'PUT', url: `MedicationDispense/${existing.id}` }, resource: dispense }
        : { request: { method: 'POST', url: 'MedicationDispense' }, resource: dispense },
    ];

    try {
      await medplum.executeBatch({ resourceType: 'Bundle', type: 'transaction', entry: entries } as Bundle);
      return { delta, stockAfter: after, name };
    } catch (error) {
      if (attempt < MAX_ATTEMPTS - 1 && isConflict(error)) continue; // stock/dispense changed under us: re-read and retry
      throw error;
    }
  }
  return null;
}

/**
 * Reconcile stock with the medication lines of a checked-out visit.
 * Safe to call any number of times with the same items.
 */
export async function deductStockForCheckout(
  medplum: MedplumClient,
  input: CheckoutDispenseInput
): Promise<CheckoutDispenseResult> {
  const result: CheckoutDispenseResult = { adjusted: [], unmatched: [], negativeStock: [] };
  const catalog = ((await medplum.searchResources('Medication', {
    identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${input.clinicId}`,
    _count: '500',
  })) as FHIRMedication[]).filter((m) => isClinicInventory(m, input.clinicId));

  const demand = new Map<string, number>();
  for (const line of input.items) {
    if (line.type && line.type !== 'Item') continue;
    const units = dispensedUnits(Number(line.quantity));
    if (units === 0) continue;
    const med = matchInventoryItem(line.name, catalog);
    if (!med?.id) {
      result.unmatched.push(line.name);
      continue;
    }
    demand.set(med.id, (demand.get(med.id) ?? 0) + units);
  }

  // Medications dispensed on an earlier checkout of this visit but no longer billed are returned to stock.
  const earlier = await findDispenses(medplum, input.clinicId, input.consultationId);
  for (const d of earlier) {
    const id = medicationIdOf(d);
    if (id && recordedQuantity(d) > 0 && !demand.has(id)) demand.set(id, 0);
  }

  for (const [medicationId, qty] of demand) {
    const applied = await applyDelta(medplum, input, medicationId, qty, 'checkout');
    if (!applied) continue;
    result.adjusted.push({ medicationId, name: applied.name, delta: applied.delta, stockAfter: applied.stockAfter });
    if (applied.stockAfter < 0) result.negativeStock.push(applied.name);
  }
  return result;
}

/** Restore stock for every completed dispense of this visit (invoice voided/deleted). */
export async function reverseStockForCheckout(
  medplum: MedplumClient,
  input: Omit<CheckoutDispenseInput, 'items' | 'patientId'> & { patientId?: string }
): Promise<CheckoutDispenseResult> {
  const result: CheckoutDispenseResult = { adjusted: [], unmatched: [], negativeStock: [] };
  const dispenses = await findDispenses(medplum, input.clinicId, input.consultationId);
  for (const d of dispenses) {
    const id = medicationIdOf(d);
    if (!id || recordedQuantity(d) === 0) continue;
    const patientId = input.patientId ?? d.subject?.reference?.replace(/^Patient\//, '') ?? '';
    const applied = await applyDelta(medplum, { ...input, patientId, items: [] }, id, 0, 'reverse');
    if (applied) result.adjusted.push({ medicationId: id, name: applied.name, delta: applied.delta, stockAfter: applied.stockAfter });
  }
  return result;
}
