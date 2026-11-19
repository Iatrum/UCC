import { beforeEach, describe, expect, test } from "bun:test";
import {
  createInventoryMedicationInMedplum,
  deleteInventoryMedicationInMedplum,
  getInventoryMedicationByIdFromMedplum,
  getInventoryMedicationsFromMedplum,
  updateInventoryMedicationInMedplum,
  type InventoryMedicationData,
} from "../../lib/fhir/inventory-service";
import {
  BANNER_NAME_LIMIT,
  isOrderSoon,
  isOutOfStock,
  summarizeLowStock,
} from "../../lib/inventory/stock-summary";
import { computeLineStock } from "../../lib/billing/checkout-stock";
import { NotFoundError } from "../../lib/server/route-helpers";
import { CLINIC_A, CLINIC_B, createMockMedplum, tenantResources } from "./helpers/mock-medplum";

// Task 643: inventory low-stock calculation and clinic scoping of the inventory service. Fake data only.
const data = (over: Partial<InventoryMedicationData> = {}): InventoryMedicationData => ({
  name: "Fake Amoxicillin",
  category: "Antibiotic",
  dosageForm: "Capsule",
  strengths: ["250mg", "500mg"],
  stock: 20,
  minimumStock: 5,
  unit: "caps",
  unitPrice: 1.5,
  expiryDate: "2031-01-31",
  ...over,
});

let mock: ReturnType<typeof createMockMedplum>;
beforeEach(() => {
  mock = createMockMedplum([...tenantResources(CLINIC_A), ...tenantResources(CLINIC_B)]);
});

