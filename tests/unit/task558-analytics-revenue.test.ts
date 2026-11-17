import { describe, expect, it } from "bun:test";
import { computeAnalytics } from "../../lib/analytics/compute";

// Task 558: order prices are UNIT prices, so analytics revenue must be price x quantity (as checkout totals it)
// and include lab/imaging billingItems. Fake data only.
describe("analytics revenue matches checkout line math", () => {
  const now = new Date("2026-11-17T10:00:00Z");
  const c = {
    patientId: "p1", date: now, diagnosis: "Fake",
    prescriptions: [{ medication: { id: "m", name: "Fake med" }, frequency: "od", duration: "3d", quantity: 4, price: 2.5 }],
    procedures: [{ name: "Wound dressing", price: 30 }],
    billingItems: [{ name: "Lab: Full Blood Count", price: 25, quantity: 1 }],
  };
  it("counts quantity (default 1) and billingItems", () => {
    const a = computeAnalytics([{ id: "p1", gender: "female" }], [c], 1, now);
    expect(a.revenueThisMonth).toBe(10 + 30 + 25);
    expect(a.revenueAllTime).toBe(65);
    expect(a.revenueMonthly.at(-1)?.value).toBe(65);
  });
});
