import { describe, expect, it } from "bun:test";
import type { MedplumClient } from "@medplum/core";
import { saveReferralToMedplum } from "../../lib/fhir/referral-service";
import { saveAppointmentToMedplum } from "../../lib/fhir/appointment-service";
import { completeCheckoutInvoice } from "../../lib/fhir/billing-service";
import { createFollowUp } from "../../lib/fhir/communication-service";
import { createPatientDocument } from "../../lib/fhir/document-service";
import { createLabOrder } from "../../lib/fhir/lab-service";
import { createImagingOrder } from "../../lib/fhir/imaging-service";
import { saveTriageEncounter, checkInPatientInTriage } from "../../lib/fhir/triage-service";
import { assertPatientInClinic } from "../../lib/fhir/write-containment";

// Fake data only. Two clinics; patient P-B belongs to clinic-b.
function fakeMedplum() {
  const created: any[] = [];
  const store: Record<string, any> = {
    "Patient/p-a": { resourceType: "Patient", id: "p-a", identifier: [{ system: "clinic", value: "clinic-a" }] },
    "Patient/p-b": { resourceType: "Patient", id: "p-b", identifier: [{ system: "clinic", value: "clinic-b" }] },
  };
  const org = (id: string) => ({ resourceType: "Organization", id });
  const client: any = {
    created,
    async readResource(type: string, id: string) {
      if (type === "Organization") return org(id);
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
  return client as MedplumClient & { created: any[] };
}

const reject = async (p: Promise<unknown>) => {
  let err: unknown;
  try { await p; } catch (e) { err = e; }
  expect(err).toBeDefined();
};

describe("write-side clinic containment (Task 320)", () => {
  it("assertPatientInClinic allows own-clinic and rejects foreign/missing/malformed patients", async () => {
    const m = fakeMedplum();
    await assertPatientInClinic(m, "clinic-a", "p-a");
    await reject(assertPatientInClinic(m, "clinic-a", "p-b"));
    await reject(assertPatientInClinic(m, "clinic-a", "nope"));
    await reject(assertPatientInClinic(m, "clinic-a", "p-a/../p-b"));
    await reject(assertPatientInClinic(m, "clinic-a", ""));
  });

  it("referral creation for a foreign patient never reaches createResource", async () => {
    const m = fakeMedplum();
    const data: any = { patientId: "p-b", specialty: "ENT", facility: "Fake Hosp", reason: "test", urgency: "routine" };
    await reject(saveReferralToMedplum(m, data, "clinic-a"));
    expect(m.created.length).toBe(0);
    await saveReferralToMedplum(m, { ...data, patientId: "p-a" }, "clinic-a");
    expect(m.created.length).toBe(1);
  });

  it("appointment creation for a foreign patient never reaches createResource", async () => {
    const m = fakeMedplum();
    const data: any = { patientId: "p-b", patientName: "Fake", clinician: "Dr Fake", reason: "x", scheduledAt: new Date(), status: "booked" };
    await reject(saveAppointmentToMedplum(m, data, "clinic-a"));
    expect(m.created.length).toBe(0);
  });

  it("checkout invoice for a foreign patient never reaches createResource", async () => {
    const m = fakeMedplum();
    await reject(completeCheckoutInvoice(m, {
      consultationId: "c1", patientId: "p-b", clinicId: "clinic-a",
      items: [{ description: "Fake", quantity: 1, unitPrice: 10 }], paymentMethod: "cash", paidAmount: 10, totalAmount: 10,
    } as any));
    expect(m.created.length).toBe(0);
  });

  it("follow-up for a foreign patient never reaches createResource", async () => {
    const m = fakeMedplum();
    await reject(createFollowUp(m, { patientId: "p-b", patientName: "Fake", clinicId: "clinic-a", type: "general", message: "hi" } as any));
    expect(m.created.length).toBe(0);
  });

  it("document registration for a foreign patient never reaches createResource", async () => {
    const m = fakeMedplum();
    await reject(createPatientDocument(m, { patientId: "p-b", clinicId: "clinic-a", title: "Fake", url: "https://example.invalid/x.pdf" } as any));
    expect(m.created.length).toBe(0);
  });

  it("lab and imaging order creation reject a foreign patient (regression)", async () => {
    const m = fakeMedplum();
    await reject(createLabOrder({ patientId: "p-b", encounterId: "e1", tests: [] } as any, m, "clinic-a"));
    await reject(createImagingOrder({ patientId: "p-b", encounterId: "e1" } as any, m, "clinic-a"));
    expect(m.created.length).toBe(0);
  });

  it("triage and check-in for a foreign patient never reach createResource (Task 321)", async () => {
    const m = fakeMedplum();
    await reject(saveTriageEncounter("p-b", {} as any, m, "clinic-a"));
    await reject(checkInPatientInTriage("p-b", "cough", undefined, m, "clinic-a"));
    expect(m.created.length).toBe(0);
  });
});
