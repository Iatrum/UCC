import type { MedplumClient } from "@medplum/core";
import type { Extension, Invoice, InvoiceLineItem } from "@medplum/fhirtypes";
import { randomUUID } from "crypto";
import { updateQueueStatusForPatient } from "@/lib/fhir/triage-service";
import { createReviewFollowUpForCheckout } from "@/lib/fhir/communication-service";
import {
  CLINIC_IDENTIFIER_SYSTEM,
  assignResourceToClinicTenant,
  resolveClinicTenant,
  resourceMatchesClinicTenant,
  withClinicIdentifier,
} from "@/lib/fhir/clinic-tenancy";
import { assertPatientInClinic } from './write-containment';
import { NotFoundError } from '@/lib/server/route-helpers';
import {
  deductStockForCheckout,
  reverseStockForCheckout,
  type CheckoutDispenseResult,
} from "@/lib/fhir/dispense-service";

export type CheckoutPaymentMethod = "cash" | "card" | "qr" | "panel";

export type CheckoutInvoiceItem = {
  id: string;
  name: string;
  description?: string;
  type: "Item" | "Service" | "Package" | "Document";
  quantity: number;
  price: number;
};

export type CompleteCheckoutInput = {
  consultationId: string;
  patientId: string;
  clinicId: string;
  items: CheckoutInvoiceItem[];
  paymentMethod: CheckoutPaymentMethod;
  paidAmount: number;
  totalAmount: number;
  invoiceNumber?: string;
};

export type CompleteCheckoutResult = {
  invoice: Invoice;
  queueUpdateError?: string;
  /** Auto stock deduction outcome; `dispenseError` set when it failed (invoice is still saved). */
  stock?: CheckoutDispenseResult;
  dispenseError?: string;
};

const CURRENCY = "MYR";
const INVOICE_IDENTIFIER_SYSTEM = "https://ucc.emr/invoice/consultation";
const INVOICE_NUMBER_IDENTIFIER_SYSTEM = "https://ucc.emr/invoice/number";
const ENCOUNTER_EXTENSION_URL = "https://ucc.emr/invoice/encounter";
const CLINIC_EXTENSION_URL = "https://ucc.emr/invoice/clinic-id";
const PAYMENT_METHOD_EXTENSION_URL = "https://ucc.emr/invoice/payment-method";
const PAID_AMOUNT_EXTENSION_URL = "https://ucc.emr/invoice/paid-amount";
const BALANCE_EXTENSION_URL = "https://ucc.emr/invoice/balance";
const CHECKOUT_SOURCE_EXTENSION_URL = "https://ucc.emr/invoice/checkout-source";
const ITEM_TYPE_EXTENSION_URL = "https://ucc.emr/invoice/line-item-type";
const ITEM_QUANTITY_EXTENSION_URL = "https://ucc.emr/invoice/line-item-quantity";
const ITEM_SOURCE_ID_EXTENSION_URL = "https://ucc.emr/invoice/line-item-source-id";
const ITEM_DESCRIPTION_EXTENSION_URL = "https://ucc.emr/invoice/line-item-description";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getInvoiceNumber(invoice: Pick<Invoice, "identifier" | "id"> | null | undefined): string {
  return getStoredInvoiceNumber(invoice) || invoice?.id || "";
}

function getStoredInvoiceNumber(invoice: Pick<Invoice, "identifier"> | null | undefined): string {
  return invoice?.identifier?.find((identifier) => identifier.system === INVOICE_NUMBER_IDENTIFIER_SYSTEM)?.value || "";
}

function formatInvoiceNumber(date: Date): string {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const suffix = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase();
  return `INV-${yyyy}${mm}${dd}-${suffix}`;
}

function isValidInvoiceNumber(value: string): boolean {
  return /^[A-Z0-9/-]{1,50}$/.test(value);
}

async function isInvoiceNumberAvailable(
  medplum: MedplumClient,
  invoiceNumber: string,
  existingInvoiceId?: string
): Promise<boolean> {
  const existing = await medplum.searchResources("Invoice", {
    identifier: `${INVOICE_NUMBER_IDENTIFIER_SYSTEM}|${invoiceNumber}`,
    _count: "1",
  });
  return !existing?.some((invoice) => invoice.id !== existingInvoiceId);
}

