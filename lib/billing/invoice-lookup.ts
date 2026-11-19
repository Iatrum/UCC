/** Task 659: "no bill yet" is a normal state at checkout, not an error. */
export type InvoiceLookup = { status: number; ok: boolean; json: () => Promise<unknown> };

/** Invoice number of an existing bill, or null when none exists yet (404, or an empty/failed lookup). Never throws. */
export async function readExistingInvoiceNumber(response: InvoiceLookup): Promise<string | null> {
  if (response.status === 404) return null; // expected: no bill yet
  if (!response.ok) { console.warn(`Invoice lookup failed (${response.status}); continuing without an invoice number`); return null; } // real failure: stay visible, checkout still works
  const payload = (await response.json().catch(() => null)) as { invoiceNumber?: unknown } | null;
  return payload?.invoiceNumber ? String(payload.invoiceNumber) : null;
}
