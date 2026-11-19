import { afterAll, beforeEach, describe, expect, spyOn, test, setSystemTime } from "bun:test";
import {
  completeCheckoutInvoice,
  isOwnVersionOrClinicBump,
  type CompleteCheckoutInput,
} from "../../lib/fhir/billing-service";
import {
  deductStockForCheckout,
  dispensedUnits,
  inventoryCandidates,
  listDispensesForConsultation,
  matchInventoryItem,
  readStock,
  reverseStockForCheckout,
  searchAll,
} from "../../lib/fhir/dispense-service";
import { makeFake } from "./helpers/fake-medplum";
import { CLINIC_A, CLINIC_B, createMockMedplum, tenantResources } from "./helpers/mock-medplum";

// Task 670: coverage round 5 for billing totals, checkout auto-deduct (no separate dispense step) and clinic scoping.
// Fake data only; no network.

const INV = "https://ucc.emr/inventory/medication";
const EXT = "https://ucc.emr/inventory";
const clinicIdent = (c: string) => ({ system: "clinic", value: c });

function med(id: string, name: string, stock: number, clinic = "clinic-a", strengths: string[] = []) {
  return {
    resourceType: "Medication",
    id,
    meta: { versionId: "1" },
    identifier: [{ system: INV, value: "catalog-item" }, clinicIdent(clinic)],
    code: { text: name },
    extension: [
      { url: EXT, extension: [{ url: "stock", valueInteger: stock }, ...strengths.map((s) => ({ url: "strength", valueString: s }))] },
    ],
  } as any;
}

describe("dispense-service pure helpers", () => {
  test("dispensedUnits rounds partial units up and rejects non-positive/non-finite", () => {
    expect(dispensedUnits(0.2)).toBe(1);
    expect(dispensedUnits(2.01)).toBe(3);
    expect(dispensedUnits(3)).toBe(3);
    for (const bad of [0, -1, Number.NaN, Infinity, -Infinity]) expect(dispensedUnits(bad)).toBe(0);
  });

  test("readStock accepts integer/string/decimal values and defaults to 0", () => {
    const withStock = (v: any) => ({ resourceType: "Medication", extension: [{ url: EXT, extension: [{ url: "stock", ...v }] }] }) as any;
    expect(readStock(withStock({ valueInteger: 4 }))).toBe(4);
    expect(readStock(withStock({ valueString: "7" }))).toBe(7);
    expect(readStock(withStock({ valueDecimal: 2.5 }))).toBe(2.5);
    expect(readStock(withStock({ valueString: "abc" }))).toBe(0);
    expect(readStock({ resourceType: "Medication" } as any)).toBe(0);
  });

  test("matching ignores case/whitespace, needs a unique hit and never matches blank names", () => {
    const cat = [med("a", "Paracetamol", 1, "clinic-a", ["500mg"]), med("b", "Amoxicillin", 1), med("c", "amoxicillin", 1)];
    expect(matchInventoryItem("  PARACETAMOL   500MG ", cat)?.id).toBe("a");
    expect(matchInventoryItem("Paracetamol", cat)?.id).toBe("a");
    expect(inventoryCandidates("Amoxicillin", cat).map((m) => m.id)).toEqual(["b", "c"]);
    expect(matchInventoryItem("Amoxicillin", cat)).toBeUndefined(); // ambiguous: never guess
    expect(inventoryCandidates("   ", cat)).toEqual([]);
    expect(inventoryCandidates("Paracetamol 250mg", cat)).toEqual([]);
    expect(inventoryCandidates("x", [{ resourceType: "Medication", id: "n" } as any])).toEqual([]); // nameless catalog entry
  });
});