describe("inventory-service clinic scoping and mapping", () => {
  test("create stamps the clinic identifier + account and round-trips every field", async () => {
    const id = await createInventoryMedicationInMedplum(mock.client, data(), CLINIC_A);
    const stored = mock.stored("Medication", id) as any;
    expect(stored.identifier).toEqual(
      expect.arrayContaining([
        { system: "https://ucc.emr/inventory/medication", value: "catalog-item" },
        { system: "clinic", value: CLINIC_A },
      ])
    );
    expect(stored.meta.accounts).toEqual([{ reference: `HealthcareService/acct-${CLINIC_A}` }]);
    expect(await getInventoryMedicationByIdFromMedplum(mock.client, id, CLINIC_A)).toMatchObject({
      id,
      ...data(),
    });
  });

  test("create fails without clinic tenant records and writes nothing", async () => {
    mock = createMockMedplum([]);
    await expect(createInventoryMedicationInMedplum(mock.client, data(), "fake-clinic-unknown")).rejects.toThrow();
    expect(mock.creates("Medication")).toHaveLength(0);
  });

  test("list returns only this clinic's catalog items (not other clinics', not non-catalog Medications)", async () => {
    const a = await createInventoryMedicationInMedplum(mock.client, data({ name: "A-drug" }), CLINIC_A);
    await createInventoryMedicationInMedplum(mock.client, data({ name: "B-drug" }), CLINIC_B);
    mock.db.set("Medication/plain", {
      resourceType: "Medication",
      id: "plain",
      identifier: [{ system: "clinic", value: CLINIC_A }],
      code: { text: "Not a catalog item" },
    });
    const list = await getInventoryMedicationsFromMedplum(mock.client, CLINIC_A);
    expect(list.map((m) => m.id)).toEqual([a]);
  });

  test("another clinic's item reads as null, and update/delete are 404 with no write", async () => {
    const b = await createInventoryMedicationInMedplum(mock.client, data(), CLINIC_B);
    const before = mock.writes.length;
    expect(await getInventoryMedicationByIdFromMedplum(mock.client, b, CLINIC_A)).toBeNull();
    await expect(updateInventoryMedicationInMedplum(mock.client, b, { stock: 0 }, CLINIC_A)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteInventoryMedicationInMedplum(mock.client, b, CLINIC_A)).rejects.toBeInstanceOf(NotFoundError);
    expect(mock.writes.length).toBe(before);
    expect(mock.stored("Medication", b)).toBeDefined();
  });

  test("a missing id is NotFoundError, not a 500", async () => {
    await expect(getInventoryMedicationByIdFromMedplum(mock.client, "nope", CLINIC_A)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteInventoryMedicationInMedplum(mock.client, "nope", CLINIC_A)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("partial update merges onto the current values and keeps the clinic stamp", async () => {
    const id = await createInventoryMedicationInMedplum(mock.client, data(), CLINIC_A);
    await updateInventoryMedicationInMedplum(mock.client, id, { stock: 0, minimumStock: 8 }, CLINIC_A);
    const got = await getInventoryMedicationByIdFromMedplum(mock.client, id, CLINIC_A);
    expect(got).toMatchObject({ ...data(), stock: 0, minimumStock: 8 });
    expect((mock.stored("Medication", id) as any).identifier).toContainEqual({ system: "clinic", value: CLINIC_A });
  });

  test("delete removes an own item", async () => {
    const id = await createInventoryMedicationInMedplum(mock.client, data(), CLINIC_A);
    await deleteInventoryMedicationInMedplum(mock.client, id, CLINIC_A);
    expect(mock.stored("Medication", id)).toBeUndefined();
  });

  test("sparse catalog entries get safe defaults (unit, name, zero numbers, junk stock)", async () => {
    mock.db.set("Medication/sparse", {
      resourceType: "Medication",
      id: "sparse",
      identifier: [
        { system: "https://ucc.emr/inventory/medication", value: "catalog-item" },
        { system: "clinic", value: CLINIC_A },
      ],
      extension: [{ url: "https://ucc.emr/inventory", extension: [{ url: "stock", valueString: "12" }, { url: "minimumStock", valueDecimal: 4 }] }],
    });
    const m = await getInventoryMedicationByIdFromMedplum(mock.client, "sparse", CLINIC_A);
    expect(m).toMatchObject({ name: "Unnamed medication", unit: "units", stock: 12, minimumStock: 4, unitPrice: 0, strengths: [], expiryDate: "" });
  });
});

describe("low-stock calculation", () => {
  const m = (name: string, stock: number, minimumStock: number) => ({ name, stock, minimumStock });

  test("boundaries: empty is out, at-or-below minimum is order soon, above is fine", () => {
    expect(isOutOfStock(m("a", 0, 5))).toBe(true);
    expect(isOutOfStock(m("a", -2, 5))).toBe(true); // negative after an over-dispense
    expect(isOutOfStock(m("a", 1, 5))).toBe(false);
    expect(isOrderSoon(m("a", 5, 5))).toBe(true);
    expect(isOrderSoon(m("a", 1, 5))).toBe(true);
    expect(isOrderSoon(m("a", 6, 5))).toBe(false);
    expect(isOrderSoon(m("a", 0, 5))).toBe(false); // out-of-stock has its own bucket
    expect(isOrderSoon(m("a", 3, 0))).toBe(false); // no threshold configured
  });

  test("empty catalog yields nothing to warn about", () => {
    const s = summarizeLowStock([]);
    expect(s).toMatchObject({ attention: [], bannerNames: [], moreCount: 0, inStock: 0 });
  });

  test("attention lists out-of-stock first, buckets never overlap, inStock counts non-empty items", () => {
    const s = summarizeLowStock([m("soon", 2, 5), m("ok", 50, 5), m("out", 0, 5), m("neg", -1, 0)]);
    expect(s.attention.map((i) => i.name)).toEqual(["out", "neg", "soon"]);
    expect(s.orderSoon.map((i) => i.name)).toEqual(["soon"]);
    expect(s.outOfStock.map((i) => i.name)).toEqual(["out", "neg"]);
    expect(s.inStock).toBe(2);
  });

  test("banner caps names at the limit and reports the remainder and which filter to open", () => {
    const empties = Array.from({ length: BANNER_NAME_LIMIT + 2 }, (_, i) => m(`e${i}`, 0, 1));
    const s = summarizeLowStock(empties);
    expect(s.bannerNames).toHaveLength(BANNER_NAME_LIMIT);
    expect(s.moreCount).toBe(2);
    expect(s.moreFilter).toBe("Out of stock");
    const soon = summarizeLowStock([m("x", 0, 1), m("y", 1, 1)]);
    expect(soon.moreFilter).toBe("Order soon");
  });
});

describe("computeLineStock (checkout stock preview) edge cases", () => {
  const catalog = [
    { id: "m1", name: "Fake Paracetamol", strengths: ["500mg"], stock: 5, unit: "tabs" },
    { id: "m2", name: "Fake Dup", stock: 9 },
    { id: "m3", name: "fake dup", stock: 9 },
    { id: "m4", name: "", stock: 9 },
  ];
  const line = (id: string, name: string, quantity: number, type?: string) => ({ id, name, quantity, ...(type ? { type } : {}) });

  test("services/documents, zero and negative quantities, and NaN are skipped (no preview, nothing deducted)", () => {
    const r = computeLineStock(
      [line("a", "Fake Paracetamol", 1, "Service"), line("b", "Fake Paracetamol", 0), line("c", "Fake Paracetamol", -2), line("d", "Fake Paracetamol", Number.NaN)],
      catalog
    );
    expect(r.size).toBe(0);
  });

  test("fractional quantity rounds up like the server; untyped lines count as items", () => {
    const r = computeLineStock([line("a", "Fake Paracetamol 500mg", 2.1)], catalog);
    expect(r.get("a")).toEqual({ match: "matched", unit: "tabs", onHand: 5, needed: 3, low: false });
  });

  test("low means on-hand is strictly below the whole bill's demand for that medicine", () => {
    const exact = computeLineStock([line("a", "Fake Paracetamol", 5)], catalog).get("a");
    expect(exact?.low).toBe(false);
    const over = computeLineStock([line("a", "Fake Paracetamol", 3), line("b", "Fake Paracetamol 500mg", 3)], catalog);
    expect(over.get("a")).toMatchObject({ needed: 6, low: true });
    expect(over.get("b")).toMatchObject({ needed: 6, low: true });
  });

  test("ambiguous (duplicate names), unknown and blank names are flagged, not guessed", () => {
    const r = computeLineStock([line("a", "Fake Dup", 1), line("b", "No Such", 1), line("c", "  ", 1)], catalog);
    expect(r.get("a")).toEqual({ match: "ambiguous" });
    expect(r.get("b")).toEqual({ match: "unmatched" });
    expect(r.get("c")).toEqual({ match: "unmatched" });
  });
});
