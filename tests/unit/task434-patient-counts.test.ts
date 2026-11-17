import { describe, expect, it } from "bun:test";
import {
  countNewPatientsThisMonth,
  countPatientsInMedplum,
  getPatientsPageFromMedplum,
} from "../../lib/fhir/patient-service";
import {
  REGISTERED_TAG_SYSTEM,
  clinicYmd,
  getRegistrationDate,
  registeredThisMonthTagParam,
  withRegistrationTag,
} from "../../lib/fhir/patient-registration";
import { CLINIC_IDENTIFIER_SYSTEM } from "../../lib/fhir/clinic-tenancy";

const CLINICS = ["clinic-a", "clinic-b", "clinic-c", "clinic-d"];
// Distinct sizes so any cross-clinic leak changes the number. clinic-a > 200 (old page cap).
const SIZES: Record<string, number> = { "clinic-a": 230, "clinic-b": 7, "clinic-c": 13, "clinic-d": 3 };

const ident = (c: string) => ({ system: CLINIC_IDENTIFIER_SYSTEM, value: c });
const clinicOf = (r: any) => r.identifier?.find((i: any) => i.system === CLINIC_IDENTIFIER_SYSTEM)?.value;

const ymdToday = clinicYmd(new Date());
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
      // first 2 of each clinic registered today; all are edited today (lastUpdated must not matter)
      meta: {
        lastUpdated: new Date().toISOString(),
        tag: i < 2 ? [{ system: REGISTERED_TAG_SYSTEM, code: ymdToday }] : i === 2 ? [{ system: REGISTERED_TAG_SYSTEM, code: "2020-01-01" }] : [],
      },
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
    if (params._tag) {
      const wanted = new Set<string>(params._tag.split(","));
      rows = rows.filter((p) => p.meta.tag.some((t: any) => wanted.has(`${t.system}|${t.code}`)));
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

describe("task 527: registration date tag", () => {
  it("edited-this-month legacy/old patients are not counted as new", async () => {
    // every patient has lastUpdated = now, only 2 per clinic carry a this-month registration tag
    expect(await countNewPatientsThisMonth("clinic-a", fake)).toBe(2);
  });

  it("stamps a registration tag once and keeps existing tags", () => {
    const now = new Date(Date.UTC(2026, 10, 5, 4));
    const p = withRegistrationTag({ meta: { tag: [{ system: "x", code: "y" }] } } as any, now);
    expect(p.meta!.tag).toEqual([{ system: "x", code: "y" }, { system: REGISTERED_TAG_SYSTEM, code: "2026-11-05" }]);
    expect(withRegistrationTag(p, new Date(Date.UTC(2027, 0, 1, 4)))).toBe(p);
    expect(getRegistrationDate(p)).toBe("2026-11-05");
    expect(getRegistrationDate({})).toBeUndefined();
  });

  it("month param covers day 1..today only", () => {
    const parts = registeredThisMonthTagParam(new Date(Date.UTC(2026, 1, 3, 4))).split(",");
    expect(parts).toEqual([1, 2, 3].map((d) => `${REGISTERED_TAG_SYSTEM}|2026-02-0${d}`));
  });

  it("uses the Asia/Kuala_Lumpur date, not server-local, around midnight MYT", () => {
    // 2026-11-30T16:30Z is 2026-12-01 00:30 MYT; a UTC server would say Nov 30.
    const justAfterMidnightMyt = new Date("2026-11-30T16:30:00Z");
    expect(clinicYmd(justAfterMidnightMyt)).toBe("2026-12-01");
    expect(getRegistrationDate(withRegistrationTag({} as any, justAfterMidnightMyt))).toBe("2026-12-01");
    // 2026-11-30T15:59Z is still Nov 30, 23:59 MYT
    expect(clinicYmd(new Date("2026-11-30T15:59:00Z"))).toBe("2026-11-30");
    // New MYT month: only Dec 1 counts, no November days leak in
    expect(registeredThisMonthTagParam(justAfterMidnightMyt)).toBe(`${REGISTERED_TAG_SYSTEM}|2026-12-01`);
    // Late UTC on the 31st of a month is already the 1st in MYT (year rollover)
    expect(clinicYmd(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
    // Earlier in the MYT day (still previous UTC day) month range spans the full MYT month so far
    const parts = registeredThisMonthTagParam(new Date("2026-02-02T17:00:00Z")).split(",");
    expect(parts).toEqual([1, 2, 3].map((d) => `${REGISTERED_TAG_SYSTEM}|2026-02-0${d}`));
  });
});
