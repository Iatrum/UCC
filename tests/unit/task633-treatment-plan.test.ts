import { describe, expect, test } from "bun:test";
import {
  computeTreatmentPlanSummary,
  normalizeTreatmentPlanEntry,
  type TreatmentPlanEntry,
} from "../../lib/treatment-plan";

// Fake data only (Task 633). Treatment plan feeds invoice totals in RM.
const NOW = "2026-11-18T01:00:00.000Z";
const LATER = "2026-11-18T02:00:00.000Z";

describe("normalizeTreatmentPlanEntry", () => {
  test("rejects blank/whitespace names", () => {
    expect(() => normalizeTreatmentPlanEntry({ tab: "items", name: "   " }, NOW)).toThrow("name is required");
  });
  test("trims name, computes lineTotal rounded to sen", () => {
    const e = normalizeTreatmentPlanEntry({ tab: "items", name: " Paracetamol ", quantity: 3, unitPrice: 0.1 }, NOW);
    expect(e.name).toBe("Paracetamol");
    expect(e.lineTotal).toBe(0.3); // 3*0.1 = 0.30000000000000004 unrounded
    const f = normalizeTreatmentPlanEntry({ tab: "items", name: "X", quantity: 3, unitPrice: 1.005 }, NOW);
    expect(f.lineTotal).toBe(Number((3 * 1.005).toFixed(2)));
  });
  test("defaults: quantity 1, price 0 on a new entry", () => {
    const e = normalizeTreatmentPlanEntry({ tab: "services", name: "Consult" }, NOW);
    expect([e.quantity, e.unitPrice, e.lineTotal]).toEqual([1, 0, 0]);
    expect(e.createdAt).toBe(NOW);
    expect(e.id.length).toBeGreaterThan(10);
  });
  test("negative and NaN inputs are clamped / fall back", () => {
    const neg = normalizeTreatmentPlanEntry({ tab: "items", name: "X", quantity: -2, unitPrice: -5 }, NOW);
    expect([neg.quantity, neg.unitPrice, neg.lineTotal]).toEqual([0, 0, 0]);
    const nan = normalizeTreatmentPlanEntry({ tab: "items", name: "X", quantity: NaN, unitPrice: Infinity }, NOW);
    expect([nan.quantity, nan.unitPrice]).toEqual([1, 0]);
  });
  test("update keeps id/createdAt/unspecified fields, bumps updatedAt", () => {
    const first = normalizeTreatmentPlanEntry(
      { tab: "items", name: "Amox", quantity: 2, unitPrice: 4.5, dosage: "1 cap", catalogRef: "Med/1" },
      NOW
    );
    const next = normalizeTreatmentPlanEntry({ tab: "items", name: "Amox", quantity: 4 }, LATER, first);
    expect(next.id).toBe(first.id);
    expect(next.createdAt).toBe(NOW);
    expect(next.updatedAt).toBe(LATER);
    expect(next.unitPrice).toBe(4.5);
    expect(next.dosage).toBe("1 cap");
    expect(next.catalogRef).toBe("Med/1");
    expect(next.lineTotal).toBe(18);
  });
  test("explicit empty-string instruction overrides existing (?? semantics)", () => {
    const first = normalizeTreatmentPlanEntry({ tab: "items", name: "A", instruction: "after food" }, NOW);
    const next = normalizeTreatmentPlanEntry({ tab: "items", name: "A", instruction: "" }, LATER, first);
    expect(next.instruction).toBe("");
  });
  test("explicit id wins over existing id", () => {
    const first = normalizeTreatmentPlanEntry({ tab: "items", name: "A" }, NOW);
    expect(normalizeTreatmentPlanEntry({ id: "custom", tab: "items", name: "A" }, LATER, first).id).toBe("custom");
  });
});

describe("computeTreatmentPlanSummary", () => {
  const line = (lineTotal: number): TreatmentPlanEntry =>
    ({ id: String(lineTotal), tab: "items", name: "n", quantity: 1, unitPrice: lineTotal, lineTotal, createdAt: NOW, updatedAt: NOW });
  test("empty plan is RM 0 with zero items", () => {
    expect(computeTreatmentPlanSummary([])).toEqual({ subtotal: 0, total: 0, currency: "MYR", itemCount: 0 });
  });
  test("sums without float drift", () => {
    const s = computeTreatmentPlanSummary([line(0.1), line(0.2), line(0.3)]);
    expect(s.subtotal).toBe(0.6); // raw sum 0.6000000000000001
    expect(s.total).toBe(s.subtotal);
    expect(s.itemCount).toBe(3);
  });
  test("large mixed totals stay at 2dp", () => {
    expect(computeTreatmentPlanSummary([line(1234.56), line(99.99), line(0.45)]).subtotal).toBe(1335);
  });
});