export async function generateInvoiceNumber(medplum: MedplumClient, date = new Date()): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const invoiceNumber = formatInvoiceNumber(date);
    if (await isInvoiceNumberAvailable(medplum, invoiceNumber)) {
      return invoiceNumber;
    }
  }

  throw new Error("Failed to generate a unique invoice number");
}

function buildInvoiceIdentifiers(
  existing: Invoice | undefined,
  consultationId: string,
  invoiceNumber: string,
  clinicId: string
) {
  const preservedIdentifiers =
    existing?.identifier?.filter(
      (identifier) =>
        identifier.system !== INVOICE_IDENTIFIER_SYSTEM &&
        identifier.system !== INVOICE_NUMBER_IDENTIFIER_SYSTEM &&
        identifier.system !== CLINIC_IDENTIFIER_SYSTEM
    ) || [];

  return [
    ...preservedIdentifiers,
    {
      system: INVOICE_IDENTIFIER_SYSTEM,
      value: consultationId,
    },
    {
      system: INVOICE_NUMBER_IDENTIFIER_SYSTEM,
      value: invoiceNumber,
    },
    {
      system: CLINIC_IDENTIFIER_SYSTEM,
      value: clinicId,
    },
  ];
}

async function resolveInvoiceNumber(
  medplum: MedplumClient,
  existing: Invoice | undefined,
  proposedInvoiceNumber: string | undefined,
  date: Date
): Promise<string> {
  const storedInvoiceNumber = getStoredInvoiceNumber(existing);
  if (storedInvoiceNumber) return storedInvoiceNumber;

  const cleaned = cleanText(proposedInvoiceNumber).toUpperCase();
  if (
    cleaned &&
    isValidInvoiceNumber(cleaned) &&
    await isInvoiceNumberAvailable(medplum, cleaned, existing?.id)
  ) {
    return cleaned;
  }

  return generateInvoiceNumber(medplum, date);
}

function moneyExtension(url: string, value: number): Extension {
  return {
    url,
    valueMoney: {
      value: roundMoney(value),
      currency: CURRENCY,
    },
  };
}

async function invoiceBelongsToClinic(
  medplum: MedplumClient,
  invoice: Invoice | null | undefined,
  clinicId?: string
): Promise<boolean> {
  if (!clinicId) return true;
  if (!invoice) return false;
  return resourceMatchesClinicTenant(invoice as any, clinicId);
}

async function assertInvoiceBelongsToClinic(medplum: MedplumClient, invoice: Invoice, clinicId?: string): Promise<void> {
  if (!(await invoiceBelongsToClinic(medplum, invoice, clinicId))) {
    throw new NotFoundError('Invoice not found.');
  }
}

function buildLineItem(item: CheckoutInvoiceItem, index: number): InvoiceLineItem {
  const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 1;
  const unitPrice = Number.isFinite(item.price) && item.price >= 0 ? item.price : 0;
  const lineTotal = roundMoney(quantity * unitPrice);
  const name = cleanText(item.name) || "Checkout item";
  const description = cleanText(item.description);

  return {
    sequence: index + 1,
    chargeItemCodeableConcept: {
      text: name,
      coding: [
        {
          system: "https://ucc.emr/checkout-item-type",
          code: item.type.toLowerCase(),
          display: item.type,
        },
      ],
    },
    priceComponent: [
      {
        type: "base",
        amount: {
          value: lineTotal,
          currency: CURRENCY,
        },
      },
    ],
    extension: [
      { url: ITEM_TYPE_EXTENSION_URL, valueString: item.type },
      { url: ITEM_QUANTITY_EXTENSION_URL, valueDecimal: quantity },
      { url: ITEM_SOURCE_ID_EXTENSION_URL, valueString: cleanText(item.id) || `line-${index + 1}` },
      ...(description ? [{ url: ITEM_DESCRIPTION_EXTENSION_URL, valueString: description }] : []),
    ],
  };
}

