import { describe, expect, it } from "bun:test";
import { CLINIC_IDENTIFIER_SYSTEM } from "../../lib/fhir/clinic-tenancy";
import { clearAnalyticsCache, getClinical } from "../../lib/analytics/queries";

// Task 564: age/gender charts are exact per-clinic counts (_summary=count), never a sample of the newest 300 patients,
// and most-dispensed filters on MedicationDispense.whenHandedOver (verified search param on Medplum 5.2.8). Fake data only.
describe("analytics exact age/gender + dispense window", () => {
  const now = new Date("2026-11-17T05:00:00Z");
  const patientCalls: Record<string, any>[] = [];
  const dispenseCalls: URLSearchParams[] = [];
  const fake: any = {
    async searchResources(type: string, q: any) {
      const query = new URLSearchParams(q);
      if (type === "MedicationDispense") {
        dispenseCalls.push(query);
        return [
          { resourceType: "MedicationDispense", id: "d1", status: "completed", medicationReference: { display: "Fake Para" }, quantity: { value: 10 }, identifier: [{ system: CLINIC_IDENTIFIER_SYSTEM, value: "clinic-a" }], meta: { tag: [] } },
          { resourceType: "MedicationDispense", id: "d2", status: "completed", medicationReference: { display: "Fake Para" }, quantity: { value: 5 }, identifier: [{ system: CLINIC_IDENTIFIER_SYSTEM, value: "clinic-a" }] },
        ];
      }
      return [];
    },
    async search(type: string, q: any) {
      const params = q instanceof URLSearchParams ? q : new URLSearchParams(typeof q === "string" ? q : Object.entries(q ?? {}).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => [k, String(x)])) as string[][]);
      if (type === "Patient") {
        patientCalls.push({ gender: params.get("gender"), birthdate: params.getAll("birthdate"), identifier: params.get("identifier"), summary: params.get("_summary"), count: params.get("_count") });
        return { total: params.get("gender") === "male" ? 7 : 3 };
      }
      return { total: 0 };
    },
  };

  it("builds exact clinic-filtered counts per gender x age bucket without fetching patients", async () => {
    clearAnalyticsCache();
    const c = await getClinical(fake, "clinic-a", "7d", now);
    const gendered = patientCalls.filter((p) => p.gender);
    expect(gendered.length).toBe(8); // 4 buckets x 2 genders, all count-only
    for (const p of gendered) {
      expect(p.summary).toBe("count");
      expect(p.identifier).toContain("clinic-a");
    }
    expect(c.ageGender!.map((r) => r.bucket)).toEqual(["0-17", "18-39", "40-64", "65+"]);
    for (const row of c.ageGender!) expect([row.male, row.female]).toEqual([7, 3]);
    // buckets are contiguous and non-overlapping: 0-17 = after 2008-11-17, 65+ = on/before 1961-11-17
    const has = (bd: string[]) => gendered.some((p) => p.gender === "male" && JSON.stringify(p.birthdate) === JSON.stringify(bd));
    expect(has(["gt2008-11-17"])).toBe(true);
    expect(has(["le1961-11-17"])).toBe(true);
    expect(has(["gt1986-11-17", "le2008-11-17"])).toBe(true); // 18-39
    expect(has(["gt1961-11-17", "le1986-11-17"])).toBe(true); // 40-64
  });

  it("filters most-dispensed by whenhandedover, not _lastUpdated", async () => {
    clearAnalyticsCache();
    const c = await getClinical(fake, "clinic-a", "7d", now);
    const q = dispenseCalls[0];
    expect(q.getAll("whenhandedover").length).toBe(2);
    expect(q.has("_lastUpdated")).toBe(false);
    expect(q.get("status")).toBe("completed");
    expect(c.mostDispensed[0]).toEqual({ name: "Fake Para", value: 15 });
  });
});
