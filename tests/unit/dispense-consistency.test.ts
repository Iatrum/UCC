import { beforeEach, describe, expect, it } from "bun:test";
import { deductStockForCheckout, readStock, reverseStockForCheckout } from "../../lib/fhir/dispense-service";
import { deleteInvoice, voidInvoice } from "../../lib/fhir/billing-service";

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

function makeFake(initial: any[]) {
  const db = new Map<string, any>(initial.map((r) => [`${r.resourceType}/${r.id}`, r]));
  let seq = 0;
  const api = {
    db,
    beforeBatch: undefined as undefined | (() => void),
    failBatchAfter: Infinity, // number of successful batches before every batch fails (non-conflict error)
    failInvoiceWrite: false,
    failDelete: false,
    batches: 0,
    async readResource(type: string, id: string) {
      const r = db.get(`${type}/${id}`);
      if (!r) throw new Error("not found");
      return structuredClone(r);
    },
    async searchResources(type: string, params: Record<string, string>) {
      let all = [...db.values()].filter((r) => r.resourceType === type);
      if (params.identifier?.startsWith("clinic|")) {
        all = all.filter((r) => r.identifier?.some((i: any) => i.system === "clinic" && i.value === params.identifier.slice(7)));
      }
      if (params.context) all = all.filter((r) => r.context?.reference === params.context);
      const offset = Number(params._offset ?? 0);
      const count = Number(params._count ?? 20);
      return structuredClone(all.slice(offset, offset + count)); // enforces paging like Medplum
    },
    async updateResource(resource: any, options?: any) {
      if (api.failInvoiceWrite) throw new Error("500 boom");
      const cur = db.get(`${resource.resourceType}/${resource.id}`);
      const m = options?.headers?.["If-Match"];
      if (m && cur && `W/"${cur.meta.versionId}"` !== m) throw new Error("412 Precondition Failed");
      const saved = { ...resource, meta: { versionId: String(Number(cur?.meta?.versionId ?? 0) + 1) } };
      db.set(`${resource.resourceType}/${resource.id}`, saved);
      return structuredClone(saved);
    },
    async deleteResource(type: string, id: string) {
      if (api.failDelete) throw new Error("500 delete failed");
      db.delete(`${type}/${id}`);
    },
    async executeBatch(bundle: any) {
      api.beforeBatch?.();
      api.beforeBatch = undefined;
      if (api.batches >= api.failBatchAfter) throw new Error("500 transaction failed");
      api.batches += 1;
      const staged = new Map(db);
      for (const e of bundle.entry) {
        if (e.request.method === "PUT") {
          const cur = staged.get(e.request.url);
          if (e.request.ifMatch && cur && `W/"${cur.meta?.versionId}"` !== e.request.ifMatch) throw new Error("412 Precondition Failed");
          staged.set(e.request.url, { ...e.resource, meta: { versionId: String(Number(cur?.meta?.versionId ?? 0) + 1) } });
        } else {
          const id = `d${++seq}`;
          staged.set(`${e.resource.resourceType}/${id}`, { ...e.resource, id, meta: { versionId: "1" } });
        }
      }
      db.clear();
      staged.forEach((v, k) => db.set(k, v));
      return { resourceType: "Bundle", type: "transaction-response" };
    },
  };
  return api;
}

const base = { clinicId: "clinic-a", consultationId: "enc1", patientId: "p1" };
const line = (name: string, quantity: number) => ({ name, type: "Item", quantity });

describe("Finding 1: invoice/stock ordering", () => {
  let fake: ReturnType<typeof makeFake>;
  beforeEach(() => { fake = makeFake([med("m1", "Fake Drug", 100), invoice("1")]); });
  const stock = () => readStock(fake.db.get("Medication/m1"));

  it("a request holding an obsolete invoice version cannot deduct (A=5 paused, B=2 wins)", async () => {
    // A saved invoice v2 (qty 5); B then saved v3 (qty 2) and reconciled.
    fake.db.set("Invoice/inv1", invoice("3"));
    const b = await deductStockForCheckout(fake as any, { ...base, invoiceId: "inv1", invoiceVersionId: "3", items: [line("Fake Drug", 2)] });
    expect(b.superseded).toBeUndefined();
    const a = await deductStockForCheckout(fake as any, { ...base, invoiceId: "inv1", invoiceVersionId: "2", items: [line("Fake Drug", 5)] });
    expect(a.superseded).toBe(true);
    expect(stock()).toBe(98);
  });

  it("invoice changed between read and transaction fails the guard, no deduction", async () => {
    fake.beforeBatch = () => fake.db.set("Invoice/inv1", invoice("2"));
    const r = await deductStockForCheckout(fake as any, { ...base, invoiceId: "inv1", invoiceVersionId: "1", items: [line("Fake Drug", 5)] });
    expect(r.superseded).toBe(true);
    expect(stock()).toBe(100);
    expect([...fake.db.values()].filter((x) => x.resourceType === "MedicationDispense")).toHaveLength(0);
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

  it("current version deducts normally and the invoice guard does not bump its version", async () => {
    const r = await deductStockForCheckout(fake as any, { ...base, invoiceId: "inv1", invoiceVersionId: "1", items: [line("Fake Drug", 5)] });
    expect(r.superseded).toBeUndefined();
    expect(stock()).toBe(95);
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
    fake.failInvoiceWrite = true;
    await expect(voidInvoice(fake as any, "inv1", "clinic-a")).rejects.toThrow();
    expect(fake.db.get("Invoice/inv1").status).toBe("balanced");
    expect(stock("m1")).toBe(95);
    expect(stock("m2")).toBe(47);
  });

  it("restore failing after the second medication leaves a cancelled invoice and a retry finishes exactly once", async () => {
    fake.failBatchAfter = fake.batches + 1; // first reversal ok, second fails
    await expect(voidInvoice(fake as any, "inv1", "clinic-a")).rejects.toThrow();
    expect(fake.db.get("Invoice/inv1").status).toBe("cancelled");
    expect(stock("m1")).toBe(100);
    expect(stock("m2")).toBe(47);
    fake.failBatchAfter = Infinity;
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