describe("searchAll paging", () => {
  test("reads every page until a short page", async () => {
    const rows = Array.from({ length: 250 }, (_, i) => ({ resourceType: "Medication", id: `m${i}` }));
    const calls: string[] = [];
    const client: any = {
      async searchResources(_t: string, p: Record<string, string>) {
        calls.push(`${p._offset}/${p._count}`);
        return rows.slice(Number(p._offset), Number(p._offset) + Number(p._count));
      },
    };
    expect(await searchAll(client, "Medication", {})).toHaveLength(250);
    expect(calls).toEqual(["0/100", "100/100", "200/100"]);
  });

  test("an exact multiple of the page size needs one extra empty page", async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}` }));
    let n = 0;
    const client: any = { async searchResources(_t: string, p: Record<string, string>) { n += 1; return rows.slice(Number(p._offset), Number(p._offset) + 100); } };
    expect(await searchAll(client, "Medication", {})).toHaveLength(100);
    expect(n).toBe(2);
  });

  test("fails loudly instead of silently truncating a runaway search", async () => {
    const client: any = { async searchResources() { return Array.from({ length: 100 }, () => ({})); } };
    await expect(searchAll(client, "Medication", {})).rejects.toThrow(/exceeded/);
  });
});

describe("checkout stock deduction and audit", () => {
  const base = { clinicId: "clinic-a", consultationId: "enc1", patientId: "p1" };
  let fake: ReturnType<typeof makeFake>;
  beforeEach(() => {
    fake = makeFake([med("m1", "Paracetamol", 100, "clinic-a", ["500mg"]), med("m2", "Amoxicillin", 10), med("mx", "Paracetamol", 50, "clinic-b", ["500mg"])]);
  });
  const stock = (id: string) => readStock(fake.db.get(`Medication/${id}`));

  test("lines of the same medicine are summed and non-Item lines never touch stock", async () => {
    const r = await deductStockForCheckout(fake as any, {
      ...base,
      items: [
        { name: "Paracetamol 500mg", type: "Item", quantity: 2 },
        { name: "Paracetamol", type: "Item", quantity: 1.5 }, // ceil -> 2
        { name: "Paracetamol", type: "Service", quantity: 9 },
        { name: "Paracetamol", type: "Document", quantity: 9 },
        { name: "Amoxicillin", type: "Item", quantity: 0 }, // zero units: skipped, not unmatched
      ],
    });
    expect(stock("m1")).toBe(96);
    expect(stock("m2")).toBe(10);
    expect(r.adjusted).toHaveLength(1);
    expect(r.unmatched).toEqual([]);
  });

  test("line without a type is treated as a medicine; unknown names are reported unmatched, not deducted", async () => {
    const r = await deductStockForCheckout(fake as any, {
      ...base,
      items: [{ name: "Amoxicillin", quantity: 1 }, { name: "Not In Catalog", type: "Item", quantity: 1 }],
    });
    expect(stock("m2")).toBe(9);
    expect(r.unmatched).toEqual(["Not In Catalog"]);
    expect(r.unresolved).toEqual([]);
  });

  test("stock may go negative and is reported so staff can act", async () => {
    const r = await deductStockForCheckout(fake as any, { ...base, items: [{ name: "Amoxicillin", type: "Item", quantity: 12 }] });
    expect(stock("m2")).toBe(-2);
    expect(r.negativeStock).toEqual(["Amoxicillin"]);
  });

  test("removing the line on re-checkout returns the stock; the audit shows before/after", async () => {
    await deductStockForCheckout(fake as any, { ...base, items: [{ name: "Amoxicillin", type: "Item", quantity: 4 }] });
    expect(stock("m2")).toBe(6);
    const [rec] = await listDispensesForConsultation(fake as any, "clinic-a", "enc1");
    expect(rec).toMatchObject({ name: "Amoxicillin", quantity: 4, status: "completed", medicationId: "m2", stockBefore: 10, stockAfter: 6 });

    const r = await deductStockForCheckout(fake as any, { ...base, items: [{ name: "Consultation", type: "Service", quantity: 1 }] });
    expect(stock("m2")).toBe(10);
    expect(r.adjusted[0]).toMatchObject({ delta: -4, stockAfter: 10 });
  });

  test("an unmatched line that could be the earlier medicine retains the deduction instead of restoring it", async () => {
    await deductStockForCheckout(fake as any, { ...base, items: [{ name: "Amoxicillin", type: "Item", quantity: 4 }] });
    fake.db.set("Medication/m2", med("m2", "Amoxicillin Renamed", 6)); // catalog renamed after billing
    const r = await deductStockForCheckout(fake as any, { ...base, items: [{ name: "Amoxicillin 250mg", type: "Item", quantity: 4 }] });
    expect(stock("m2")).toBe(6); // not restored
    expect(r.retained).toEqual(["Amoxicillin"]);
    expect(r.unresolved).toEqual(["Amoxicillin 250mg"]);
  });

  test("audit and reverse are clinic scoped and reverse with nothing deducted is a no-op", async () => {
    expect((await reverseStockForCheckout(fake as any, { clinicId: "clinic-a", consultationId: "enc1" })).adjusted).toEqual([]);
    await deductStockForCheckout(fake as any, { ...base, items: [{ name: "Paracetamol 500mg", type: "Item", quantity: 3 }] });
    expect(await listDispensesForConsultation(fake as any, "clinic-b", "enc1")).toEqual([]);
    expect(await reverseStockForCheckout(fake as any, { clinicId: "clinic-b", consultationId: "enc1" })).toMatchObject({ adjusted: [] });
    expect(stock("m1")).toBe(97);
    expect(stock("mx")).toBe(50);
    const back = await reverseStockForCheckout(fake as any, { clinicId: "clinic-a", consultationId: "enc1" });
    expect(back.adjusted).toHaveLength(1);
    expect(stock("m1")).toBe(100);
  });

  test("another clinic's catalog item with the same name is never deducted", async () => {
    await deductStockForCheckout(fake as any, { ...base, clinicId: "clinic-b", items: [{ name: "Paracetamol 500mg", type: "Item", quantity: 5 }] });
    expect(stock("mx")).toBe(45);
    expect(stock("m1")).toBe(100);
  });
});

describe("isOwnVersionOrClinicBump", () => {
  const inv = (versionId: string | undefined, total = 10, status = "balanced") =>
    ({ resourceType: "Invoice", status, meta: versionId ? { versionId } : undefined, totalGross: { value: total }, totalNet: { value: total }, lineItem: [{ sequence: 1 }] }) as any;
  test("same version, missing version, or same billed content is ours", () => {
    expect(isOwnVersionOrClinicBump(inv("2"), inv("2"))).toBe(true);
    expect(isOwnVersionOrClinicBump(inv("2"), inv(undefined))).toBe(true);
    expect(isOwnVersionOrClinicBump(inv("2"), inv("3"))).toBe(true); // clinic account bump
  });
  test("a newer version with a different total or status is a competing write", () => {
    expect(isOwnVersionOrClinicBump(inv("2"), inv("3", 99))).toBe(false);
    expect(isOwnVersionOrClinicBump(inv("2"), inv("3", 10, "cancelled"))).toBe(false);
  });
});

describe("completeCheckoutInvoice edge cases", () => {
  const NOW = "2030-03-05T12:00:00.000Z";
  const seed = () => [
    ...tenantResources(CLINIC_A),
    ...tenantResources(CLINIC_B),
    { resourceType: "Patient", id: "p1", identifier: [clinicIdent(CLINIC_A)] },
    { resourceType: "Patient", id: "pb", identifier: [clinicIdent(CLINIC_B)] },
    { resourceType: "Encounter", id: "enc1", subject: { reference: "Patient/p1" }, identifier: [clinicIdent(CLINIC_A)] },
    { resourceType: "Encounter", id: "encb", subject: { reference: "Patient/pb" }, identifier: [clinicIdent(CLINIC_B)] },
    med("m1", "Fake Paracetamol", 10, CLINIC_A),
    med("mb", "Fake Paracetamol", 10, CLINIC_B),
  ];
  const line = (over: any = {}) => ({ id: "i1", name: "Fake Paracetamol", type: "Item" as const, quantity: 3, price: 2.5, ...over });
  const input = (over: Partial<CompleteCheckoutInput> = {}): CompleteCheckoutInput => ({
    consultationId: "enc1", patientId: "p1", clinicId: CLINIC_A, paymentMethod: "cash",
    items: [line()], totalAmount: 7.5, paidAmount: 7.5, ...over,
  });
  let mock: ReturnType<typeof createMockMedplum>;
  beforeEach(() => {
    spyOn(console, "error").mockImplementation(() => {});
    setSystemTime(new Date(NOW));
    mock = createMockMedplum(seed(), { versioning: true });
  });
  afterAll(() => setSystemTime());
  const stockOf = (id: string) => readStock(mock.stored("Medication", id) as any);

  test("floating point line sums (0.1 x 3 + 0.2) match a total rounded to sen", async () => {
    const r = await completeCheckoutInvoice(mock.client, input({ items: [line({ quantity: 3, price: 0.1 }), line({ id: "s", name: "Fee", type: "Service", quantity: 1, price: 0.2 })], totalAmount: 0.5, paidAmount: 0.5 }));
    expect(r.invoice.totalGross?.value).toBe(0.5);
  });

  test("a total within one sen of the lines is accepted; two sen off is rejected", async () => {
    await expect(completeCheckoutInvoice(mock.client, input({ totalAmount: 7.51, paidAmount: 7.51 }))).resolves.toBeDefined();
    await expect(completeCheckoutInvoice(mock.client, input({ consultationId: "enc1", totalAmount: 7.52, paidAmount: 7.52 }))).rejects.toThrow(/does not match/);
  });

  test("overpayment is accepted and leaves a zero balance", async () => {
    const r = await completeCheckoutInvoice(mock.client, input({ paidAmount: 20 }));
    const money = (suffix: string) => r.invoice.extension?.find((e) => e.url.endsWith(suffix))?.valueMoney?.value;
    expect(money("/balance")).toBe(0);
    expect(money("/paid-amount") ?? money("/paid")).toBe(20);
    expect(r.invoice.status).toBe("balanced");
  });

  test("stock deduction failure is reported as dispenseError and never blocks the saved invoice", async () => {
    const real = mock.client.searchResources.bind(mock.client);
    (mock.client as any).searchResources = async (type: string, p: any) => {
      if (type === "Medication") throw new Error("catalog unavailable");
      return real(type, p);
    };
    const r = await completeCheckoutInvoice(mock.client, input());
    expect(r.invoice.id).toBeDefined();
    expect(r.dispenseError).toBe("catalog unavailable");
    expect(r.stock).toBeUndefined();
    expect(stockOf("m1")).toBe(10);
  });

  test("a stale-version conflict on re-checkout is retried against the newer invoice, with one invoice and one deduction", async () => {
    const first = await completeCheckoutInvoice(mock.client, input());
    expect(stockOf("m1")).toBe(7);
    const realUpdate = mock.client.updateResource.bind(mock.client);
    let failed = 0;
    (mock.client as any).updateResource = async (res: any, opts: any) => {
      if (res.resourceType === "Invoice" && failed === 0) { failed += 1; throw new Error("412 Precondition Failed"); }
      return realUpdate(res, opts);
    };
    const again = await completeCheckoutInvoice(mock.client, input({ items: [line({ quantity: 4 })], totalAmount: 10, paidAmount: 10 }));
    expect(failed).toBe(1);
    expect(again.invoice.id).toBe(first.invoice.id);
    expect([...mock.db.values()].filter((r) => r.resourceType === "Invoice")).toHaveLength(1);
    expect(stockOf("m1")).toBe(6); // 10 - 4, not 10 - 3 - 4
  });

  test("a non-conflict write error is not retried and nothing is deducted", async () => {
    const first = await completeCheckoutInvoice(mock.client, input());
    (mock.client as any).updateResource = async (res: any) => { if (res.resourceType === "Invoice") throw new Error("500 boom"); return res; };
    await expect(completeCheckoutInvoice(mock.client, input({ items: [line({ quantity: 5 })], totalAmount: 12.5, paidAmount: 12.5 }))).rejects.toThrow(/boom/);
    expect(stockOf("m1")).toBe(7);
    expect(first.invoice.id).toBeDefined();
  });

  test("a checkout whose invoice was changed by someone else meanwhile does not deduct outdated quantities", async () => {
    const realRead = mock.client.readResource.bind(mock.client);
    let hijacked = false;
    (mock.client as any).readResource = async (type: string, id: string) => {
      const r = await realRead(type, id);
      if (type === "Invoice" && !hijacked) {
        hijacked = true; // the re-read right after save: simulate a competing checkout that changed the bill
        const changed = { ...r, totalGross: { value: 99, currency: "MYR" }, meta: { versionId: "99" } };
        mock.db.set(`Invoice/${id}`, changed);
        return structuredClone(changed);
      }
      return r;
    };
    const r = await completeCheckoutInvoice(mock.client, input());
    expect(r.stock?.superseded).toBe(true);
    expect(r.stock?.adjusted).toEqual([]);
    expect(stockOf("m1")).toBe(10);
  });

  test("the other clinic's visit, patient and stock are unreachable", async () => {
    await expect(completeCheckoutInvoice(mock.client, input({ consultationId: "encb", patientId: "pb" }))).rejects.toThrow();
    await expect(completeCheckoutInvoice(mock.client, input({ patientId: "pb" }))).rejects.toThrow();
    expect(mock.creates("Invoice")).toHaveLength(0);
    expect(stockOf("mb")).toBe(10);
    await completeCheckoutInvoice(mock.client, input());
    expect(stockOf("mb")).toBe(10);
  });
});
