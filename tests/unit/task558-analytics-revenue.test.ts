import { describe, expect, it } from "bun:test";
import { CLINIC_IDENTIFIER_SYSTEM } from "../../lib/fhir/clinic-tenancy";
import { clearAnalyticsCache, getMoneyOps, getSummary } from "../../lib/analytics/queries";

// Task 558 (folded into the Task 551 redesign): revenue must match checkout line math (line = unit price x quantity,
// lab/imaging lines included) and consultations must not be capped to the newest 300 patients. Fake data only.
describe("analytics revenue and consultations (redesign code path)", () => {
  const ident = [{ system: CLINIC_IDENTIFIER_SYSTEM, value: "clinic-a" }];
  const now = new Date("2026-11-17T05:00:00Z");
  const line = (text: string, type: string, amount: number, qty: number) => ({
    chargeItemCodeableConcept: { text }, priceComponent: [{ amount: { value: amount } }],
    extension: [{ url: "https://ucc.emr/invoice/line-item-type", valueString: type }, { url: "https://ucc.emr/invoice/line-item-quantity", valueDecimal: qty }],
  });
  const encounters = Array.from({ length: 450 }, (_, i) => ({
    resourceType: "Encounter", id: `e${i}`, identifier: ident, subject: { reference: `Patient/p${i}` }, period: { start: "2026-11-17T02:00:00Z" },
  }));
  const fake: any = {
    async searchResources(type: string) {
      if (type === "Encounter") return encounters;
      if (type === "Invoice") return [{
        resourceType: "Invoice", id: "i1", status: "balanced", date: "2026-11-17T03:00:00Z", identifier: ident, totalGross: { value: 65 },
        lineItem: [line("Fake med", "Item", 10, 4), line("Wound dressing", "Service", 30, 1), line("Lab: Full Blood Count", "Service", 25, 1)],
      }];
      return [];
    },
    async search() { return { total: 0 }; },
  };
  it("counts quantity-multiplied and lab lines in revenue", async () => {
    clearAnalyticsCache();
    const s = await getSummary(fake, "clinic-a", "7d", now);
    const m = await getMoneyOps(fake, "clinic-a", "7d", now);
    expect(s.kpis.revenue.value).toBe(65);
    expect(m.revenue.value).toBe(65);
    expect(Object.fromEntries(m.revenue.sources.map((x) => [x.key, x.value]))).toEqual({ ubat: 10, prosedur: 30, lab: 25 });
  });
  it("does not cap consultations to 300 patients", async () => {
    clearAnalyticsCache();
    const s = await getSummary(fake, "clinic-a", "7d", now);
    expect(s.kpis.consultations.value).toBe(450);
  });
});
