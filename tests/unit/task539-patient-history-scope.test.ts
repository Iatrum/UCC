import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { getPatientConsultationsFromMedplum } from "../../lib/fhir/consultation-service";
import { CLINIC_IDENTIFIER_SYSTEM } from "../../lib/fhir/clinic-tenancy";

const ident = (c: string) => ({ system: CLINIC_IDENTIFIER_SYSTEM, value: c });
const encs: any[] = [];
let seq = 0;
function addEnc(clinic: string, patient: string, day: number) {
  encs.push({
    resourceType: "Encounter",
    id: `e${++seq}`,
    identifier: [ident(clinic), { system: "firebase-patient", value: patient }],
    period: { start: new Date(Date.UTC(2020, 0, 1 + day)).toISOString() },
  });
}

// Mimics Medplum: honours repeated identifier params (AND), _sort=-date, _offset and a default page size of 20.
// `ignoreServerFilter` simulates a server that drops the scoping params to prove the in-code guard still holds.
function makeFake(opts: { ignoreServerFilter?: boolean } = {}) {
  const calls: { type: string; query: URLSearchParams | Record<string, string> }[] = [];
  const client: any = {
    async searchResources(type: string, query: any) {
      calls.push({ type, query });
      const q: URLSearchParams = query instanceof URLSearchParams ? query : new URLSearchParams(query);
      let rows: any[] = type === "Encounter" ? encs : [];
      if (!opts.ignoreServerFilter) {
        for (const token of q.getAll("identifier")) {
          const [sys, val] = token.split("|");
          rows = rows.filter((r) => r.identifier?.some((i: any) => i.system === sys && i.value === val));
        }
      }
      if (q.get("_sort") === "-date") rows = [...rows].sort((a, b) => b.period.start.localeCompare(a.period.start));
      const offset = Number(q.get("_offset") ?? 0);
      const count = Number(q.get("_count") ?? 20);
      return rows.slice(offset, offset + count);
    },
  };
  return { client, calls };
}

// clinic-a: target patient has 130 consults (> 100 page size, > default 20), buried under 130 newer rows of another
// patient; clinic-b holds the same patient id (5 rows) which must never leak into clinic-a and vice versa.
for (let i = 0; i < 130; i++) addEnc("clinic-a", "p-target", i);
for (let i = 0; i < 130; i++) addEnc("clinic-a", "p-noise", 1000 + i);
for (let i = 0; i < 5; i++) addEnc("clinic-b", "p-target", 2000 + i);

describe("Task 539 patient consultation history scoping", () => {
  it("returns the full history beyond the default and per-request page size", async () => {
    const { client } = makeFake();
    const out = await getPatientConsultationsFromMedplum("p-target", "clinic-a", client);
    expect(out.length).toBe(130);
    expect(new Set(out.map((c) => c.id)).size).toBe(130);
    expect(out.every((c) => c.patientId === "p-target")).toBe(true);
  });

  it("is sorted newest first", async () => {
    const { client } = makeFake();
    const out = await getPatientConsultationsFromMedplum("p-target", "clinic-a", client);
    for (let i = 1; i < out.length; i++) expect(+out[i - 1].date).toBeGreaterThanOrEqual(+out[i].date);
  });

  it("scopes the Encounter search server-side to patient AND clinic, and pages it", async () => {
    const { client, calls } = makeFake();
    await getPatientConsultationsFromMedplum("p-target", "clinic-a", client);
    const encCalls = calls.filter((c) => c.type === "Encounter").map((c) => c.query as URLSearchParams);
    expect(encCalls.length).toBe(2); // 100 + 30
    for (const q of encCalls) {
      expect(q.getAll("identifier").sort()).toEqual(
        [`${CLINIC_IDENTIFIER_SYSTEM}|clinic-a`, "firebase-patient|p-target"].sort()
      );
      expect(q.get("_sort")).toBe("-date");
    }
    expect(encCalls.map((q) => q.get("_offset"))).toEqual(["0", "100"]);
  });

  it("never returns encounters of a foreign clinic for the same patient id", async () => {
    const { client } = makeFake();
    const a = await getPatientConsultationsFromMedplum("p-target", "clinic-a", client);
    const b = await getPatientConsultationsFromMedplum("p-target", "clinic-b", client);
    expect(a.length).toBe(130);
    expect(b.length).toBe(5);
    expect(await getPatientConsultationsFromMedplum("p-target", "clinic-zzz", client)).toEqual([]);
    expect(a.every((c) => +c.date < Date.UTC(2020, 0, 1 + 1000))).toBe(true);
  });

  it("guard: foreign-clinic and other-patient rows are dropped even if the server ignores the scoping params", async () => {
    const { client } = makeFake({ ignoreServerFilter: true });
    const out = await getPatientConsultationsFromMedplum("p-target", "clinic-b", client);
    expect(out.length).toBe(5);
    const a = await getPatientConsultationsFromMedplum("p-target", "clinic-a", client);
    // 130 a-rows + 130 noise + 5 b-rows are all served; only clinic-a rows of p-target survive.
    expect(a.length).toBe(130);
  });

  it("source keeps the in-code clinic and patient guards (removal must fail a test)", () => {
    const src = readFileSync("lib/fhir/consultation-service.ts", "utf8");
    const start = src.indexOf("export async function getPatientConsultationsFromMedplum");
    const body = src.slice(start, src.indexOf("\nconst CLINIC_CONSULTATIONS_PAGE", start));
    expect(body).toContain("matchesClinic(enc as any, clinicId)");
    expect(body).toContain("id.value === firebasePatientId");
    expect(body).toContain("`${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}`");
  });
});
