import { describe, expect, it } from "bun:test";
import { CLINIC_IDENTIFIER_SYSTEM } from "../../lib/fhir/clinic-tenancy";
import { classifyLine, computeVisitStats, documentKind, isAntibiotic, pctChange, topCounts, toEncounterLite } from "../../lib/analytics/aggregate";
import { dayKeys, mytHour, mytWeekday, resolveRange } from "../../lib/analytics/range";
import { clearAnalyticsCache, getClinical, getMoneyOps, getSummary } from "../../lib/analytics/queries";

describe("Task 551 range (clinic time zone MYT)", () => {
  it("buckets by UTC+8 day/hour/weekday", () => {
    const d = new Date("2026-11-16T17:30:00Z"); // Tue 17 Nov 01:30 MYT
    expect(mytHour(d)).toBe(1);
    expect(mytWeekday(d)).toBe(1);
  });
  it("resolves ranges with an equal-length previous window", () => {
    const now = new Date("2026-11-17T05:00:00Z");
    const r = resolveRange("7d", now);
    expect(r.days).toBe(7);
    expect(r.prevTo.getTime()).toBe(r.from.getTime());
    expect(dayKeys(r.from, r.to).at(-1)).toBe("2026-11-17");
    expect(resolveRange("today", now).days).toBe(1);
    expect(resolveRange("month", now).days).toBe(17);
  });
});

describe("Task 551 aggregation", () => {
  const enc = (id: string, patient: string, start: string, triage?: string) => toEncounterLite({
    resourceType: "Encounter", id, status: "finished", class: { code: "AMB" }, subject: { reference: `Patient/${patient}` }, period: { start },
    extension: triage ? [{ url: "https://ucc.emr/triage-encounter", extension: [{ url: "queueAddedAt", valueDateTime: triage }] }] : undefined,
  } as never)!;
  it("computes unique visits, consultations, wait samples and heatmap", () => {
    const s = computeVisitStats([
      enc("1", "a", "2026-11-17T02:00:00Z", "2026-11-17T01:40:00Z"), // triage-ext encounter, queue 09:40 MYT
      enc("2", "a", "2026-11-17T01:55:00Z"), // consultation 09:55 -> 15 min wait? start is before triage enc start but after queue
      enc("3", "b", "2026-11-17T03:00:00Z"),
    ]);
    expect(s.patientsByDay["2026-11-17"]).toBe(2);
    expect(s.consultationsByDay["2026-11-17"]).toBe(2);
    expect(s.avgWait).toBe(15);
    expect(s.heatmap.flat().reduce((a, b) => a + b, 0)).toBe(2);
    expect(s.heatmap[1][9]).toBe(1);
  });
  it("gives no wait sample (not 0) without a queue timestamp", () => {
    expect(computeVisitStats([enc("1", "a", "2026-11-17T02:00:00Z")]).avgWait).toBeNull();
  });
  it("helpers", () => {
    expect(pctChange(110, 100)).toBe(10);
    expect(pctChange(5, 0)).toBeNull();
    expect(topCounts(["Flu", "flu", "Cough", undefined, " "], 5)).toEqual([{ name: "Flu", value: 2 }, { name: "Cough", value: 1 }]);
    expect(isAntibiotic("Amoxicillin 500mg")).toBe(true);
    expect(isAntibiotic("Paracetamol 500mg")).toBe(false);
    expect(documentKind('{"kind":"mc"}')).toBe("mc");
    expect(documentKind("plain text")).toBeNull();
    expect(classifyLine("Item", "Paracetamol")).toBe("ubat");
    expect(classifyLine("Service", "Lab: CBC")).toBe("lab");
    expect(classifyLine("Service", "Imaging: Chest X-ray (CR)")).toBe("xray");
    expect(classifyLine("Service", "Consultation fee")).toBe("konsultasi");
    expect(classifyLine("Document", "MC")).toBe("lain");
  });
});

describe("Task 551 queries stay clinic-scoped, bounded and results-free", () => {
  const ident = (c: string) => [{ system: CLINIC_IDENTIFIER_SYSTEM, value: c }];
  const calls: { type: string; q: URLSearchParams }[] = [];
  const now = new Date("2026-11-17T05:00:00Z");
  const fake: any = {
    async searchResources(type: string, q: URLSearchParams) {
      calls.push({ type, q: q instanceof URLSearchParams ? q : new URLSearchParams(q as never) });
      if (type === "Encounter") return [
        { resourceType: "Encounter", id: "e1", identifier: ident("clinic-a"), subject: { reference: "Patient/p1" }, period: { start: "2026-11-17T02:00:00Z" } },
        { resourceType: "Encounter", id: "leak", identifier: ident("clinic-b"), subject: { reference: "Patient/p9" }, period: { start: "2026-11-17T02:00:00Z" } },
      ];
      if (type === "Condition") return [{ resourceType: "Condition", id: "c1", identifier: ident("clinic-a"), code: { text: "Flu" }, recordedDate: "2026-11-17T02:00:00Z" }, { resourceType: "Condition", id: "c2", identifier: ident("clinic-b"), code: { text: "SECRET" }, recordedDate: "2026-11-17T02:00:00Z" }];
      if (type === "Invoice") return [{ resourceType: "Invoice", id: "i1", status: "balanced", date: "2026-11-17T03:00:00Z", identifier: ident("clinic-a"), totalGross: { value: 50 }, lineItem: [{ chargeItemCodeableConcept: { text: "Paracetamol" }, priceComponent: [{ amount: { value: 50 } }], extension: [{ url: "https://ucc.emr/invoice/line-item-type", valueString: "Item" }] }] },
        { resourceType: "Invoice", id: "i2", status: "balanced", date: "2026-11-17T03:00:00Z", identifier: ident("clinic-b"), totalGross: { value: 999 } }];
      if (type === "ServiceRequest") return [{ resourceType: "ServiceRequest", id: "s1", identifier: ident("clinic-a"), authoredOn: "2026-11-17T02:00:00Z", meta: { tag: [{ system: "https://ucc.emr/poct", code: "poct" }] } }];
      return [];
    },
    async search() { return { total: 0 }; },
  };
  it("filters foreign rows and never reads result resources", async () => {
    clearAnalyticsCache(); calls.length = 0;
    const s = await getSummary(fake, "clinic-a", "7d", now);
    const c = await getClinical(fake, "clinic-a", "7d", now);
    const m = await getMoneyOps(fake, "clinic-a", "7d", now);
    expect(s.kpis.patientsToday.value).toBe(1);
    expect(s.kpis.revenue.value).toBe(50);
    expect(s.topDiagnoses).toEqual([{ name: "Flu", value: 1 }]);
    expect(JSON.stringify([s, c, m])).not.toContain("SECRET");
    expect(c.orders.totals.poct).toBe(1);
    expect(m.revenue.sources).toEqual([{ key: "ubat", label: "Ubat", value: 50 }]);
    expect(calls.every((x) => x.q.get("identifier") === `${CLINIC_IDENTIFIER_SYSTEM}|clinic-a`)).toBe(true);
    expect(calls.some((x) => ["Observation", "DiagnosticReport"].includes(x.type))).toBe(false);
    expect(calls.filter((x) => x.type !== "Medication").every((x) => x.q.get("_count") === "1000")).toBe(true);
  });
  it("caches identical requests briefly (no refetch)", async () => {
    clearAnalyticsCache(); calls.length = 0;
    await getSummary(fake, "clinic-a", "7d", now);
    const first = calls.length;
    await getSummary(fake, "clinic-a", "7d", now);
    expect(calls.length).toBe(first); // loaders are cached per clinic + window
  });
});
