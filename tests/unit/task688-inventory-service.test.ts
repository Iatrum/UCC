import { beforeEach, describe, expect, test } from "bun:test";
import { OperationOutcomeError, serverError } from "@medplum/core";
import {
  createInventoryMedicationInMedplum,
  deleteInventoryMedicationInMedplum,
  getInventoryMedicationByIdFromMedplum,
  getInventoryMedicationsFromMedplum,
  updateInventoryMedicationInMedplum,
  type InventoryMedicationData,
} from "../../lib/fhir/inventory-service";
import { InventoryValidationError, parseInventoryInput } from "../../lib/fhir/inventory-validation";
import { hasThreshold, lowStockBannerStatus, formatItemCount, summarizeLowStock } from "../../lib/inventory/stock-summary";
import { listDispensesForConsultation, DISPENSE_IDENTIFIER_SYSTEM, DISPENSE_STOCK_AFTER_EXTENSION_URL, DISPENSE_STOCK_BEFORE_EXTENSION_URL } from "../../lib/fhir/dispense-service";
import { INVENTORY_EXTENSION_URL } from "../../lib/fhir/structure-definitions";
import { NotFoundError } from "../../lib/server/route-helpers";
import { CLINIC_A, CLINIC_B, createMockMedplum, tenantResources } from "./helpers/mock-medplum";

// Task 688: unit coverage round 7 (inventory). Fake data only.
const base = (over: Partial<InventoryMedicationData> = {}): InventoryMedicationData => ({
  name: "Fake Paracetamol", category: "Analgesic", dosageForm: "Tablet", strengths: ["500mg"],
  stock: 10, minimumStock: 4, unit: "tabs", unitPrice: 0.5, expiryDate: "2030-06-30", ...over,
});

let mock: ReturnType<typeof createMockMedplum>;
beforeEach(() => {
  mock = createMockMedplum([...tenantResources(CLINIC_A), ...tenantResources(CLINIC_B)]);
});

describe("stock adjustments via updateInventoryMedicationInMedplum", () => {
  test("adjusting only stock keeps every other field, including to exactly 0", async () => {
    const id = await createInventoryMedicationInMedplum(mock.client, base(), CLINIC_A);
    await updateInventoryMedicationInMedplum(mock.client, id, { stock: 0 }, CLINIC_A);
    expect(await getInventoryMedicationByIdFromMedplum(mock.client, id, CLINIC_A)).toMatchObject(base({ stock: 0 }));
  });

  test("changing the threshold does not touch stock; strengths can be cleared", async () => {
    const id = await createInventoryMedicationInMedplum(mock.client, base(), CLINIC_A);
    await updateInventoryMedicationInMedplum(mock.client, id, { minimumStock: 0, strengths: [] }, CLINIC_A);
    const got = await getInventoryMedicationByIdFromMedplum(mock.client, id, CLINIC_A);
    expect(got).toMatchObject({ stock: 10, minimumStock: 0, strengths: [] });
    expect(hasThreshold(got!)).toBe(false);
  });

  test("update keeps the clinic identifier, inventory marker and account", async () => {
    const id = await createInventoryMedicationInMedplum(mock.client, base(), CLINIC_A);
    await updateInventoryMedicationInMedplum(mock.client, id, { stock: 3 }, CLINIC_A);
    const stored = mock.stored("Medication", id) as any;
    expect(stored.identifier).toEqual(expect.arrayContaining([
      { system: "clinic", value: CLINIC_A },
      { system: "https://ucc.emr/inventory/medication", value: "catalog-item" },
    ]));
    expect(stored.meta.accounts).toEqual([{ reference: `HealthcareService/acct-${CLINIC_A}` }]);
  });

  test("another clinic cannot update, read or delete the item and nothing is written", async () => {
    const id = await createInventoryMedicationInMedplum(mock.client, base(), CLINIC_A);
    const writesBefore = mock.writes.length;
    await expect(updateInventoryMedicationInMedplum(mock.client, id, { stock: 999 }, CLINIC_B)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteInventoryMedicationInMedplum(mock.client, id, CLINIC_B)).rejects.toBeInstanceOf(NotFoundError);
    expect(await getInventoryMedicationByIdFromMedplum(mock.client, id, CLINIC_B)).toBeNull();
    expect(mock.writes.length).toBe(writesBefore);
    expect((await getInventoryMedicationByIdFromMedplum(mock.client, id, CLINIC_A))!.stock).toBe(10);
  });

  test("unknown id maps to NotFoundError; other read failures are rethrown unchanged", async () => {
    await expect(updateInventoryMedicationInMedplum(mock.client, "missing", { stock: 1 }, CLINIC_A)).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteInventoryMedicationInMedplum(mock.client, "missing", CLINIC_A)).rejects.toBeInstanceOf(NotFoundError);
    const boom = new OperationOutcomeError(serverError(new Error("db down")));
    const failing: any = { ...mock.client, readResource: async () => { throw boom; } };
    await expect(getInventoryMedicationByIdFromMedplum(failing, "x", CLINIC_A)).rejects.toBe(boom);
  });

  test("a Medication without the inventory marker is not an inventory item even in the same clinic", async () => {
    mock = createMockMedplum([
      ...tenantResources(CLINIC_A),
      { resourceType: "Medication", id: "plain", identifier: [{ system: "clinic", value: CLINIC_A }], meta: { accounts: [{ reference: `HealthcareService/acct-${CLINIC_A}` }] }, code: { text: "Plain" } },
    ]);
    expect(await getInventoryMedicationByIdFromMedplum(mock.client, "plain", CLINIC_A)).toBeNull();
    expect(await getInventoryMedicationsFromMedplum(mock.client, CLINIC_A)).toEqual([]);
    await expect(deleteInventoryMedicationInMedplum(mock.client, "plain", CLINIC_A)).rejects.toBeInstanceOf(NotFoundError);
  });

  test("list returns only this clinic's items", async () => {
    await createInventoryMedicationInMedplum(mock.client, base({ name: "A item" }), CLINIC_A);
    await createInventoryMedicationInMedplum(mock.client, base({ name: "B item" }), CLINIC_B);
    expect((await getInventoryMedicationsFromMedplum(mock.client, CLINIC_A)).map((m) => m.name)).toEqual(["A item"]);
    expect((await getInventoryMedicationsFromMedplum(mock.client, CLINIC_B)).map((m) => m.name)).toEqual(["B item"]);
  });

  test("delete removes the resource for the owning clinic", async () => {
    const id = await createInventoryMedicationInMedplum(mock.client, base(), CLINIC_A);
    await deleteInventoryMedicationInMedplum(mock.client, id, CLINIC_A);
    expect(await getInventoryMedicationByIdFromMedplum(mock.client, id, CLINIC_A).catch((e) => e)).toBeInstanceOf(NotFoundError);
  });

  test("create fails when Medplum returns no id", async () => {
    const noId: any = { ...mock.client, createResource: async (r: any) => ({ ...r, id: undefined }) };
    await expect(createInventoryMedicationInMedplum(noId, base(), CLINIC_A)).rejects.toThrow("Failed to create inventory medication");
  });
});

