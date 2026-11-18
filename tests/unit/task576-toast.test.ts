import { describe, expect, test } from "bun:test";
import { buildStockNotice, checkoutToastDescription } from "../../lib/billing/checkout-stock";

describe("Task 576 checkout toast text", () => {
  test("no stock problem: plain saved sentence", () => {
    expect(checkoutToastDescription("INV-1", null)).toBe("Invoice INV-1 was saved.");
  });
  test("negative stock names the items", () => {
    const n = buildStockNotice({ stockNegative: ["Fake Med", "Fake Gel"] });
    expect(checkoutToastDescription("INV-1", n)).toBe(
      "Invoice INV-1 was saved. Stock is now negative for: Fake Med, Fake Gel. Check Inventory."
    );
  });
  test("unresolved and error appear in the toast too", () => {
    const text = checkoutToastDescription("INV-2", buildStockNotice({ stockUnresolved: ["Dup"], stockError: "boom" }));
    expect(text).toContain("Stock was not deducted: boom");
    expect(text).toContain("Dup");
  });
});
