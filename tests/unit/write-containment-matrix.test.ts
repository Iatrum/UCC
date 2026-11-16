import { describe, expect, it, mock } from "bun:test";
import { OperationOutcomeError, notFound, type MedplumClient } from "@medplum/core";

// Task 396: every patient-referencing CREATE path, one clinic-A caller, fake data only.
// Foreign (clinic-B) patient => forbidden (route-helpers maps to 403) and ZERO writes;
// own-clinic patient => resource created.
const created: any[] = [];
const store: Record<string, any> = {
  "Patient/p-a": { resourceType: "Patient", id: "p-a", identifier: [{ system: "clinic", value: "clinic-a" }] },
  "Patient/p-b": { resourceType: "Patient", id: "p-b", identifier: [{ system: "clinic", value: "clinic-b" }] },
  "Encounter/enc-a": { resourceType: "Encounter", id: "enc-a", subject: { reference: "Patient/p-a" }, identifier: [{ system: "clinic", value: "clinic-a" }] },
  "Encounter/enc-b": { resourceType: "Encounter", id: "enc-b", subject: { reference: "Patient/p-b" }, identifier: [{ system: "clinic", value: "clinic-b" }] },
};
const fake: any = {
  async readResource(type: string, id: string) {
    if (type === "Organization") return { resourceType: "Organization", id };
    const r = store[`${type}/${id}`];
    if (!r) throw new OperationOutcomeError(notFound);
    return r;
  },
  async searchOne(type: string, q: any) {
    if (type === "HealthcareService") return { resourceType: "HealthcareService", id: `hs-${String(q.identifier).split("|")[1]}` };
    if (q._id) {
      const r = store[`${type}/${q._id}`];
      const clinic = String(q.identifier ?? "").split("|")[1];
      return r && (!clinic || r.identifier?.some((i: any) => i.system === "clinic" && i.value === clinic)) ? r : undefined;
    }
    return undefined;
  },
  async searchResources() { return []; },
  async createResource(r: any) {
    created.push(r);
    const saved = { ...r, id: `new-${created.length}` };
    store[`${r.resourceType}/${saved.id}`] = saved;
    return saved;
  },
  async createResourceIfNoneExist(r: any) { created.push(r); return { ...r, id: `new-${created.length}` }; },
  async updateResource(r: any) { created.push(r); return r; },
  async post() { return {}; },
};
mock.module("@/lib/server/medplum-admin", () => ({ getAdminMedplum: async () => fake }));

const { createLabOrder } = await import("../../lib/fhir/lab-service");
const { createImagingOrder } = await import("../../lib/fhir/imaging-service");
const { saveReferralToMedplum } = await import("../../lib/fhir/referral-service");
const { createPatientDocument } = await import("../../lib/fhir/document-service");
const { saveAppointmentToMedplum } = await import("../../lib/fhir/appointment-service");
const { createFollowUp } = await import("../../lib/fhir/communication-service");
const { saveConsultationToMedplum } = await import("../../lib/fhir/consultation-service");
const { toFhirMedicationRequest } = await import("../../lib/fhir/mappers");
const { handleRouteError } = await import("../../lib/server/route-helpers");

const m = fake as MedplumClient;
const A = "clinic-a";

type Case = { name: string; run: (patientId: string, encounterId: string) => Promise<unknown> };
const cases: Case[] = [
  { name: "createLabOrder", run: (p, e) => createLabOrder({ patientId: p, encounterId: e, tests: [{ code: "1234-5", display: "Fake test" }] } as any, m, A) },
  { name: "createImagingOrder", run: (p, e) => createImagingOrder({ patientId: p, encounterId: e, procedures: [{ code: "FAKE", display: "Fake study", modality: "DX" }] } as any, m, A) },
  { name: "saveReferralToMedplum", run: (p) => saveReferralToMedplum(m, { patientId: p, specialty: "ENT", facility: "Fake Hosp", reason: "t", urgency: "routine" } as any, A) },
  { name: "createPatientDocument (MC/letter)", run: (p) => createPatientDocument(m, { patientId: p, clinicId: A, title: "Fake MC", url: "https://example.invalid/x.pdf" } as any) },
  { name: "saveAppointmentToMedplum", run: (p) => saveAppointmentToMedplum(m, { patientId: p, patientName: "Fake", clinician: "Dr Fake", reason: "x", scheduledAt: new Date(), status: "booked" } as any, A) },
  { name: "createFollowUp", run: (p) => createFollowUp(m, { patientId: p, patientName: "Fake", clinicId: A, type: "review-request", message: "hi" } as any) },
  {
    name: "saveConsultationToMedplum (prescriptions => MedicationRequest)",
    run: (p) => saveConsultationToMedplum(
      { patientId: p, prescriptions: [{ medication: { name: "Fakecillin" }, dosage: "1", frequency: "bd", duration: "3d" }], date: new Date() } as any,
      { id: p, name: "Fake Patient" }, A, m),
  },
  { name: "toFhirMedicationRequest (mapper)", run: (p, e) => toFhirMedicationRequest(`Patient/${p}`, `Encounter/${e}`, { medication: { name: "Fakecillin" } } as any, A, m) },
];

describe("write containment matrix (Task 396)", () => {
  for (const c of cases) {
    it(`${c.name}: foreign patient => forbidden, zero writes`, async () => {
      created.length = 0;
      let err: any;
      try { await c.run("p-b", "enc-b"); } catch (e) { err = e; }
      expect(err).toBeDefined();
      const res = handleRouteError(err, "test");
      expect(res.status).toBe(403);
      expect(created.length).toBe(0);
    });
    it(`${c.name}: own-clinic patient => created`, async () => {
      created.length = 0;
      await c.run("p-a", "enc-a");
      expect(created.length).toBeGreaterThan(0);
    });
  }
});