describe("mapping of stored inventory values", () => {
  const stored = (extension: any[] | undefined, over: any = {}) => ({
    resourceType: "Medication", id: "m1",
    identifier: [{ system: "https://ucc.emr/inventory/medication", value: "catalog-item" }, { system: "clinic", value: CLINIC_A }],
    meta: { accounts: [{ reference: `HealthcareService/acct-${CLINIC_A}` }] },
    extension, ...over,
  });
  const root = (children: any[]) => [{ url: INVENTORY_EXTENSION_URL, extension: children }];
  const read = async (r: any) => {
    const m = createMockMedplum([...tenantResources(CLINIC_A), r]);
    return (await getInventoryMedicationByIdFromMedplum(m.client, r.id, CLINIC_A))!;
  };

  test("missing inventory extension falls back to safe defaults (no NaN)", async () => {
    expect(await read(stored(undefined))).toMatchObject({ name: "Unnamed medication", stock: 0, minimumStock: 0, unitPrice: 0, unit: "units", category: "", strengths: [], expiryDate: "" });
  });

  test("stock stored as string/decimal is read as a number; unknown value types become blank", async () => {
    const a = await read(stored(root([{ url: "stock", valueString: "7" }, { url: "unitPrice", valueDecimal: 2.25 }, { url: "minimumStock", valueBoolean: true }])));
    expect(a).toMatchObject({ stock: 7, unitPrice: 2.25, minimumStock: 0 });
    const b = await read(stored(root([{ url: "stock", valueDecimal: 3 }])));
    expect(b.stock).toBe(3);
  });

  test("category falls back to the coding code when the extension has none", async () => {
    const m = await read(stored(root([]), { code: { text: "X", coding: [{ code: "Vitamin" }] } }));
    expect(m.category).toBe("Vitamin");
  });
});

describe("stock-summary helpers not covered elsewhere", () => {
  test("hasThreshold rejects NaN/negative/zero", () => {
    expect(hasThreshold({ minimumStock: NaN })).toBe(false);
    expect(hasThreshold({ minimumStock: -1 })).toBe(false);
    expect(hasThreshold({ minimumStock: 0 })).toBe(false);
    expect(hasThreshold({ minimumStock: 1 })).toBe(true);
  });
  test("formatItemCount pluralises", () => {
    expect(formatItemCount(1)).toBe("1 item");
    expect(formatItemCount(0)).toBe("0 items");
    expect(formatItemCount(2)).toBe("2 items");
  });
  test("banner wording for out-only, low-only and mixed", () => {
    expect(lowStockBannerStatus(1, 0)).toBe("is out of stock.");
    expect(lowStockBannerStatus(2, 0)).toBe("are out of stock.");
    expect(lowStockBannerStatus(0, 1)).toBe("is at or below the minimum stock threshold.");
    expect(lowStockBannerStatus(1, 1)).toBe("are out of stock or at or below the minimum stock threshold.");
  });
  test("more than 5 out-of-stock items: banner lists 5, moreFilter points at Out of stock; empty list is quiet", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ name: `n${i}`, stock: 0, minimumStock: 0 }));
    const s = summarizeLowStock(items);
    expect(s.bannerNames).toHaveLength(5);
    expect(s.moreCount).toBe(2);
    expect(s.moreFilter).toBe("Out of stock");
    expect(s.inStock).toBe(0);
    const empty = summarizeLowStock([]);
    expect(empty).toMatchObject({ attention: [], moreCount: 0, inStock: 0, moreFilter: "Order soon" });
  });
});

