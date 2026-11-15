import { describe, expect, test } from "bun:test";
import { InventoryValidationError, parseInventoryInput } from "@/lib/fhir/inventory-validation";
import { handleRouteError, NotFoundError } from "@/lib/server/route-helpers";

const full = { name: "Paracetamol", strengths: ["500mg"], stock: 10, minimumStock: 2, unitPrice: 1.5 };

describe("parseInventoryInput", () => {
  test("accepts a valid create body and fills defaults", () => {
    const out = parseInventoryInput({ name: " Fake Drug ", strengths: [] }, { partial: false });
    expect(out).toMatchObject({ name: "Fake Drug", stock: 0, minimumStock: 0, unitPrice: 0, unit: "units" });
  });
  test("coerces numeric strings", () => {
    expect(parseInventoryInput({ ...full, stock: "12" }, { partial: false }).stock).toBe(12);
  });
  test.each([
    ["fractional stock", { ...full, stock: 1.5 }],
    ["negative stock", { ...full, stock: -1 }],
    ["NaN stock", { ...full, stock: "abc" }],
    ["object stock", { ...full, stock: {} }],
    ["missing name", { ...full, name: "" }],
    ["bad strengths", { ...full, strengths: [1] }],
    ["bad price", { ...full, unitPrice: -2 }],
  ])("rejects %s with a validation error (400, not 500)", (_n, body) => {
    expect(() => parseInventoryInput(body, { partial: false })).toThrow(InventoryValidationError);
  });
  test("rejects non-object body", () => {
    expect(() => parseInventoryInput(null, { partial: false })).toThrow(InventoryValidationError);
  });
  test("partial only checks supplied fields", () => {
    expect(parseInventoryInput({ stock: 5 }, { partial: true })).toEqual({ stock: 5 });
    expect(() => parseInventoryInput({ stock: 0.5 }, { partial: true })).toThrow(InventoryValidationError);
  });
});

describe("handleRouteError", () => {
  test("NotFoundError maps to 404", async () => {
    const res = handleRouteError(new NotFoundError("Medication not found for this clinic"), "test");
    expect(res.status).toBe(404);
  });
});
