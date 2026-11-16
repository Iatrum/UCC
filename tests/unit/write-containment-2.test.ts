import { describe, expect, it, mock } from "bun:test";
import type { MedplumClient } from "@medplum/core";

// Fake data only. Clinic-a user; p-b / enc-b belong to clinic-b.
const created: any[] = [];
const store: Record<string, any> = {
  "Patient/p-a": { resourceType: "Patient", id: "p-a", identifier: [{ system: "clinic", value: "clinic-a" }] },
  "Patient/p-b": { resourceType: "Patient", id: "p-b", identifier: [{ system: "clinic", value: "clinic-b" }] },
  "Encounter/enc-a": { resourceType: "Encounter", id: "enc-a", subject: { reference: "Patient/p-a" }, identifier: [{ system: "clinic", value: "clinic-a" }] },
  "Encounter/enc-b": { resourceType: "Encounter", id: "enc-b", subject: { reference: "Patient/p-b" }, identifier: [{ system: "clinic", value: "clinic-b" }] },
  "Encounter/enc-x": { resourceType: "Encounter", id: "enc-x", identifier: [{ system: "clinic", value: "clinic-a" }] },
  "Slot/s-b": { resourceType: "Slot", id: "s-b", status: "free", schedule: { reference: "Schedule/sch-b" }, start: "2030-01-01T01:00:00Z", end: "2030-01-01T01:30:00Z" },
  "Schedule/sch-b": { resourceType: "Schedule", id: "sch-b", identifier: [{ system: "urn:ucc:clinic-schedule", value: "clinic-b:pr1" }] },
};
const fake: any = {
  async readResource(type: string, id: string) {
    if (type === "Organization") return { resourceType: "Organization", id };
    const r = store[`${type}/${id}`];
    if (!r) throw Object.assign(new Error("not found"), { outcome: { id: "not-found", issue: [{ code: "not-found" }] } });
    return r;
  },
  async searchOne(type: string, q: any) {
    if (type === "HealthcareService") return { resourceType: "HealthcareService", id: `hs-${String(q.identifier).split("|")[1]}` };
    return undefined;
  },
  async searchResources() { return []; },
  async createResource(r: any) { created.push(r); return { ...r, id: `new-${created.length}` }; },
  async updateResource(r: any) { created.push(r); return r; },
  async post() { return {}; },
};
mock.module("@/lib/server/medplum-admin", () => ({ getAdminMedplum: async () => fake }));

const { bookSlotToAppointment, manualBookAppointmentWithSlot } = await import("../../lib/fhir/scheduling-service");
const { assertEncounterInClinic, makeClinicStamper } = await import("../../lib/fhir/write-containment");
const models = await import("../../lib/models");
const modelsConsultation = await import("../../lib/models/consultation");
const { exportConsultationToMedplum } = await import("../../lib/fhir/export-consultation");

const m = fake as MedplumClient;
const reject = async (p: Promise<unknown>) => {
  let err: any;
  try { await p; } catch (e) { err = e; }
  expect(err).toBeDefined();
  return err;
};
const fresh = () => { created.length = 0; };

describe("write-side clinic containment, round 2 (Task 350)", () => {
  it("bookSlotToAppointment rejects a foreign patient with zero writes", async () => {
    fresh();
    await reject(bookSlotToAppointment(m, "clinic-a", { slotId: "s-b", patientId: "p-b", reason: "x" } as any));
    expect(created.length).toBe(0);
  });

  it("bookSlotToAppointment rejects a foreign clinic's slot with forbidden (not a plain Error)", async () => {
    fresh();
    const err = await reject(bookSlotToAppointment(m, "clinic-a", { slotId: "s-b", patientId: "p-a", reason: "x" } as any));
    expect(err.outcome?.id).toBe("forbidden");
    expect(created.length).toBe(0);
  });

  it("manualBookAppointmentWithSlot rejects a foreign patient before creating a Schedule/Slot", async () => {
    fresh();
    await reject(manualBookAppointmentWithSlot(m, "clinic-a", {
      patientId: "p-b", practitionerId: "pr1", scheduledAt: "2999-01-01T01:00:00Z", durationMinutes: 30, reason: "x",
    } as any));
    expect(created.length).toBe(0);
  });

  it("assertEncounterInClinic: own ok; foreign/missing/patientless/no-clinic/malformed fail closed", async () => {
    expect(await assertEncounterInClinic(m, "clinic-a", "enc-a")).toBe("p-a");
    await reject(assertEncounterInClinic(m, "clinic-a", "enc-b"));
    await reject(assertEncounterInClinic(m, "clinic-a", "nope"));
    await reject(assertEncounterInClinic(m, "clinic-a", "enc-x"));
    await reject(assertEncounterInClinic(m, undefined, "enc-a"));
    await reject(assertEncounterInClinic(m, "clinic-a", "enc-a/../enc-b"));
  });

  it("updateConsultation (models.ts and models/consultation.ts) never writes for foreign or clinic-less callers", async () => {
    fresh();
    await reject(models.updateConsultation("enc-b", { notes: "n" } as any, "clinic-a"));
    await reject(models.updateConsultation("enc-a", { notes: "n" } as any));
    expect(await modelsConsultation.updateConsultation("enc-b", { notes: "n" } as any, "clinic-a")).toBe(false);
    expect(await modelsConsultation.updateConsultation("enc-a", { notes: "n" } as any)).toBe(false);
    expect(created.length).toBe(0);
  });

  it("updateConsultation writes a clinic-tagged Observation for an own-clinic encounter", async () => {
    fresh();
    await models.updateConsultation("enc-a", { notes: "n" } as any, "clinic-a");
    expect(await modelsConsultation.updateConsultation("enc-a", { notes: "n" } as any, "clinic-a")).toBe(true);
    expect(created.length).toBe(2);
    for (const o of created) {
      expect(o.subject.reference).toBe("Patient/p-a");
      expect(o.identifier).toContainEqual({ system: "clinic", value: "clinic-a" });
    }
  });

  it("exportConsultationToMedplum fails closed without clinic and tags resources with it", async () => {
    fresh();
    const c: any = { id: "c1", patientId: "p-a", date: new Date(), diagnosis: "Fake dx" };
    const res = await exportConsultationToMedplum(c, { name: "Fake Person", ic: "000000-00-0000" });
    expect(res.success).toBe(false);
    expect(created.length).toBe(0);
    const ok = await exportConsultationToMedplum(c, { name: "Fake Person", ic: "000000-00-0000" }, "clinic-a");
    expect(ok.success).toBe(true);
    expect(created.length).toBeGreaterThan(1);
    for (const r of created) expect(r.identifier).toContainEqual({ system: "clinic", value: "clinic-a" });
  });

  it("makeClinicStamper fails closed without a clinic and stamps identifier + account", async () => {
    await reject(makeClinicStamper(m, undefined));
    const { stamp } = await makeClinicStamper(m, "clinic-a");
    const r = stamp({ resourceType: "Patient" });
    expect(r.identifier).toContainEqual({ system: "clinic", value: "clinic-a" });
    expect(r.meta.accounts[0].reference).toBe("HealthcareService/hs-clinic-a");
  });
});