function validateCheckoutInput(input: CompleteCheckoutInput): {
  normalizedItems: CheckoutInvoiceItem[];
  normalizedPaidAmount: number;
  normalizedTotalAmount: number;
} {
  if (!cleanText(input.consultationId) || !cleanText(input.patientId) || !cleanText(input.clinicId)) {
    throw new Error("consultationId, patientId, and clinicId are required");
  }

  if (!["cash", "card", "qr", "panel"].includes(input.paymentMethod)) {
    throw new Error("Invalid payment method");
  }

  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new Error("At least one invoice item is required");
  }

  const normalizedItems = input.items.map((item) => ({
    id: cleanText(item.id),
    name: cleanText(item.name),
    description: cleanText(item.description),
    type: item.type,
    quantity: Number(item.quantity),
    price: Number(item.price),
  }));

  if (
    normalizedItems.some(
      (item) =>
        !item.name ||
        !["Item", "Service", "Package", "Document"].includes(item.type) ||
        !Number.isFinite(item.quantity) ||
        item.quantity <= 0 ||
        !Number.isFinite(item.price) ||
        item.price < 0
    )
  ) {
    throw new Error("Invoice items must include valid name, type, quantity, and price");
  }

  const calculatedTotal = roundMoney(
    normalizedItems.reduce((sum, item) => sum + item.quantity * item.price, 0)
  );
  const normalizedTotalAmount = roundMoney(Number(input.totalAmount));
  const normalizedPaidAmount = roundMoney(Number(input.paidAmount));

  if (!Number.isFinite(normalizedTotalAmount) || normalizedTotalAmount < 0) {
    throw new Error("totalAmount must be a valid amount");
  }

  if (Math.abs(calculatedTotal - normalizedTotalAmount) > 0.01) {
    throw new Error("totalAmount does not match invoice items");
  }

  if (!Number.isFinite(normalizedPaidAmount) || normalizedPaidAmount < 0) {
    throw new Error("paidAmount must be a valid amount");
  }

  if (normalizedPaidAmount + 0.01 < normalizedTotalAmount) {
    throw new Error("Full payment is required before checkout completion");
  }

  return { normalizedItems, normalizedPaidAmount, normalizedTotalAmount };
}

function isVersionConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /412|precondition|version|conflict/i.test(message);
}

/** Billed content that stock deduction depends on. */
function billedContent(invoice: Invoice): string {
  return JSON.stringify([invoice.status, invoice.lineItem, invoice.totalGross?.value, invoice.totalNet?.value]);
}

/**
 * True when `current` is the invoice this request saved, or differs only by a metadata-only bump
 * (clinic account assignment): same billed content. A different version with different content means a
 * concurrent checkout/void saved in between.
 */
export function isOwnVersionOrClinicBump(saved: Invoice, current: Invoice): boolean {
  if (!current.meta?.versionId || current.meta.versionId === saved.meta?.versionId) return true;
  return billedContent(saved) === billedContent(current);
}

async function findExistingInvoice(
  medplum: MedplumClient,
  consultationId: string,
  clinicId?: string
): Promise<Invoice | undefined> {
  const matches = await medplum.searchResources("Invoice", {
    identifier: `${INVOICE_IDENTIFIER_SYSTEM}|${consultationId}`,
    _count: "1",
  });
  for (const invoice of matches ?? []) {
    if (await invoiceBelongsToClinic(medplum, invoice as Invoice, clinicId)) {
      return invoice as Invoice;
    }
  }
  return undefined;
}

