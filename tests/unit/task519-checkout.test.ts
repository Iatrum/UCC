import { describe, expect, test } from "bun:test";
import { displayInvoiceNumber, INVOICE_NUMBER_PLACEHOLDER } from "../../lib/billing/checkout-guards";

// Task 519. Fake data only.
describe("displayInvoiceNumber", () => {
  test("stable placeholder until an invoice is saved", () => {
    expect(displayInvoiceNumber("")).toBe(INVOICE_NUMBER_PLACEHOLDER);
    expect(displayInvoiceNumber(undefined)).toBe("Assigned on completion");
    expect(displayInvoiceNumber("  ")).toBe("Assigned on completion");
    expect(displayInvoiceNumber(null)).toBe(displayInvoiceNumber(undefined));
  });
  test("saved number is shown as-is", () => {
    expect(displayInvoiceNumber("INV-20261117-ABC123")).toBe("INV-20261117-ABC123");
  });
});
