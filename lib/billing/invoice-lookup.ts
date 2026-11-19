/** Task 659: "no bill yet" is a normal state at checkout, not an error. */
export type InvoiceLookup = { status: number; ok: boolean; json: () => Promise<unknown> };

/** Invoice number of an existing bill, or null when none exists yet (404, or an empty/failed lookup). Never throws. */
export async function readExistingInvoiceNumber(response: InvoiceLookup): Promise<string | null> {
  if (!response.ok) return null; // 404 = no bill yet; other failures: checkout works without the number
  const payload = (await response.json().catch(() => null)) as { invoiceNumber?: unknown } | null;
  return payload?.invoiceNumber ? String(payload.invoiceNumber) : null;
}
