import { beforeEach, describe, expect, it } from "bun:test";
import { deductStockForCheckout, readStock, reverseStockForCheckout } from "../../lib/fhir/dispense-service";
import { makeFake } from "./helpers/fake-medplum";
import { completeCheckoutInvoice, deleteInvoice, voidInvoice } from "../../lib/fhir/billing-service";

// Task 402: regression tests for the Task 359 review findings on checkout stock deduction.
const INV = "https://ucc.emr/inventory/medication";
const EXT = "https://ucc.emr/inventory";

function med(id: string, name: string, stock: number) {
  return {
    resourceType: "Medication",
    id,
    meta: { versionId: "1" },
    identifier: [{ system: INV, value: "catalog-item" }, { system: "clinic", value: "clinic-a" }],
    code: { text: name },
    extension: [{ url: EXT, extension: [{ url: "stock", valueInteger: stock }] }],
  } as any;
}

function invoice(version = "1", status = "balanced") {
  return {
    resourceType: "Invoice",
    id: "inv1",
    status,
    meta: { versionId: version },
    identifier: [{ system: "https://ucc.emr/invoice/consultation", value: "enc1" }, { system: "clinic", value: "clinic-a" }],
    extension: [{ url: "https://ucc.emr/invoice/clinic", valueString: "clinic-a" }],
  } as any;
}

const base = { clinicId: "clinic-a", consultationId: "enc1", patientId: "p1" };
const line = (name: string, quantity: number) => ({ name, type: "Item", quantity });

