import { beforeEach, describe, expect, it } from "bun:test";
import {
  deductStockForCheckout,
  matchInventoryItem,
  readStock,
  reverseStockForCheckout,
} from "../../lib/fhir/dispense-service";

const INV = "https://ucc.emr/inventory/medication";
const EXT = "https://ucc.emr/inventory";

function med(id: string, name: string, stock: number, clinic = "clinic-a", strengths: string[] = []) {
  return {
    resourceType: "Medication",
    id,
    meta: { versionId: "1" },
    identifier: [
      { system: INV, value: "catalog-item" },
      { system: "clinic", value: clinic },
    ],
    code: { text: name },
    extension: [
      {
        url: EXT,
        extension: [
          { url: "stock", valueInteger: stock },
          { url: "minimumStock", valueInteger: 5 },
          ...strengths.map((s) => ({ url: "strength", valueString: s })),
        ],
      },
    ],
  } as any;
}

function makeFake(initial: any[]) {
  const db = new Map<string, any>(initial.map((r) => [`${r.resourceType}/${r.id}`, r]));
  let seq = 0;
  let failNextBatchWith412 = 0;
  const api = {
    db,
    batches: 0,
    failBatches(n: number) { failNextBatchWith412 = n; },
    async readResource(type: string, id: string) {
      const r = db.get(`${type}/${id}`);
      if (!r) throw new Error("not found");
      return structuredClone(r);
    },
    async searchResources(type: string, params: Record<string, string>) {
      let all = [...db.values()].filter((r) => r.resourceType === type);
      if (params.identifier && params.identifier.startsWith("clinic|")) all = all.filter((r) => r.identifier?.some((i: any) => i.system === "clinic" && i.value === params.identifier.slice(7)));
      if (params.context) all = all.filter((r) => r.context?.reference === params.context);
      return structuredClone(all);
    },
    async executeBatch(bundle: any) {
      api.batches += 1;
      if (failNextBatchWith412 > 0) { failNextBatchWith412 -= 1; throw new Error("412 Precondition Failed"); }
      const staged = new Map(db);
      for (const e of bundle.entry) {
        if (e.request.method === "PUT") {
          const key = e.request.url;
          const cur = staged.get(key);
          if (e.request.ifMatch && cur && `W/"${cur.meta?.versionId}"` !== e.request.ifMatch) {
            throw new Error("412 Precondition Failed");
          }
          staged.set(key, { ...e.resource, meta: { versionId: String(Number(cur?.meta?.versionId ?? 0) + 1) } });
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

describe("dispense-service", () => {
  let fake: ReturnType<typeof makeFake>;
  beforeEach(() => {
    fake = makeFake([
      med("m1", "Paracetamol", 100, "clinic-a", ["500mg"]),
      med("m2", "Amoxicillin", 2),
      med("mx", "Paracetamol", 50, "clinic-b", ["500mg"]),
    ]);
  });
  const stock = (id: string) => readStock(fake.db.get(`Medication/${id}`));
  const dispenses = () => [...fake.db.values()].filter((r) => r.resourceType === "MedicationDispense");

  it("deducts billed quantity and records a MedicationDispense", async () => {
    const r = await deductStockForCheckout(fake as any, { ...base, items: [{ name: "Paracetamol 500mg", type: "Item", quantity: 10 }] });
    expect(stock("m1")).toBe(90);
    expect(stock("mx")).toBe(50); // other clinic untouched
    expect(r.adjusted).toHaveLength(1);
    expect(dispenses()).toHaveLength(1);
    expect(dispenses()[0].status).toBe("completed");
    expect(dispenses()[0].quantity.value).toBe(10);
  });

  it("is idempotent on retry / identical re-checkout", async () => {
    const items = [{ name: "Paracetamol 500mg", type: "Item", quantity: 10 }];
    await deductStockForCheckout(fake as any, { ...base, items });
    await deductStockForCheckout(fake as any, { ...base, items });
    await deductStockForCheckout(fake as any, { ...base, items });
    expect(stock("m1")).toBe(90);
    expect(dispenses()).toHaveLength(1);
  });

  it("re-checkout with changed quantity applies only the difference; removed lines return to stock", async () => {
    await deductStockForCheckout(fake as any, { ...base, items: [{ name: "Paracetamol", type: "Item", quantity: 10 }, { name: "Amoxicillin", type: "Item", quantity: 1 }] });
    await deductStockForCheckout(fake as any, { ...base, items: [{ name: "Paracetamol", type: "Item", quantity: 4 }] });
    expect(stock("m1")).toBe(96);
    expect(stock("m2")).toBe(2);
    expect(dispenses().find((d) => d.medicationReference.reference === "Medication/m2").status).toBe("cancelled");
  });

  it("allows checkout into negative stock and flags it", async () => {
    const r = await deductStockForCheckout(fake as any, { ...base, items: [{ name: "Amoxicillin", type: "Item", quantity: 5 }] });
    expect(stock("m2")).toBe(-3);
    expect(r.negativeStock).toEqual(["Amoxicillin"]);
  });

  it("reverse restores stock once and is idempotent", async () => {
    await deductStockForCheckout(fake as any, { ...base, items: [{ name: "Paracetamol", type: "Item", quantity: 10 }] });
    await reverseStockForCheckout(fake as any, base);
    await reverseStockForCheckout(fake as any, base);
    expect(stock("m1")).toBe(100);
    expect(dispenses()[0].status).toBe("cancelled");
    // re-checkout after void deducts again exactly once
    await deductStockForCheckout(fake as any, { ...base, items: [{ name: "Paracetamol", type: "Item", quantity: 10 }] });
    expect(stock("m1")).toBe(90);
    expect(dispenses()).toHaveLength(1);
  });

  it("reverse never touches another clinic's dispenses", async () => {
    await deductStockForCheckout(fake as any, { ...base, items: [{ name: "Paracetamol", type: "Item", quantity: 10 }] });
    await reverseStockForCheckout(fake as any, { ...base, clinicId: "clinic-b" });
    expect(stock("m1")).toBe(90);
  });

  it("skips non-items, unknown and ambiguous names without failing", async () => {
    fake.db.set("Medication/m3", med("m3", "Amoxicillin", 9));
    const r = await deductStockForCheckout(fake as any, {
      ...base,
      items: [
        { name: "Consultation fee", type: "Service", quantity: 1 },
        { name: "Mystery pill", type: "Item", quantity: 1 },
        { name: "Amoxicillin", type: "Item", quantity: 1 },
      ],
    });
    expect(r.unmatched).toEqual(["Mystery pill", "Amoxicillin"]);
    expect(dispenses()).toHaveLength(0);
  });

  it("retries on a version conflict without double deducting", async () => {
    fake.failBatches(2);
    await deductStockForCheckout(fake as any, { ...base, items: [{ name: "Paracetamol", type: "Item", quantity: 3 }] });
    expect(stock("m1")).toBe(97);
    expect(dispenses()).toHaveLength(1);
  });

  it("matchInventoryItem matches name or name+strength only", () => {
    const cat = [med("m1", "Paracetamol", 1, "clinic-a", ["500mg"])];
    expect(matchInventoryItem("paracetamol  500MG", cat)?.id).toBe("m1");
    expect(matchInventoryItem("Paracetamol 250mg", cat)).toBeUndefined();
  });
});
