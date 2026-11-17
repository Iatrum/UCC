import { describe, expect, it } from "bun:test";
import { searchPatientsPageInMedplum } from "../../lib/fhir/patient-service";
import { CLINIC_IDENTIFIER_SYSTEM } from "../../lib/fhir/clinic-tenancy";

const ident = (c: string) => ({ system: CLINIC_IDENTIFIER_SYSTEM, value: c });
const clinicOf = (r: any) => r.identifier?.find((i: any) => i.system === CLINIC_IDENTIFIER_SYSTEM)?.value;

const patients: any[] = [];
let n = 0;
function add(clinic: string, name: string, phone: string, nric: string) {
  n++;
  patients.push({
    resourceType: "Patient",
    id: `p${n}`,
    active: true,
    identifier: [ident(clinic), { system: "nric", value: nric }],
    name: [{ text: name }],
    telecom: [{ system: "phone", value: phone }],
    gender: "unknown",
    meta: { lastUpdated: new Date(2024, 0, 1, 0, 0, n).toISOString() },
  });
}
// 60 "Tan" patients in clinic-a (match lives on page 2+), plus a unique-phone one, plus clinic-b lookalikes
for (let i = 0; i < 60; i++) add("clinic-a", `Tan Person ${i}`, `01100000${String(i).padStart(2, "0")}`, `A${i}`);
add("clinic-a", "Zed Unique", "0123456789", "A-UNIQUE");
for (let i = 0; i < 5; i++) add("clinic-b", `Tan Other ${i}`, `0123456789`, `B${i}`);

const fake: any = {
  async readResource(_t: string, id: string) { return { resourceType: "Organization", id: `org-${id}` }; },
  async searchOne(type: string, params: any) { return { resourceType: type, id: `${type}-${params.identifier.split("|")[1]}` }; },
  async searchResources(_type: string, params: any) {
    let rows = patients.filter((p) => !params.active || String(p.active) === params.active);
    if (params["name:contains"]) rows = rows.filter((p) => p.name[0].text.toLowerCase().includes(params["name:contains"].toLowerCase()));
    if (params["phone:contains"]) rows = rows.filter((p) => p.telecom[0].value.includes(params["phone:contains"]));
    if (params.identifier) {
      const [sys, v] = params.identifier.split("|");
      rows = rows.filter((p) => p.identifier.some((i: any) => i.system === sys && i.value === v));
    }
    rows = [...rows].sort((a, b) => b.meta.lastUpdated.localeCompare(a.meta.lastUpdated));
    return rows.slice(0, Number(params._count ?? 20));
  },
};

describe("task 478: server-side paged patient search", () => {
  it("finds matches on page 2+ across the whole clinic", async () => {
    const p1 = await searchPatientsPageInMedplum("Tan", 1, 25, "clinic-a", fake);
    const p3 = await searchPatientsPageInMedplum("Tan", 3, 25, "clinic-a", fake);
    expect(p1.total).toBe(60);
    expect(p1.patients).toHaveLength(25);
    expect(p3.patients).toHaveLength(10);
    const all = new Set<string>();
    for (const pg of [1, 2, 3]) for (const p of (await searchPatientsPageInMedplum("Tan", pg, 25, "clinic-a", fake)).patients) all.add(p.id);
    expect(all.size).toBe(60);
    // oldest record (beyond the first page of 25) is reachable by a specific search
    const old = await searchPatientsPageInMedplum("Tan Person 0", 1, 25, "clinic-a", fake);
    expect(old.patients.some((p: any) => p.fullName === "Tan Person 0")).toBe(true);
  });

  it("phone search works (as typed and with separators)", async () => {
    for (const q of ["0123456789", "012-345 6789", "345678"]) {
      const r = await searchPatientsPageInMedplum(q, 1, 25, "clinic-a", fake);
      expect(r.patients.map((p: any) => p.fullName)).toEqual(["Zed Unique"]);
    }
  });

  it("NRIC search works", async () => {
    const r = await searchPatientsPageInMedplum("A-UNIQUE", 1, 25, "clinic-a", fake);
    expect(r.patients.map((p: any) => p.fullName)).toEqual(["Zed Unique"]);
  });

  it("clinic B patients never appear in clinic A results (and vice versa)", async () => {
    for (const q of ["Tan", "Other", "0123456789", "B1"]) {
      const r = await searchPatientsPageInMedplum(q, 1, 100, "clinic-a", fake);
      for (const p of r.patients) expect((p as any).fullName.includes("Other")).toBe(false);
    }
    const b = await searchPatientsPageInMedplum("0123456789", 1, 100, "clinic-b", fake);
    expect(b.total).toBe(5);
    expect(b.patients.every((p: any) => p.fullName.startsWith("Tan Other"))).toBe(true);
    expect(clinicOf(patients[patients.length - 1])).toBe("clinic-b");
  });

  it("fails closed without clinic and returns empty for blank query", async () => {
    await expect(searchPatientsPageInMedplum("Tan", 1, 25, null, fake)).rejects.toThrow();
    expect((await searchPatientsPageInMedplum("  ", 1, 25, "clinic-a", fake)).total).toBe(0);
  });
});