export async function completeCheckoutInvoice(
  medplum: MedplumClient,
  input: CompleteCheckoutInput
): Promise<CompleteCheckoutResult> {
  const { normalizedItems, normalizedPaidAmount, normalizedTotalAmount } = validateCheckoutInput(input);
  const balance = roundMoney(Math.max(normalizedTotalAmount - normalizedPaidAmount, 0));
  const nowDate = new Date();
  const now = nowDate.toISOString();
  await assertPatientInClinic(medplum, input.clinicId, input.patientId, input.consultationId);
  const clinicTenant = await resolveClinicTenant(medplum, input.clinicId);
  let saved!: Invoice;
  for (let attempt = 0; ; attempt += 1) {
    const existing = await findExistingInvoice(medplum, input.consultationId, input.clinicId);
    const invoiceNumber = await resolveInvoiceNumber(medplum, existing, input.invoiceNumber, nowDate);

    const invoice: Invoice = {
      ...(existing ?? {}),
      resourceType: "Invoice",
      status: "balanced",
      identifier: buildInvoiceIdentifiers(existing, input.consultationId, invoiceNumber, input.clinicId),
      type: {
        text: "Clinic checkout invoice",
        coding: [
          {
            system: "https://ucc.emr/invoice-type",
            code: "clinic-checkout",
            display: "Clinic checkout",
          },
        ],
      },
      subject: {
        reference: `Patient/${input.patientId}`,
      },
      date: now,
      lineItem: normalizedItems.map(buildLineItem),
      totalNet: {
        value: normalizedTotalAmount,
        currency: CURRENCY,
      },
      totalGross: {
        value: normalizedTotalAmount,
        currency: CURRENCY,
      },
      totalPriceComponent: [
        {
          type: "base",
          amount: {
            value: normalizedTotalAmount,
            currency: CURRENCY,
          },
        },
      ],
      paymentTerms: `Paid by ${input.paymentMethod.toUpperCase()} at checkout`,
      extension: [
        { url: ENCOUNTER_EXTENSION_URL, valueReference: { reference: `Encounter/${input.consultationId}` } },
        { url: CLINIC_EXTENSION_URL, valueString: input.clinicId },
        { url: PAYMENT_METHOD_EXTENSION_URL, valueCode: input.paymentMethod },
        moneyExtension(PAID_AMOUNT_EXTENSION_URL, normalizedPaidAmount),
        moneyExtension(BALANCE_EXTENSION_URL, balance),
        { url: CHECKOUT_SOURCE_EXTENSION_URL, valueString: "orders-checkout" },
      ],
      note: [
        {
          time: now,
          text: "Checkout completed from UCC Billing & Documents.",
        },
      ],
    };

    try {
      if (existing?.id) {
        saved = await medplum.updateResource(withClinicIdentifier(invoice, input.clinicId), {
          // Optimistic lock: a concurrent checkout/void that changed the invoice makes this write fail.
          headers: existing.meta?.versionId ? { "If-Match": `W/"${existing.meta.versionId}"` } : undefined,
        });
      } else {
        // Idempotent per visit: conditional create (FHIR If-None-Exist) on consultation + clinic identifiers.
        // Two first-time checkouts for the same visit resolve to ONE invoice.
        saved = await medplum.createResourceIfNoneExist<Invoice>(
          withClinicIdentifier(invoice, input.clinicId),
          `identifier=${INVOICE_IDENTIFIER_SYSTEM}|${input.consultationId}&identifier=${CLINIC_IDENTIFIER_SYSTEM}|${input.clinicId}`
        );
        if (getStoredInvoiceNumber(saved) !== invoiceNumber || saved.date !== now) {
          // A competing checkout created the invoice first: adopt it and apply our data as a guarded update.
          if (attempt < 3) continue;
          throw new Error("Invoice was created concurrently; please retry checkout");
        }
      }
      break;
    } catch (err) {
      if (existing?.id && attempt < 3 && isVersionConflict(err)) continue; // re-read the newer invoice and re-apply
      throw err;
    }
  }
  await assignResourceToClinicTenant(medplum, "Invoice", saved, clinicTenant);
  // assignResourceToClinicTenant may write a new version (the clinic-assignment bump). Re-read, but only
  // accept a version we did not write if it is that bump (same billed content); otherwise another checkout
  // saved in between and must reconcile stock itself, so this request must not deduct outdated quantities.
  const finalInvoice = (await medplum.readResource("Invoice", saved.id as string).catch(() => saved)) as Invoice;
  const supersededByOther = !isOwnVersionOrClinicBump(saved, finalInvoice);

  // Auto-deduct inventory for the billed medication lines (idempotent; never blocks checkout).
  let stock: CheckoutDispenseResult | undefined;
  let dispenseError: string | undefined;
  try {
    if (supersededByOther) {
      stock = { adjusted: [], unmatched: [], negativeStock: [], unresolved: [], retained: [], superseded: true };
    } else stock = await deductStockForCheckout(medplum, {
      clinicId: input.clinicId,
      consultationId: input.consultationId,
      patientId: input.patientId,
      invoiceId: saved.id,
      invoiceVersionId: finalInvoice.meta?.versionId,
      items: normalizedItems,
    });
  } catch (err) {
    console.error("[billing-service] Invoice saved but stock deduction failed for consultation", input.consultationId, err);
    dispenseError = err instanceof Error ? err.message : "Stock deduction failed";
  }

  try {
    await updateQueueStatusForPatient(input.patientId, "completed", medplum, input.clinicId);
  } catch (err) {
    console.error("[billing-service] Invoice saved but queue status update failed for patient", input.patientId, err);
    const message = err instanceof Error ? err.message : "Queue status update failed";
    return { invoice: saved, queueUpdateError: message, stock, dispenseError };
  }

  try {
    await createReviewFollowUpForCheckout(medplum, {
      clinicId: input.clinicId,
      consultationId: input.consultationId,
      patientId: input.patientId,
    });
  } catch (err) {
    console.error("[billing-service] Checkout completed but review follow-up creation failed", input.patientId, err);
  }

  return { invoice: saved, stock, dispenseError };
}

