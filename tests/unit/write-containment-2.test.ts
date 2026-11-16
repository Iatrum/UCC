import { describe, expect, it, mock } from "bun:test";
import { OperationOutcomeError, notFound, type MedplumClient } from "@medplum/core";

// Fake data only. Clinic-a user; p-b / enc-b belong to clinic-b.
const created: any[] = [];
const searches: any[] = [];
let searchResults: any[] = [];
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
    if (!r) throw new OperationOutcomeError(notFound);
    return r;
  },
  async searchOne(type: string, q: any) {
    if (type === "HealthcareService") return { resourceType: "HealthcareService", id: `hs-${String(q.identifier).split("|")[1]}` };
    return undefined;
  },
  async searchResources(type: string, query: any, options: any) {
    searches.push({ type, query, options });
    return type === 'Patient' ? searchResults : [];
  },
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

const { createBillingExceptionTask } = await import('../../lib/fhir/billing-task-service');
const { completeCheckoutInvoice } = await import('../../lib/fhir/billing-service');
const { saveConsultationToMedplum, updateConsultationInMedplum } = await import('../../lib/fhir/consultation-service');
const { toFhirPatient, toFhirEncounter, toFhirCondition, toFhirMedicationRequest, toFhirServiceRequest } = await import('../../lib/fhir/mappers');
const { assertPatientInClinic } = await import('../../lib/fhir/write-containment');
const m = fake as MedplumClient;
const reject = async (p: Promise<unknown>) => {
  let err: any;
  try { await p; } catch (e) { err = e; }
  expect(err).toBeDefined();
  return err;
};
const fresh = () => { created.length = 0; searches.length = 0; searchResults = []; };

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