describe("Finding 1: invoice/stock ordering", () => {
  let fake: ReturnType<typeof makeFake>;
  beforeEach(() => { fake = makeFake([med("m1", "Fake Drug", 100), invoice("1")]); });
  const stock = () => readStock(fake.db.get("Medication/m1"));
  const dispenses = () => [...fake.db.values()].filter((x) => x.resourceType === "MedicationDispense");

  it("a request holding an obsolete invoice version cannot deduct (A=5 paused, B=2 wins)", async () => {
    fake.db.set("Invoice/inv1", invoice("3")); // A saved v2, B saved v3
    const b = await deductStockForCheckout(fake as any, { ...base, invoiceId: "inv1", invoiceVersionId: "3", items: [line("Fake Drug", 2)] });
    expect(b.superseded).toBeUndefined();
    const a = await deductStockForCheckout(fake as any, { ...base, invoiceId: "inv1", invoiceVersionId: "2", items: [line("Fake Drug", 5)] });
    expect(a.superseded).toBe(true);
    expect(stock()).toBe(98);
  });

  it("A passes the invoice check, B moves on and reconciles first: A's claim conflicts, retries, is superseded", async () => {
    // Competing request B wins the dispense row (and bumps the invoice) just before A's claim write.
    fake.beforeWrite = (type) => {
      if (type !== "MedicationDispense") return;
      fake.db.set("Invoice/inv1", invoice("2"));
    };
    fake.failConflicts = 1;
    fake.failType = "MedicationDispense";
    const r = await deductStockForCheckout(fake as any, { ...base, invoiceId: "inv1", invoiceVersionId: "1", items: [line("Fake Drug", 5)] });
    expect(r.superseded).toBe(true);
    expect(stock()).toBe(100);
    expect(dispenses()).toHaveLength(0);
  });

  it("two truly concurrent identical checkouts deduct exactly once", async () => {
    const items = [line("Fake Drug", 5)];
    const run = () => deductStockForCheckout(fake as any, { ...base, invoiceId: "inv1", invoiceVersionId: "1", items });
    await Promise.all([run(), run(), run()]);
    expect(stock()).toBe(95);
    expect(dispenses()).toHaveLength(1);
  });

  it("two concurrent checkouts with different quantities converge on the newest invoice", async () => {
    fake.db.set("Invoice/inv1", invoice("3"));
    const results = await Promise.all([
      deductStockForCheckout(fake as any, { ...base, invoiceId: "inv1", invoiceVersionId: "2", items: [line("Fake Drug", 5)] }),
      deductStockForCheckout(fake as any, { ...base, invoiceId: "inv1", invoiceVersionId: "3", items: [line("Fake Drug", 2)] }),
    ]);
    expect(results[0].superseded).toBe(true);
    expect(stock()).toBe(98);
  });

  it("checkout racing a void: void wins, checkout deducts nothing", async () => {
    await voidInvoice(fake as any, "inv1", "clinic-a");
    const r = await deductStockForCheckout(fake as any, { ...base, invoiceId: "inv1", invoiceVersionId: "1", items: [line("Fake Drug", 5)] });
    expect(r.superseded).toBe(true);
    expect(stock()).toBe(100);
  });

  it("checkout racing a delete: deleted invoice means no deduction", async () => {
    fake.db.delete("Invoice/inv1");
    const r = await deductStockForCheckout(fake as any, { ...base, invoiceId: "inv1", invoiceVersionId: "1", items: [line("Fake Drug", 5)] });
    expect(r.superseded).toBe(true);
    expect(stock()).toBe(100);
  });

  it("failed stock write releases the claim; the retry deducts exactly once", async () => {
    fake.failWrites = { type: "Medication", after: 0, count: 0 };
    await expect(deductStockForCheckout(fake as any, { ...base, items: [line("Fake Drug", 5)] })).rejects.toThrow();
    expect(stock()).toBe(100);
    expect(dispenses()).toHaveLength(0);
    fake.failWrites = { type: "", after: Infinity, count: 0 };
    await deductStockForCheckout(fake as any, { ...base, items: [line("Fake Drug", 5)] });
    await deductStockForCheckout(fake as any, { ...base, items: [line("Fake Drug", 5)] });
    expect(stock()).toBe(95);
    expect(dispenses()).toHaveLength(1);
  });

  it("an abandoned (crashed) claim is taken over once stale and settled exactly once", async () => {
    fake.db.set("MedicationDispense/dx", {
      resourceType: "MedicationDispense", id: "dx", meta: { versionId: "1" }, status: "in-progress",
      identifier: [{ system: "https://ucc.emr/dispense/checkout", value: "enc1:m1" }, { system: "clinic", value: "clinic-a" }],
      medicationReference: { reference: "Medication/m1", display: "Fake Drug" },
      context: { reference: "Encounter/enc1" }, quantity: { value: 5, unit: "units" },
      extension: [
        { url: "https://ucc.emr/dispense/stock-pending", valueInteger: 5 },
        { url: "https://ucc.emr/dispense/target", valueInteger: 5 },
      ],
      note: [{ time: "2000-01-01T00:00:00.000Z", text: "x" }],
    });
    await deductStockForCheckout(fake as any, { ...base, items: [line("Fake Drug", 5)] });
    await deductStockForCheckout(fake as any, { ...base, items: [line("Fake Drug", 5)] });
    expect(stock()).toBe(95);
    expect(dispenses()).toHaveLength(1);
    expect(dispenses()[0].status).toBe("completed");
  });
});