describe("parseInventoryInput remaining branches", () => {
  const body = (over: Record<string, unknown> = {}) => ({ name: "Fake", strengths: [], ...over });
  test("rejects fractional stock/minimumStock but allows fractional unitPrice", () => {
    expect(() => parseInventoryInput(body({ stock: 1.5 }), { partial: false })).toThrow("stock must be a whole number");
    expect(() => parseInventoryInput(body({ minimumStock: "2.5" }), { partial: false })).toThrow("minimumStock must be a whole number");
    expect(parseInventoryInput(body({ unitPrice: 1.25 }), { partial: false }).unitPrice).toBe(1.25);
  });
  test("rejects negative, NaN, blank-string and non-numeric stock", () => {
    for (const bad of [-1, NaN, Infinity, "", "  ", "abc", true, {}]) {
      expect(() => parseInventoryInput(body({ stock: bad }), { partial: false })).toThrow(InventoryValidationError);
    }
  });
  test("null counts as not supplied; partial PATCH with stock 0 is kept", () => {
    expect(parseInventoryInput({ stock: null }, { partial: true })).toEqual({});
    expect(parseInventoryInput({ stock: 0 }, { partial: true })).toEqual({ stock: 0 });
    expect(parseInventoryInput({ stock: "0" }, { partial: true })).toEqual({ stock: 0 });
  });
  test("text fields must be text; name is trimmed; strengths must be text array", () => {
    expect(() => parseInventoryInput(body({ category: 5 }), { partial: false })).toThrow("category must be text");
    expect(() => parseInventoryInput(body({ strengths: [1] }), { partial: false })).toThrow("strengths must be an array of text");
    expect(() => parseInventoryInput({ name: "  " }, { partial: false })).toThrow("name is required");
    expect(parseInventoryInput({ name: "  Fake  ", strengths: [] }, { partial: false }).name).toBe("Fake");
    expect(() => parseInventoryInput(null, { partial: true })).toThrow("Request body must be an object");
  });
  test("create defaults: unit 'units', zero stock/price, empty text", () => {
    expect(parseInventoryInput(body(), { partial: false })).toMatchObject({ stock: 0, minimumStock: 0, unitPrice: 0, unit: "units", category: "", dosageForm: "", expiryDate: "" });
  });
});

describe("listDispensesForConsultation (stock movement audit)", () => {
  const ident = (clinic: string) => [{ system: "clinic", value: clinic }, { system: DISPENSE_IDENTIFIER_SYSTEM, value: "enc1:med1" }];
  const acct = (clinic: string) => ({ accounts: [{ reference: `HealthcareService/acct-${clinic}` }] });
  const dispense = (id: string, clinic: string, over: any = {}) => ({
    resourceType: "MedicationDispense", id, status: "completed", context: { reference: "Encounter/enc1" },
    identifier: ident(clinic), meta: acct(clinic),
    medicationReference: { reference: "Medication/med1", display: "Fake Med" }, quantity: { value: 3 },
    extension: [{ url: DISPENSE_STOCK_BEFORE_EXTENSION_URL, valueInteger: 10 }, { url: DISPENSE_STOCK_AFTER_EXTENSION_URL, valueInteger: 7 }],
    ...over,
  });

  test("returns before/after/quantity for this clinic only and ignores rows without the checkout identifier", async () => {
    const m = createMockMedplum([
      ...tenantResources(CLINIC_A), ...tenantResources(CLINIC_B),
      dispense("d1", CLINIC_A),
      dispense("d2", CLINIC_B),
      dispense("d3", CLINIC_A, { identifier: [{ system: "clinic", value: CLINIC_A }] }),
    ]);
    const rows = await listDispensesForConsultation(m.client, CLINIC_A, "enc1");
    expect(rows).toEqual([{ id: "d1", status: "completed", medicationId: "med1", name: "Fake Med", quantity: 3, stockBefore: 10, stockAfter: 7 }]);
  });

  test("missing quantity/extensions/display degrade to blanks, not crashes", async () => {
    const m = createMockMedplum([
      ...tenantResources(CLINIC_A),
      dispense("d1", CLINIC_A, { quantity: undefined, extension: undefined, medicationReference: undefined }),
    ]);
    const [row] = await listDispensesForConsultation(m.client, CLINIC_A, "enc1");
    expect(row).toMatchObject({ id: "d1", medicationId: "", name: "", quantity: 0, stockBefore: undefined, stockAfter: undefined });
  });

  test("no dispenses: empty list", async () => {
    const m = createMockMedplum(tenantResources(CLINIC_A));
    expect(await listDispensesForConsultation(m.client, CLINIC_A, "enc1")).toEqual([]);
  });
});
