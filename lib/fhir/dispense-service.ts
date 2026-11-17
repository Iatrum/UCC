import type { MedplumClient } from '@medplum/core';
import type {
  Bundle,
  BundleEntry,
  Extension,
  Invoice,
  Medication as FHIRMedication,
  MedicationDispense,
} from '@medplum/fhirtypes';
import { INVENTORY_EXTENSION_URL } from './structure-definitions';
import { CLINIC_IDENTIFIER_SYSTEM, resourceMatchesClinicTenant } from './clinic-tenancy';

/**
 * Auto-deduct inventory at checkout (Task 358, user decision 16 Nov).
 *
 * Model: one MedicationDispense per (consultation, inventory medication) plus the Medication stock
 * change. Medplum 5.2.8 ignores `ifMatch` inside Bundle entries (verified on the dev server) and does
 * not roll back a transaction on a failed conditional entry, so these are NOT one transaction. Instead:
 * claim the dispense (If-Match header / conditional create) with a pending delta -> If-Match PUT of the
 * Medication -> settle the dispense. The claim serializes reconcilers per visit/medication; a failed
 * stock write releases the claim; a crashed claim is taken over once stale. See
 * .ai/research/task402-checkout-consistency.md. Stock is a clinic-scoped Medication (inventory-service.ts).
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
export const STALE_CLAIM_MS = 30_000;
const WAIT_MS = 25;
const MAX_WAITS = 400;

export type DispenseLineInput = { name: string; type?: string; quantity: number };

export type CheckoutDispenseInput = {
  clinicId: string;
  consultationId: string;
  patientId: string;
  invoiceId?: string;
  /**
   * Version of the invoice this reconciliation was computed from. Every stock transaction
   * includes an If-Match on the invoice, so a request holding an obsolete invoice (or a
   * voided/deleted one) can never deduct; the newer writer owns reconciliation.
   */
  invoiceVersionId?: string;
  items: DispenseLineInput[];
};

export type CheckoutDispenseResult = {
  /** Medications whose stock changed in this run. */
  adjusted: Array<{ medicationId: string; name: string; delta: number; stockAfter: number }>;
  /** Item lines that matched no (or more than one) inventory medication; nothing deducted. */
  unmatched: string[];
  /** Medications whose stock is now below zero. */
  negativeStock: string[];
  /** Billed lines whose identity is ambiguous/unresolved and touch stock (ambiguous name, renamed item). */
  unresolved: string[];
  /** Earlier deductions kept untouched because an unresolved line may still bill them. */
  retained: string[];
  /** True when the invoice changed under this request; a newer request reconciles stock. */
  superseded?: boolean;
};

const emptyResult = (): CheckoutDispenseResult => ({ adjusted: [], unmatched: [], negativeStock: [], unresolved: [], retained: [] });

const PAGE_SIZE = 100;
const MAX_PAGES = 200;

/** Read every page of a search (searchResources returns one page; _count is only a page size). */
export async function searchAll<T>(medplum: MedplumClient, type: string, params: Record<string, string>): Promise<T[]> {
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = (await medplum.searchResources(type as any, {
      ...params,
      _count: String(PAGE_SIZE),
      _offset: String(page * PAGE_SIZE),
    })) as unknown as T[];
    all.push(...batch);
    if (batch.length < PAGE_SIZE) return all;
  }
  throw new Error(`Search for ${type} exceeded ${MAX_PAGES * PAGE_SIZE} results`);
}

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
  const hits = inventoryCandidates(name, catalog);
  return hits.length === 1 ? hits[0] : undefined;
}

export function inventoryCandidates(name: string, catalog: FHIRMedication[]): FHIRMedication[] {
  const target = normalizeName(name);
  if (!target) return [];
  return catalog.filter((med) => {
    const base = normalizeName(med.code?.text ?? '');
    if (!base) return false;
    if (base === target) return true;
    return strengthsOf(med).some((s) => normalizeName(`${base} ${s}`) === target);
  });
}

function dispenseKey(consultationId: string, medicationId: string): string {
  return `${consultationId}:${medicationId}`;
}

