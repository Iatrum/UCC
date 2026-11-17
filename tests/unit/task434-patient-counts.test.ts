import { describe, expect, it } from "bun:test";
import {
  countNewPatientsThisMonth,
  countPatientsInMedplum,
  getPatientsPageFromMedplum,
} from "../../lib/fhir/patient-service";
import { CLINIC_IDENTIFIER_SYSTEM } from "../../lib/fhir/clinic-tenancy";

const CLINICS = ["clinic-a", "clinic-b", "clinic-c", "clinic-d"];
// Distinct sizes so any cross-clinic leak changes the number. clinic-a > 200 (old page cap).
const SIZES: Record<string, number> = { "clinic-a": 230, "clinic-b": 7, "clinic-c": 13, "clinic-d": 3 };

const ident = (c: string) => ({ system: CLINIC_IDENTIFIER_SYSTEM, value: c });
const clinicOf = (r: any) => r.identifier?.find((i: any) => i.system === CLINIC_IDENTIFIER_SYSTEM)?.value;

const patients: any[] = [];
let n = 0;
for (const c of CLINICS) {
  for (let i = 0; i < SIZES[c]; i++) {
    n++;
    patients.push({
      resourceType: "Patient",
      id: `p${n}`,
      active: true,
      identifier: [ident(c)],
      name: [{ text: `${c} patient ${i}` }],
      gender: "unknown",
      managingOrganization: { reference: `Organization/org-${c}` },
      // first 2 of each clinic are "this month", others last year
      meta: { lastUpdated: i < 2 ? new Date().toISOString() : "2020-01-01T00:00:00.000Z" },
    });
  }
}
patients.push({ ...patients[0], id: "inactive", active: false, identifier: [ident("clinic-b")] });

const calls: any[] = [];
const fake: any = {
  async readResource(_t: string, id: string) {
    return { resourceType: "Organization", id: `org-${id}` };
  },
  async searchOne(type: string, params: any) {
    const slug = params.identifier.split("|")[1];
    return { resourceType: type, id: `${type}-${slug}` };
  },
  async search(type: string, params: any) {
    calls.push(params);
    let rows = patients.filter((p) => !params.active || String(p.active) === params.active);
    if (params.identifier) {
      const [, v] = params.identifier.split("|");
      rows = rows.filter((p) => clinicOf(p) === v);
    }
    if (params._lastUpdated) {
      const from = params._lastUpdated.slice(2);
      rows = rows.filter((p) => p.meta.lastUpdated >= from);
    }
    const bundle: any = { resourceType: "Bundle", type: "searchset", total: rows.length };
    if (params._summary === "count") return bundle;
    const off = Number(params._offset ?? 0);
    bundle.entry = rows.slice(off, off + Number(params._count)).map((resource) => ({ resource }));
    return bundle;
  },
};

describe("task 434: clinic-scoped patient counts", () => {
  it("counts the full clinic (beyond the old 200 cap) via _summary=count + _total=accurate", async () => {
    expect(await countPatientsInMedplum("clinic-a", fake)).toBe(230);
    const last = calls[calls.length - 1];
    expect(last._summary).toBe("count");
    expect(last._total).toBe("accurate");
    expect(last.identifier).toBe(`${CLINIC_IDENTIFIER_SYSTEM}|clinic-a`);
  });

  it("4-clinic isolation: every clinic's count excludes the other three (and inactive)", async () => {
    for (const c of CLINICS) {
      expect(await countPatientsInMedplum(c, fake)).toBe(SIZES[c]);
      expect(await countNewPatientsThisMonth(c, fake)).toBe(2);
    }
  });

  it("pages reach patients past the first page and never include other clinics", async () => {
    const seen = new Set<string>();
    let total: number | null = null;
    for (let page = 1; page <= 10; page++) {
      const res = await getPatientsPageFromMedplum(page, 25, "clinic-a", fake);
      total = res.total;
      for (const p of res.patients) {
        expect((p as any).fullName.startsWith("clinic-a")).toBe(true);
        seen.add(p.id);
      }
    }
    expect(total).toBe(230);
    expect(seen.size).toBe(230); // 10 pages x 25 = 250 >= 230, all reachable, no dupes
    const small = await getPatientsPageFromMedplum(1, 25, "clinic-d", fake);
    expect(small.patients).toHaveLength(3);
    expect(small.total).toBe(3);
  });

  it("clamps page size and returns null total when server omits it", async () => {
    const res = await getPatientsPageFromMedplum(1, 5000, "clinic-a", fake);
    expect(res.pageSize).toBe(100);
    expect(res.patients).toHaveLength(100);
    const noTotal: any = { ...fake, search: async () => ({ resourceType: "Bundle", entry: [] }) };
    expect(await countPatientsInMedplum("clinic-b", noTotal)).toBeNull();
  });

  it("fails closed without a clinic and returns empty past the offset ceiling", async () => {
    await expect(countPatientsInMedplum(undefined, fake)).rejects.toThrow();
    await expect(getPatientsPageFromMedplum(1, 25, null, fake)).rejects.toThrow();
    const far = await getPatientsPageFromMedplum(500, 25, "clinic-a", fake);
    expect(far.patients).toHaveLength(0);
  });
});
