import { describe, expect, test } from "bun:test";
import type { Medication } from "@medplum/fhirtypes";
import {
  dispensedUnits,
  inventoryCandidates,
  matchInventoryItem,
  readStock,
  withStock,
} from "../../lib/fhir/dispense-service";
import { INVENTORY_EXTENSION_URL } from "../../lib/fhir/structure-definitions";

// Fake data only (Task 629).
function med(id: string, name: string, stock: unknown, strengths: string[] = [], stockKey = "valueInteger"): Medication {
  return {
    resourceType: "Medication",
    id,
    code: { text: name },
    extension: [
      {
        url: INVENTORY_EXTENSION_URL,
        extension: [
          ...(stock === undefined ? [] : [{ url: "stock", [stockKey]: stock }]),
          ...strengths.map((s) => ({ url: "strength", valueString: s })),
        ],
      },
    ],
  } as Medication;
}

describe("dispensedUnits (auto-deduct quantity)", () => {
  test("whole numbers pass through", () => {
    expect(dispensedUnits(1)).toBe(1);
    expect(dispensedUnits(30)).toBe(30);
  });
  test("fractions round UP so stock is never under-deducted", () => {
    expect(dispensedUnits(0.5)).toBe(1);
    expect(dispensedUnits(2.1)).toBe(3);
  });
  test("zero, negative and non-finite never deduct", () => {
    expect(dispensedUnits(0)).toBe(0);
    expect(dispensedUnits(-3)).toBe(0);
    expect(dispensedUnits(NaN)).toBe(0);
    expect(dispensedUnits(Infinity)).toBe(0);
  });
});

describe("readStock / withStock", () => {
  test("reads integer, string and decimal stock; missing is 0", () => {
    expect(readStock(med("m1", "A", 7))).toBe(7);
    expect(readStock(med("m1", "A", "12", [], "valueString"))).toBe(12);
    expect(readStock(med("m1", "A", 4.5, [], "valueDecimal"))).toBe(4.5);
    expect(readStock(med("m1", "A", undefined))).toBe(0);
    expect(readStock({ resourceType: "Medication" } as Medication)).toBe(0);
    expect(readStock(med("m1", "A", "abc", [], "valueString"))).toBe(0);
  });
  test("negative stock is preserved (oversold item is visible)", () => {
    expect(readStock(withStock(med("m1", "A", 2), -3))).toBe(-3);
  });
  test("changes only stock: keeps strengths, does not mutate the input, ignores other extensions", () => {
    const original = med("m1", "Paracetamol", 10, ["500mg"]);
    (original.extension as any[]).push({ url: "https://example.test/other", valueString: "keep" });
    const before = JSON.stringify(original);
    const updated = withStock(original, 4);
    expect(JSON.stringify(original)).toBe(before);
    expect(readStock(updated)).toBe(4);
    const inv = updated.extension!.find((e) => e.url === INVENTORY_EXTENSION_URL)!;
    expect(inv.extension!.filter((c) => c.url === "stock")).toHaveLength(1);
    expect(inv.extension!.some((c) => c.url === "strength" && c.valueString === "500mg")).toBe(true);
    expect(updated.extension!.find((e) => e.url === "https://example.test/other")?.valueString).toBe("keep");
  });
});

describe("matchInventoryItem: invoice line -> exactly one inventory item", () => {
  const catalog = [
    med("m1", "Paracetamol", 10, ["500mg", "250mg"]),
    med("m2", "Amoxicillin", 5, ["500mg"]),
    med("m3", "Cetirizine", 8),
  ];
  test("matches by base name, case- and whitespace-insensitively", () => {
    expect(matchInventoryItem("  PARACETAMOL ", catalog)?.id).toBe("m1");
    expect(matchInventoryItem("cetirizine", catalog)?.id).toBe("m3");
  });
  test("matches 'Name strength' only for a declared strength", () => {
    expect(matchInventoryItem("Paracetamol 500mg", catalog)?.id).toBe("m1");
    expect(matchInventoryItem("paracetamol   250MG", catalog)?.id).toBe("m1");
    expect(matchInventoryItem("Paracetamol 1000mg", catalog)).toBeUndefined();
  });
  test("empty / unknown names match nothing", () => {
    expect(matchInventoryItem("", catalog)).toBeUndefined();
    expect(matchInventoryItem("   ", catalog)).toBeUndefined();
    expect(matchInventoryItem("Ibuprofen", catalog)).toBeUndefined();
    expect(inventoryCandidates("Ibuprofen", catalog)).toEqual([]);
  });
  test("ambiguous names are never guessed (two hits -> undefined)", () => {
    const dup = [...catalog, med("m4", "paracetamol", 3)];
    expect(inventoryCandidates("Paracetamol", dup).map((m) => m.id)).toEqual(["m1", "m4"]);
    expect(matchInventoryItem("Paracetamol", dup)).toBeUndefined();
  });
  test("catalog entries without a name are skipped", () => {
    const unnamed = { resourceType: "Medication", id: "x" } as Medication;
    expect(inventoryCandidates("anything", [unnamed, ...catalog])).toEqual([]);
  });
});