async function findDispenses(
  medplum: MedplumClient,
  clinicId: string,
  consultationId: string
): Promise<MedicationDispense[]> {
  const found = await searchAll<MedicationDispense>(medplum, 'MedicationDispense', {
    context: `Encounter/${consultationId}`,
    identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}`,
  });
  return found.filter(
    (d) =>
      resourceMatchesClinicTenant(d as any, clinicId) &&
      d.identifier?.some((i) => i.system === DISPENSE_IDENTIFIER_SYSTEM)
  );
}

export type DispenseAuditRecord = {
  id: string;
  status: string;
  medicationId: string;
  name: string;
  quantity: number;
  stockBefore?: number;
  stockAfter?: number;
};

/** Clinic-scoped audit view of what checkout deducted for one visit. */
export async function listDispensesForConsultation(
  medplum: MedplumClient,
  clinicId: string,
  consultationId: string
): Promise<DispenseAuditRecord[]> {
  const intExt = (d: MedicationDispense, url: string) => d.extension?.find((e) => e.url === url)?.valueInteger;
  return (await findDispenses(medplum, clinicId, consultationId)).map((d) => ({
    id: d.id ?? '',
    status: d.status,
    medicationId: medicationIdOf(d) ?? '',
    name: d.medicationReference?.display ?? '',
    quantity: Number(d.quantity?.value ?? 0),
    stockBefore: intExt(d, DISPENSE_STOCK_BEFORE_EXTENSION_URL),
    stockAfter: intExt(d, DISPENSE_STOCK_AFTER_EXTENSION_URL),
  }));
}

function recordedQuantity(dispense: MedicationDispense | undefined): number {
  if (!dispense || dispense.status !== 'completed') return 0;
  return Number(dispense.quantity?.value ?? 0) || 0;
}

function claimTime(d: MedicationDispense): number {
  const t = Date.parse(d.note?.[0]?.time ?? '');
  return Number.isFinite(t) ? t : 0;
}

function hasPending(d: MedicationDispense): boolean {
  return (intExt(d, PENDING_EXTENSION_URL) ?? 0) !== 0;
}

function medicationIdOf(dispense: MedicationDispense): string | undefined {
  return dispense.medicationReference?.reference?.replace(/^Medication\//, '');
}

function versionMatch(resource: { meta?: { versionId?: string } }): string | undefined {
  return resource.meta?.versionId ? `W/"${resource.meta.versionId}"` : undefined;
}

/** Real optimistic lock. Medplum 5.2.8 ignores `ifMatch` inside Bundle entries (verified against the dev
 *  server), so every guarded write is a single-resource PUT carrying the If-Match HEADER instead. */
function ifMatchOptions(resource: { meta?: { versionId?: string } }) {
  const match = versionMatch(resource);
  return match ? { headers: { 'If-Match': match } } : undefined;
}

function isConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /412|precondition|version|conflict/i.test(message);
}

const PENDING_EXTENSION_URL = 'https://ucc.emr/dispense/stock-pending';
const TARGET_EXTENSION_URL = 'https://ucc.emr/dispense/target';
const CLAIM_EXTENSION_URL = 'https://ucc.emr/dispense/claim';

function intExt(resource: { extension?: Extension[] }, url: string): number | undefined {
  return resource.extension?.find((e) => e.url === url)?.valueInteger;
}

/** The invoice if it is still at the version this request saved and still billable; otherwise null. */
async function currentInvoiceIfUnchanged(medplum: MedplumClient, ctx: CheckoutDispenseInput): Promise<Invoice | null> {
  try {
    const invoice = (await medplum.readResource('Invoice', ctx.invoiceId!)) as Invoice;
    if (invoice.meta?.versionId !== ctx.invoiceVersionId || invoice.status === 'cancelled') return null;
    return invoice;
  } catch {
    return null; // deleted
  }
}

/**
 * Second half of a deduction: apply a claimed (pending) stock delta to the Medication with a real
 * If-Match PUT (retry on conflict), then mark the dispense settled. Medication stock and the dispense
 * claim are separate resources and cannot be written atomically, so the claim (written first, under
 * If-Match on the dispense) is the serializer and `stock-pending` is the durable recovery marker: any
 * later checkout/void sees a pending dispense and finishes it before doing anything else.
 */
async function settleDispense(
  medplum: MedplumClient,
  clinicId: string,
  claimed: MedicationDispense
): Promise<{ stockAfter: number; name: string }> {
  const pending = intExt(claimed, PENDING_EXTENSION_URL) ?? 0;
  const target = intExt(claimed, TARGET_EXTENSION_URL) ?? 0;
  const medicationId = medicationIdOf(claimed)!;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const medication = (await medplum.readResource('Medication', medicationId)) as FHIRMedication;
    if (!isClinicInventory(medication, clinicId)) throw new Error('Inventory item unavailable for pending stock change');
    const before = readStock(medication);
    const after = before - pending;
    try {
      if (pending !== 0) await medplum.updateResource(withStock(medication, after), ifMatchOptions(medication));
    } catch (error) {
      if (attempt < MAX_ATTEMPTS - 1 && isConflict(error)) continue; // stock changed under us: re-read and retry
      throw error;
    }
    const settled: MedicationDispense = {
      ...claimed,
      status: target > 0 ? 'completed' : 'cancelled',
      whenHandedOver: target > 0 ? new Date().toISOString() : claimed.whenHandedOver,
      extension: [
        ...(claimed.extension ?? []).filter(
          (e) =>
            ![PENDING_EXTENSION_URL, TARGET_EXTENSION_URL, DISPENSE_STOCK_BEFORE_EXTENSION_URL, DISPENSE_STOCK_AFTER_EXTENSION_URL].includes(e.url)
        ),
        { url: DISPENSE_STOCK_BEFORE_EXTENSION_URL, valueInteger: before },
        { url: DISPENSE_STOCK_AFTER_EXTENSION_URL, valueInteger: after },
      ],
    };
    await medplum.updateResource(settled, ifMatchOptions(claimed));
    return { stockAfter: after, name: medication.code?.text ?? 'Medication' };
  }
  throw new Error('Stock update did not settle');
}

/** Undo a claim whose stock write failed. Only valid while the claim is still unsettled. */
async function releaseClaim(
  medplum: MedplumClient,
  claimed: MedicationDispense,
  previous: MedicationDispense | undefined
): Promise<void> {
  if (!claimed.id) return;
  if (previous?.id) await medplum.updateResource({ ...previous, meta: claimed.meta }, ifMatchOptions(claimed));
  else await medplum.deleteResource('MedicationDispense', claimed.id);
}

/** Apply the difference between the recorded deduction and `targetQty` for one medication. */
async function applyDelta(
  medplum: MedplumClient,
  ctx: CheckoutDispenseInput,
  medicationId: string,
  targetQty: number,
  action: 'checkout' | 'reverse'
): Promise<{ delta: number; stockAfter: number; name: string } | 'superseded' | null> {
  const guarded = action === 'checkout' && Boolean(ctx.invoiceId && ctx.invoiceVersionId);
  let waits = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS + 2; attempt += 1) {
    // 1. Read the dispense FIRST, then the invoice: a competing reconciler either changed the dispense
    //    after this read (our claim below fails its If-Match) or finished before it (invoice already moved on).
    const existing = (await findDispenses(medplum, ctx.clinicId, ctx.consultationId)).find(
      (d) => medicationIdOf(d) === medicationId
    );
    if (existing && hasPending(existing)) {
      // Another request is settling this claim. Only the claim owner settles, so stock is never applied
      // twice; wait for it, and take over (atomically, via If-Match) only if the claim is stale/abandoned.
      if (Date.now() - claimTime(existing) < STALE_CLAIM_MS) {
        waits += 1;
        if (waits > MAX_WAITS) throw new Error('Another checkout is still updating this stock item; retry');
        await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
        attempt -= 1; // waiting is bounded by MAX_WAITS, not by the conflict budget
        continue;
      }
      try {
        const now = new Date().toISOString();
        const taken = await medplum.updateResource(
          { ...existing, note: [{ time: now, text: 'Recovered interrupted stock change.' }] },
          ifMatchOptions(existing)
        );
        await settleDispense(medplum, ctx.clinicId, taken);
      } catch (error) {
        if (!isConflict(error)) throw error;
      }
      continue;
    }
    if (guarded && !(await currentInvoiceIfUnchanged(medplum, ctx))) return 'superseded';

    const medication = (await medplum.readResource('Medication', medicationId)) as FHIRMedication;
    if (!isClinicInventory(medication, ctx.clinicId)) return null;
    const delta = targetQty - recordedQuantity(existing);
    if (delta === 0) return null;

    const name = medication.code?.text ?? 'Medication';
    const now = new Date().toISOString();
    const token = `${now}:${Math.random().toString(36).slice(2)}`;
    const key = dispenseKey(ctx.consultationId, medicationId);
    const claim: MedicationDispense = {
      ...(existing ?? {}),
      resourceType: 'MedicationDispense',
      // Same clinic tenant (Account) as the stock item it draws from.
      meta: medication.meta?.accounts ? ({ accounts: medication.meta.accounts } as any) : undefined,
      status: 'in-progress',
      identifier: [
        { system: DISPENSE_IDENTIFIER_SYSTEM, value: key },
        { system: CLINIC_IDENTIFIER_SYSTEM, value: ctx.clinicId },
      ],
      medicationReference: { reference: `Medication/${medicationId}`, display: name },
      subject: { reference: `Patient/${ctx.patientId}` },
      context: { reference: `Encounter/${ctx.consultationId}` },
      quantity: { value: targetQty > 0 ? targetQty : (existing?.quantity?.value ?? 0), unit: 'units' },
      extension: [
        ...(ctx.invoiceId
          ? [{ url: DISPENSE_INVOICE_EXTENSION_URL, valueReference: { reference: `Invoice/${ctx.invoiceId}` } }]
          : []),
        { url: PENDING_EXTENSION_URL, valueInteger: delta },
        { url: TARGET_EXTENSION_URL, valueInteger: targetQty },
        { url: CLAIM_EXTENSION_URL, valueString: token },
      ],
      note: [{ time: now, text: action === 'reverse' ? 'Reversed: checkout voided.' : 'Auto-deducted at checkout.' }],
    };

    let claimed: MedicationDispense;
    try {
      if (existing?.id) {
        claimed = await medplum.updateResource(claim, ifMatchOptions(existing));
      } else {
        claimed = await medplum.createResourceIfNoneExist(
          claim,
          `identifier=${DISPENSE_IDENTIFIER_SYSTEM}|${key}`
        );
        const winner = claimed.extension?.find((e) => e.url === CLAIM_EXTENSION_URL)?.valueString;
        if (winner !== token) continue; // someone else created it first: re-read and recompute the delta
      }
    } catch (error) {
      if (isConflict(error)) continue;
      throw error;
    }
    try {
      const settled = await settleDispense(medplum, ctx.clinicId, claimed);
      return { delta, stockAfter: settled.stockAfter, name: settled.name };
    } catch (error) {
      // Stock was not changed: release the claim so the next attempt is not blocked by a pending marker.
      // (If this also fails, the claim is taken over once stale.)
      await releaseClaim(medplum, claimed, existing).catch(() => undefined);
      throw error;
    }
  }
  throw new Error('Stock reconciliation kept conflicting with another checkout; retry');
}

/**
 * Reconcile stock with the medication lines of a checked-out visit.
 * Safe to call any number of times with the same items.
 *
 * A previous deduction is only returned to stock when its medication is positively no longer
 * billed. If any billed line is ambiguous or unresolved (duplicate catalog name, renamed item)
 * and could be that medication, the deduction is retained and the line reported in `unresolved`.
 */
export async function deductStockForCheckout(
  medplum: MedplumClient,
  input: CheckoutDispenseInput
): Promise<CheckoutDispenseResult> {
  const result = emptyResult();
  const catalog = (
    await searchAll<FHIRMedication>(medplum, 'Medication', {
      identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${input.clinicId}`,
    })
  ).filter((m) => isClinicInventory(m, input.clinicId));
  const earlier = await findDispenses(medplum, input.clinicId, input.consultationId);

  const demand = new Map<string, number>();
  const unresolvedLines: Array<{ name: string; candidateIds: Set<string> }> = [];
  for (const line of input.items) {
    if (line.type && line.type !== 'Item') continue;
    const units = dispensedUnits(Number(line.quantity));
    if (units === 0) continue;
    const hits = inventoryCandidates(line.name, catalog);
    if (hits.length === 1 && hits[0].id) {
      demand.set(hits[0].id, (demand.get(hits[0].id) ?? 0) + units);
      continue;
    }
    result.unmatched.push(line.name);
    unresolvedLines.push({ name: line.name, candidateIds: new Set(hits.map((h) => h.id ?? '')) });
    if (hits.length > 1) result.unresolved.push(line.name);
  }

  // Earlier deductions no longer billed are returned to stock, unless an unresolved line may bill them.
  for (const d of earlier) {
    const id = medicationIdOf(d);
    if (!id || (recordedQuantity(d) <= 0 && !hasPending(d)) || demand.has(id)) continue;
    const shown = normalizeName(d.medicationReference?.display ?? '');
    const maybeStillBilled = unresolvedLines.find(
      (u) =>
        u.candidateIds.has(id) ||
        (shown !== '' && (normalizeName(u.name) === shown || normalizeName(u.name).startsWith(`${shown} `)))
    );
    if (maybeStillBilled) {
      result.retained.push(d.medicationReference?.display ?? id);
      if (!result.unresolved.includes(maybeStillBilled.name)) result.unresolved.push(maybeStillBilled.name);
      continue;
    }
    demand.set(id, 0);
  }

  for (const [medicationId, qty] of demand) {
    const applied = await applyDelta(medplum, input, medicationId, qty, 'checkout');
    if (applied === 'superseded') {
      result.superseded = true;
      break;
    }
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
  const result = emptyResult();
  const dispenses = await findDispenses(medplum, input.clinicId, input.consultationId);
  for (const d of dispenses) {
    const id = medicationIdOf(d);
    if (!id || (recordedQuantity(d) === 0 && !hasPending(d))) continue;
    const patientId = input.patientId ?? d.subject?.reference?.replace(/^Patient\//, '') ?? '';
    const applied = await applyDelta(medplum, { ...input, patientId, items: [] }, id, 0, 'reverse');
    if (applied && applied !== 'superseded') result.adjusted.push({ medicationId: id, name: applied.name, delta: applied.delta, stockAfter: applied.stockAfter });
  }
  return result;
}