describe("Finding 2: unresolved lines never undo a deduction", () => {
  let fake: ReturnType<typeof makeFake>;
  beforeEach(() => { fake = makeFake([med("m1", "Fake Drug", 100)]); });
  const stock = (id = "m1") => readStock(fake.db.get(`Medication/${id}`));
  const dispenses = () => [...fake.db.values()].filter((r) => r.resourceType === "MedicationDispense");

  it("duplicate catalog name added after checkout: previous 5 stay deducted and the line is flagged", async () => {
    await deductStockForCheckout(fake as any, { ...base, items: [line("Fake Drug", 5)] });
    fake.db.set("Medication/m9", med("m9", "Fake Drug", 40));
    const r = await deductStockForCheckout(fake as any, { ...base, items: [line("Fake Drug", 5)] });
    expect(stock()).toBe(95);
    expect(stock("m9")).toBe(40);
    expect(dispenses()[0].status).toBe("completed");
    expect(r.unresolved).toEqual(["Fake Drug"]);
    expect(r.retained).toEqual(["Fake Drug"]);
  });

  it("catalog item renamed after checkout: deduction retained", async () => {
    await deductStockForCheckout(fake as any, { ...base, items: [line("Fake Drug", 5)] });
    fake.db.set("Medication/m1", med("m1", "Fake Drug Forte", 95));
    const r = await deductStockForCheckout(fake as any, { ...base, items: [line("Fake Drug", 5)] });
    expect(stock()).toBe(95);
    expect(dispenses()[0].status).toBe("completed");
    expect(r.retained).toEqual(["Fake Drug"]);
  });

  it("a genuinely removed line is still restored when nothing unresolved could bill it", async () => {
    await deductStockForCheckout(fake as any, { ...base, items: [line("Fake Drug", 5)] });
    await deductStockForCheckout(fake as any, { ...base, items: [line("Unrelated supply", 1)] });
    expect(stock()).toBe(100);
    expect(dispenses()[0].status).toBe("cancelled");
  });
});

describe("Finding 3: pagination", () => {
  it("catalog larger than a page and repeated checkout stays idempotent (no duplicate dispenses)", async () => {
    const meds = Array.from({ length: 250 }, (_, i) => med(`x${i}`, `Drug ${i}`, 100));
    const fake = makeFake(meds);
    const items = meds.map((m) => line(m.code.text, 1));
    const first = await deductStockForCheckout(fake as any, { ...base, items });
    expect(first.unmatched).toHaveLength(0);
    await deductStockForCheckout(fake as any, { ...base, items });
    const dispenses = [...fake.db.values()].filter((r) => r.resourceType === "MedicationDispense");
    expect(dispenses).toHaveLength(250);
    expect(readStock(fake.db.get("Medication/x249"))).toBe(99);
    expect(readStock(fake.db.get("Medication/x0"))).toBe(99);
  });

  it("reverse restores dispenses beyond the first page", async () => {
    const meds = Array.from({ length: 130 }, (_, i) => med(`x${i}`, `Drug ${i}`, 10));
    const fake = makeFake(meds);
    await deductStockForCheckout(fake as any, { ...base, items: meds.map((m) => line(m.code.text, 2)) });
    await reverseStockForCheckout(fake as any, base);
    expect(readStock(fake.db.get("Medication/x129"))).toBe(10);
    expect(readStock(fake.db.get("Medication/x0"))).toBe(10);
  });
});

describe("Finding 4: void/delete ordering and recovery", () => {
  let fake: ReturnType<typeof makeFake>;
  beforeEach(async () => {
    fake = makeFake([med("m1", "Fake Drug", 100), med("m2", "Other Drug", 50), invoice("1")]);
    await deductStockForCheckout(fake as any, { ...base, items: [line("Fake Drug", 5), line("Other Drug", 3)] });
  });
  const stock = (id: string) => readStock(fake.db.get(`Medication/${id}`));

  it("failed invoice void leaves stock deducted (not restored against a balanced invoice)", async () => {
    fake.failWrites = { type: "Invoice", after: 0, count: 0 };
    await expect(voidInvoice(fake as any, "inv1", "clinic-a")).rejects.toThrow();
    expect(fake.db.get("Invoice/inv1").status).toBe("balanced");
    expect(stock("m1")).toBe(95);
    expect(stock("m2")).toBe(47);
  });

  it("restore failing after the second medication leaves a cancelled invoice and a retry finishes exactly once", async () => {
    fake.failWrites = { type: "Medication", after: 1, count: 0 }; // first reversal ok, second fails
    await expect(voidInvoice(fake as any, "inv1", "clinic-a")).rejects.toThrow();
    expect(fake.db.get("Invoice/inv1").status).toBe("cancelled");
    expect(stock("m1")).toBe(100);
    expect(stock("m2")).toBe(47);
    fake.failWrites = { type: "", after: Infinity, count: 0 };
    await voidInvoice(fake as any, "inv1", "clinic-a"); // retry on an already-cancelled invoice
    expect(stock("m1")).toBe(100);
    expect(stock("m2")).toBe(50);
  });

  it("failed delete after restore leaves a cancelled invoice and consistent stock", async () => {
    fake.failDelete = true;
    await expect(deleteInvoice(fake as any, "inv1", "clinic-a")).rejects.toThrow();
    expect(fake.db.get("Invoice/inv1").status).toBe("cancelled");
    expect(stock("m1")).toBe(100);
    expect(stock("m2")).toBe(50);
  });

  it("successful delete restores stock once", async () => {
    await deleteInvoice(fake as any, "inv1", "clinic-a");
    expect(fake.db.has("Invoice/inv1")).toBe(false);
    expect(stock("m1")).toBe(100);
  });
});