export async function getInvoice(medplum: MedplumClient, invoiceId: string, clinicId?: string): Promise<Invoice | null> {
  try {
    const invoice = await medplum.readResource("Invoice", invoiceId) as Invoice;
    return await invoiceBelongsToClinic(medplum, invoice, clinicId) ? invoice : null;
  } catch {
    return null;
  }
}

export async function getPatientInvoices(medplum: MedplumClient, patientId: string, clinicId?: string): Promise<Invoice[]> {
  const results = await medplum.searchResources("Invoice", {
    subject: `Patient/${patientId}`,
    _sort: "-date",
    ...(clinicId ? { identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}` } : {}),
  });
  const filtered: Invoice[] = [];
  for (const invoice of results as Invoice[]) {
    if (await invoiceBelongsToClinic(medplum, invoice, clinicId)) filtered.push(invoice);
  }
  return filtered;
}

export async function getConsultationInvoice(medplum: MedplumClient, consultationId: string, clinicId?: string): Promise<Invoice | null> {
  const results = await medplum.searchResources("Invoice", {
    identifier: `${INVOICE_IDENTIFIER_SYSTEM}|${consultationId}`,
    _count: "1",
  });
  for (const invoice of (results as Invoice[]) ?? []) {
    if (await invoiceBelongsToClinic(medplum, invoice, clinicId)) return invoice;
  }
  return null;
}

function consultationIdOfInvoice(invoice: Invoice): string | undefined {
  return invoice.identifier?.find((identifier) => identifier.system === INVOICE_IDENTIFIER_SYSTEM)?.value;
}

/** Return the stock deducted at checkout (clinic-scoped, idempotent). */
async function restoreStockForInvoice(medplum: MedplumClient, invoice: Invoice, clinicId?: string): Promise<void> {
  const consultationId = consultationIdOfInvoice(invoice);
  const invoiceClinic =
    clinicId || invoice.extension?.find((ext) => ext.url === CLINIC_EXTENSION_URL)?.valueString;
  if (!consultationId || !invoiceClinic) return;
  await reverseStockForCheckout(medplum, { clinicId: invoiceClinic, consultationId, invoiceId: invoice.id });
}

/**
 * Void: cancel the invoice FIRST (If-Match), then restore stock. A checkout racing with the void
 * fails its invoice-version guard and cannot deduct. If the restore fails the invoice stays
 * cancelled and calling void again retries only the restore (idempotent), so stock is never
 * restored against a still-balanced invoice.
 */
export async function voidInvoice(medplum: MedplumClient, invoiceId: string, clinicId?: string): Promise<Invoice> {
  const invoice = await medplum.readResource("Invoice", invoiceId) as Invoice;
  await assertInvoiceBelongsToClinic(medplum, invoice, clinicId);
  const cancelled =
    invoice.status === "cancelled"
      ? invoice
      : await medplum.updateResource({ ...invoice, status: "cancelled" }, {
          headers: invoice.meta?.versionId ? { "If-Match": `W/"${invoice.meta.versionId}"` } : undefined,
        });
  await restoreStockForInvoice(medplum, invoice, clinicId);
  return cancelled;
}

export async function deleteInvoice(medplum: MedplumClient, invoiceId: string, clinicId?: string): Promise<void> {
  // Cancel (blocks concurrent checkout deductions) -> restore stock -> delete.
  // A failed delete leaves a cancelled invoice with stock restored (consistent); a failed restore leaves
  // a retriable cancelled invoice.
  await voidInvoice(medplum, invoiceId, clinicId);
  await medplum.deleteResource("Invoice", invoiceId);
}
