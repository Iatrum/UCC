import { describe, expect, it } from "bun:test";
import {
  getClinicConsultationsFromMedplum,
  getPatientConsultationsFromMedplum,
} from "../../lib/fhir/consultation-service";
import { computeAnalytics } from "../../lib/analytics/compute";
import { CLINIC_IDENTIFIER_SYSTEM } from "../../lib/fhir/clinic-tenancy";

const ident = (c: string) => ({ system: CLINIC_IDENTIFIER_SYSTEM, value: c });
const encs: any[] = [];
const procs: any[] = [];
const meds: any[] = [];
const conds: any[] = [];
let seq = 0;
function addEnc(clinic: string, patient: string, start: string, diagnosis?: string) {
  const id = `e${++seq}`;
  encs.push({
    resourceType: "Encounter", id,
    identifier: [ident(clinic), { system: "firebase-patient", value: patient }],
    period: { start }, meta: { lastUpdated: start },
  });
  if (diagnosis) conds.push({ resourceType: "Condition", id: `c${id}`, encounter: { reference: `Encounter/${id}` }, code: { text: diagnosis } });
  procs.push({ resourceType: "Procedure", id: `p${id}`, encounter: { reference: `Encounter/${id}` }, code: { text: "x" } });
  meds.push({ resourceType: "MedicationRequest", id: `m${id}`, encounter: { reference: `Encounter/${id}` } });
}
// clinic-a: 250 encounters across 5 patients (> one child batch of 100, < one page); clinic-b noise
for (let i = 0; i < 250; i++) addEnc("clinic-a", `pa${i % 5}`, new Date(Date.UTC(2026, 0, 1 + (i % 28))).toISOString(), i % 2 ? "Flu" : "Cough");
for (let i = 0; i < 40; i++) addEnc("clinic-b", `pb${i % 3}`, "2026-02-01T00:00:00.000Z", "SECRET");

const calls: { type: string; params: any }[] = [];
const fake: any = {
  async searchResources(type: string, params: any) {
    calls.push({ type, params });
    const table: any[] = { Encounter: encs, Procedure: procs, MedicationRequest: meds, Condition: conds, Observation: [] }[type] ?? [];
    let rows = table;
    if (params.identifier) {
      const [sys, val] = params.identifier.split("|");
      rows = rows.filter((r) => r.identifier?.some((i: any) => i.system === sys && i.value === val));
    }
    if (params.encounter) {
      const refs = new Set(params.encounter.split(","));
      rows = rows.filter((r) => refs.has(r.encounter?.reference));
    }
    if (params._sort === "-date") rows = [...rows].sort((a, b) => b.period.start.localeCompare(a.period.start));
    const offset = Number(params._offset ?? 0);
    const count = Number(params._count ?? 20);
    return rows.slice(offset, offset + count);
  },
};

describe("Task 502 analytics consultations", () => {
  it("fetches clinic consultations in a constant number of queries, all clinic-scoped", async () => {
    calls.length = 0;
    const out = await getClinicConsultationsFromMedplum("clinic-a", fake);
    expect(out.length).toBe(250);
    expect(out.some((c) => c.diagnosis === "SECRET")).toBe(false);
    expect(out.every((c) => c.patientId.startsWith("pa"))).toBe(true);
    // 1 encounter page + 3 child searches x 3 batches (250/100)
    expect(calls.length).toBe(1 + 3 * 3);
    expect(calls.filter((c) => c.type === "Encounter").every((c) => c.params.identifier === `${CLINIC_IDENTIFIER_SYSTEM}|clinic-a`)).toBe(true);
    expect(calls.filter((c) => c.type === "Observation").length).toBe(0);
  });

  it("pages encounters past 1000 without dropping any", async () => {
    const before = encs.length;
    for (let i = 0; i < 1100; i++) addEnc("clinic-c", `pc${i % 7}`, "2026-03-01T00:00:00.000Z");
    const out = await getClinicConsultationsFromMedplum("clinic-c", fake);
    expect(out.length).toBe(1100);
    encs.length = before; procs.length = before; meds.length = before;
  });

  it("yields the same aggregates as the per-patient reader (given the same data)", async () => {
    const patients = [0, 1, 2, 3, 4].map((i) => ({ id: `pa${i}`, gender: "female", dateOfBirth: "1990-01-01" }));
    // per-patient reader returns only the 20 newest clinic encounters in the fake (default _count), so compare on a
    // clinic-sized-below-20 slice: use a tiny clinic.
    for (let i = 0; i < 6; i++) addEnc("clinic-t", `pt${i % 2}`, new Date().toISOString(), "Flu");
    const tp = [{ id: "pt0", gender: "male" }, { id: "pt1", gender: "male" }];
    const perPatient = (await Promise.all(tp.map((p) => getPatientConsultationsFromMedplum(p.id, "clinic-t", fake)))).flat();
    const batched = await getClinicConsultationsFromMedplum("clinic-t", fake);
    const now = new Date();
    const a = computeAnalytics(tp, perPatient, 2, now);
    const b = computeAnalytics(tp, batched, 2, now);
    expect(b).toEqual(a);
    expect(b.diagnosisTop).toEqual([{ name: "Flu", value: 6 }]);
    expect(patients.length).toBe(5);
  });
});