describe('Task 351 independent review regressions', () => {
  it('missing clinic and conflicting patient accounts fail with forbidden, before any write', async () => {
    fresh();
    expect((await reject(assertPatientInClinic(m, undefined, 'p-a'))).outcome.id).toBe('forbidden');
    store['Patient/p-conflict'] = { ...store['Patient/p-a'], id: 'p-conflict', meta: { accounts: [{ reference: 'HealthcareService/hs-clinic-b' }] } };
    expect((await reject(assertPatientInClinic(m, 'clinic-a', 'p-conflict'))).outcome.id).toBe('forbidden');
    expect(created).toHaveLength(0);
  });

  it('exports search inside the clinic compartment and refuse misleading/mixed account candidates', async () => {
    fresh();
    searchResults = [{ ...store['Patient/p-a'], id: 'misleading', meta: { accounts: [{ reference: 'HealthcareService/hs-clinic-b' }] } }];
    const c: any = { id: 'fake-c', date: new Date('2030-01-01'), diagnosis: 'Fake' };
    expect((await exportConsultationToMedplum(c, { name: 'Fake', ic: '000000-00-0000' }, 'clinic-a')).success).toBe(true);
    expect(searches[0].query).toEqual({ identifier: '000000-00-0000', _compartment: 'HealthcareService/hs-clinic-a' });
    expect(searches[0].options.headers['X-Medplum']).toBe('extended');
    expect(created[0].resourceType).toBe('Patient');
    expect(created[1].subject.reference).toBe('Patient/new-1');
    const { isOwn } = await makeClinicStamper(m, 'clinic-a');
    expect(isOwn(searchResults[0])).toBe(false);
    expect(isOwn({ ...store['Patient/p-a'], meta: { accounts: [{ reference: 'HealthcareService/hs-clinic-a' }, { reference: 'HealthcareService/hs-clinic-b' }] } })).toBe(false);
    fresh();
    searchResults = [{ ...store['Patient/p-a'], meta: { accounts: [{ reference: 'HealthcareService/hs-clinic-a' }] } }];
    expect((await exportConsultationToMedplum(c, { name: 'Fake', ic: '000000-00-0000' }, 'clinic-a')).success).toBe(true);
    expect(created[0].resourceType).toBe('Encounter');
    expect(created[0].subject.reference).toBe('Patient/p-a');
  });

  it('unknown clinic cannot construct an export stamper', async () => {
    const unknown: any = { readResource: async () => { throw new Error('not found'); }, searchOne: async () => undefined };
    // Directory fallback uses the fake admin, so explicitly return no clinic there too.
    const read = fake.readResource, search = fake.searchOne;
    try {
      fake.readResource = unknown.readResource; fake.searchOne = unknown.searchOne;
      await reject(makeClinicStamper(unknown, 'missing-clinic'));
    } finally { fake.readResource = read; fake.searchOne = search; }
  });

  it('all graph mappers reject foreign links and persist own-clinic resources using the supplied SDK client', async () => {
    fresh();
    const prescription: any = { medication: { name: 'Fake', strength: '' } };
    for (const write of [
      () => toFhirEncounter('Patient/p-b', {}, undefined, 'clinic-a', m),
      () => toFhirCondition('Patient/p-a', 'Encounter/enc-b', 'Fake', 'clinic-a', m),
      () => toFhirMedicationRequest('Patient/p-b', 'Encounter/enc-a', prescription, 'clinic-a', m),
      () => toFhirServiceRequest('Patient/p-a', 'Encounter/enc-b', { name: 'Fake' } as any, 'clinic-a', m),
      () => toFhirEncounter('Patient/p-a', {}, undefined, undefined, m),
    ]) expect((await reject(write())).outcome.id).toBe('forbidden');
    expect(created).toHaveLength(0);
    await toFhirPatient({ fullName: 'Fake Person', nric: '000000-00-0000', gender: 'unknown', dateOfBirth: '2000-01-01' } as any, 'clinic-a', m);
    await toFhirEncounter('Patient/p-a', {}, undefined, 'clinic-a', m);
    await toFhirCondition('Patient/p-a', 'Encounter/enc-a', 'Fake', 'clinic-a', m);
    await toFhirMedicationRequest('Patient/p-a', 'Encounter/enc-a', prescription, 'clinic-a', m);
    await toFhirServiceRequest('Patient/p-a', 'Encounter/enc-a', { name: 'Fake' } as any, 'clinic-a', m);
    expect(created).toHaveLength(5);
    for (const r of created) {
      expect(r.identifier).toContainEqual({ system: 'clinic', value: 'clinic-a' });
      expect(r.meta.accounts).toEqual([{ reference: 'HealthcareService/hs-clinic-a' }]);
    }
  });

  it('billing exception tasks and invoices validate encounter/patient pairing before writing', async () => {
    fresh();
    for (const encounter of ['enc-b', 'enc-x', 'missing']) {
      const input: any = { consultationId: encounter, patientId: 'p-a', clinicId: 'clinic-a', errorSummary: 'Fake', errorClass: 'fake' };
      expect((await reject(createBillingExceptionTask(m, input))).outcome.id).toBe('forbidden');
      expect((await reject(completeCheckoutInvoice(m, { ...input, items: [{ name: 'Fake', type: 'Service', quantity: 1, price: 10 }], paymentMethod: 'cash', paidAmount: 10, totalAmount: 10 }))).outcome.id).toBe('forbidden');
    }
    expect(created).toHaveLength(0);
    await createBillingExceptionTask(m, { consultationId: 'enc-a', patientId: 'p-a', clinicId: 'clinic-a', errorSummary: 'Fake', errorClass: 'fake' });
    expect(created[0].for.reference).toBe('Patient/p-a');
  });

  it('clinical consultation save/update rejects foreign links, and own-clinic note edits still persist', async () => {
    fresh();
    await reject(saveConsultationToMedplum({ patientId: 'p-b' } as any, { id: 'p-b', name: 'Fake' }, 'clinic-a', m));
    await reject(updateConsultationInMedplum('enc-b', { notes: 'Fake' }, 'clinic-a', m));
    await reject(updateConsultationInMedplum('enc-a', { notes: 'Fake' }, undefined, m));
    expect(created).toHaveLength(0);
    await updateConsultationInMedplum('enc-a', { notes: 'Fake edit' }, 'clinic-a', m);
    expect(created).toHaveLength(1);
    expect(created[0].valueString).toBe('Fake edit');
    expect(created[0].subject.reference).toBe('Patient/p-a');
    expect(created[0].identifier).toContainEqual({ system: 'clinic', value: 'clinic-a' });
  });
});