// Task 410: end-to-end checkout races (fake data only).
describe("Task 410: checkout version guard and idempotent invoice creation", () => {
  let fake: ReturnType<typeof makeFake>;
  const seed = () => [
    med("m1", "Fake Drug", 100),
    { resourceType: "Organization", id: "clinic-a" },
    { resourceType: "Patient", id: "p1", identifier: [{ system: "clinic", value: "clinic-a" }] },
    { resourceType: "Encounter", id: "enc1", subject: { reference: "Patient/p1" }, identifier: [{ system: "clinic", value: "clinic-a" }] },
  ];
  const stock = () => readStock(fake.db.get("Medication/m1"));
  const invoices = () => [...fake.db.values()].filter((x) => x.resourceType === "Invoice");
  const checkout = (qty: number) =>
    completeCheckoutInvoice(fake as any, {
      consultationId: "enc1", patientId: "p1", clinicId: "clinic-a", paymentMethod: "cash",
      items: [{ id: "i1", name: "Fake Drug", type: "Item", quantity: qty, price: 2 }],
      paidAmount: qty * 2, totalAmount: qty * 2,
    });
  beforeEach(() => { fake = makeFake(seed()); });

  it("a concurrent checkout saving between our save and re-read: we do not adopt its version or deduct", async () => {
    // B (qty 2) saves right after A (qty 5) saved, before A re-reads.
    fake.onSetAccounts = () => {
      const cur = fake.db.get(`Invoice/${invoices()[0].id}`);
      fake.db.set(`Invoice/${cur.id}`, {
        ...cur,
        lineItem: [{ sequence: 1, extension: [{ url: "q", valueDecimal: 2 }] }],
        meta: { ...cur.meta, versionId: String(Number(cur.meta.versionId) + 1) },
      });
    };
    const r = await checkout(5);
    expect(r.stock?.superseded).toBe(true);
    expect(stock()).toBe(100); // A deducted nothing; B reconciles the stock itself
    expect([...fake.db.values()].filter((x) => x.resourceType === "MedicationDispense")).toHaveLength(0);
  });

  it("only the clinic-assignment bump is accepted: stock is deducted once", async () => {
    const r = await checkout(5); // default fake $set-accounts bumps the version without changing content
    expect(r.stock?.superseded).toBeUndefined();
    expect(stock()).toBe(95);
  });

  it("two first-time checkouts for the same visit create exactly one invoice", async () => {
    const [a, b] = await Promise.all([checkout(5), checkout(5)]);
    expect(invoices()).toHaveLength(1);
    expect(a.invoice.id).toBe(b.invoice.id);
    expect(stock()).toBe(95);
  });

  it("checkout is never blocked by low stock", async () => {
    fake.db.set("Medication/m1", med("m1", "Fake Drug", 1));
    const r = await checkout(5);
    expect(r.invoice.id).toBeDefined();
    expect(r.dispenseError).toBeUndefined();
  });
});
