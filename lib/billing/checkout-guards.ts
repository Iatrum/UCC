// Pure checkout rules (Task 458). No I/O so they are unit-testable.

export type CheckoutLine = { quantity: number; price: number };

export const NO_BILLABLE_ITEMS_MESSAGE =
  "No billable items. Add a procedure, medication or service before completing the visit.";

/** Total of all lines, rounded to sen to avoid float drift. */
export function checkoutSubtotal(items: CheckoutLine[]): number {
  const total = items.reduce((sum, item) => sum + item.quantity * item.price, 0);
  return Math.round(total * 100) / 100;
}

/** A checkout is billable only if it has lines AND they add up to more than RM 0. */
export function hasBillableItems(items: CheckoutLine[]): boolean {
  return items.length > 0 && checkoutSubtotal(items) > 0;
}

/**
 * Patient id to use for a consultation. A caller-supplied id must match the
 * consultation's patient (otherwise treated as not found); when omitted the
 * consultation's own patient is used. Returns null when no id can be resolved.
 */
export function resolveCheckoutPatientId(
  consultationPatientId: string | null | undefined,
  requestedPatientId: string | null | undefined
): string | null {
  const own = consultationPatientId || null;
  if (!own) return null;
  if (requestedPatientId && requestedPatientId !== own) return null;
  return own;
}

export const INVOICE_NUMBER_PLACEHOLDER = "Assigned on completion";

/** Invoice number to show: only a saved invoice has one; otherwise a stable placeholder (Task 519). */
export function displayInvoiceNumber(savedInvoiceNumber: string | null | undefined): string {
  const cleaned = (savedInvoiceNumber ?? "").trim();
  return cleaned || INVOICE_NUMBER_PLACEHOLDER;
}
