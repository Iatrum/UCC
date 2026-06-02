import { describe, expect, it } from "bun:test";
import type { Encounter, Invoice, Patient } from "@medplum/fhirtypes";
import { getInvoice, getPatientInvoices, voidInvoice } from "../../lib/fhir/billing-service";
import { getConsultationsWithDetails } from "../../lib/models";

const CLINIC_EXTENSION_URL = "https://ucc.emr/invoice/clinic-id";
const TRIAGE_ENCOUNTER_EXTENSION_URL = "https://ucc.emr/triage-encounter";

type FakeResource = Encounter | Invoice | Patient | Record<string, any>;

function clinicIdentifier(clinicId: string) {
  return { system: "clinic", value: clinicId };
}

function invoiceClinicExtension(clinicId: string) {
  return { url: CLINIC_EXTENSION_URL, valueString: clinicId };
}

function queueExtension(queueStatus: string) {
  return {
    url: TRIAGE_ENCOUNTER_EXTENSION_URL,
    extension: [{ url: "queueStatus", valueString: queueStatus }],
  };
}

function patient(id: string, clinicId: string, name: string): Patient {
  return {
    resourceType: "Patient",
    id,
    identifier: [clinicIdentifier(clinicId)],
    name: [{ text: name }],
    gender: "unknown",
    managingOrganization: { reference: `Organization/${clinicId}` },
  };
}

function invoice(id: string, clinicId: string, patientId: string, consultationId: string): Invoice {
  return {
    resourceType: "Invoice",
    id,
    status: "balanced",
    identifier: [
      clinicIdentifier(clinicId),
      { system: "https://ucc.emr/invoice/consultation", value: consultationId },
    ],
    subject: { reference: `Patient/${patientId}` },
    extension: [invoiceClinicExtension(clinicId)],
  };
}

function encounter(id: string, clinicId: string, patientId: string, queueStatus: string): Encounter {
  return {
    resourceType: "Encounter",
    id,
    status: "finished",
    identifier: [
      clinicIdentifier(clinicId),
      { system: "firebase-patient", value: patientId },
    ],
    subject: { reference: `Patient/${patientId}`, display: `${clinicId} patient` },
    serviceProvider: { reference: `Organization/${clinicId}` },
    period: { start: "2026-06-01T00:00:00.000Z" },
    extension: [queueExtension(queueStatus)],
  };
}

function observation(id: string, clinicId: string, encounterId: string, patientId: string, text: string, valueString: string) {
  return {
    resourceType: "Observation",
    id,
    status: "final",
    identifier: [clinicIdentifier(clinicId)],
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounterId}` },
    code: { text },
    valueString,
  };
}

function condition(id: string, clinicId: string, encounterId: string, patientId: string, diagnosis: string) {
  return {
    resourceType: "Condition",
    id,
    identifier: [clinicIdentifier(clinicId)],
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounterId}` },
    code: { text: diagnosis },
  };
}

function resourceBelongsToClinic(resource: FakeResource, clinicId: string): boolean {
  return Boolean(
    resource.identifier?.some((identifier: any) => identifier.system === "clinic" && identifier.value === clinicId) ||
      resource.managingOrganization?.reference === `Organization/${clinicId}` ||
      resource.serviceProvider?.reference === `Organization/${clinicId}`
  );
}

function makeFakeMedplum(resources: FakeResource[], policyClinicId?: string) {
  return {
    async readResource(resourceType: string, id: string) {
      const found = resources.find((resource) => resource.resourceType === resourceType && resource.id === id);
      if (!found) throw new Error(`${resourceType}/${id} not found`);
      if (policyClinicId && !resourceBelongsToClinic(found, policyClinicId)) {
        throw new Error(`${resourceType}/${id} not found`);
      }
      return found;
    },
    async updateResource(resource: FakeResource) {
      return resource;
    },
    async deleteResource() {
      return undefined;
    },
    async searchResources(resourceType: string, params: Record<string, string>) {
      let matches = resources.filter(
        (resource) =>
          resource.resourceType === resourceType &&
          (!policyClinicId || resourceBelongsToClinic(resource, policyClinicId))
      );

      if (params.identifier) {
        const [system, value] = params.identifier.split("|");
        matches = matches.filter((resource) =>
          resource.identifier?.some((identifier: any) => identifier.system === system && identifier.value === value)
        );
      }

      if (params.subject) {
        matches = matches.filter((resource) => resource.subject?.reference === params.subject);
      }

      if (params.encounter) {
        const encounterRefs = params.encounter.split(",");
        matches = matches.filter((resource) => encounterRefs.includes(resource.encounter?.reference));
      }

      if (params["service-provider"]) {
        matches = matches.filter((resource) => resource.serviceProvider?.reference === params["service-provider"]);
      }

      return matches;
    },
  };
}

describe("clinic data boundary", () => {
  it("hides a direct invoice ID from another clinic", async () => {
    const medplum = makeFakeMedplum([
      invoice("invoice-a", "clinic-a", "patient-a", "encounter-a"),
      invoice("invoice-b", "clinic-b", "patient-b", "encounter-b"),
    ]);

    await expect(getInvoice(medplum as any, "invoice-b", "clinic-a")).resolves.toBeNull();
    await expect(voidInvoice(medplum as any, "invoice-b", "clinic-a")).rejects.toThrow("Access denied");
  });

  it("filters patient invoice lists to the authenticated clinic", async () => {
    const medplum = makeFakeMedplum([
      invoice("invoice-a", "clinic-a", "patient-shared", "encounter-a"),
      invoice("invoice-b", "clinic-b", "patient-shared", "encounter-b"),
    ]);

    const invoices = await getPatientInvoices(medplum as any, "patient-shared", "clinic-a");

    expect(invoices.map((item) => item.id)).toEqual(["invoice-a"]);
  });

  it("does not include another clinic's billable encounter in the billing queue", async () => {
    const medplum = makeFakeMedplum([
      patient("patient-a", "clinic-a", "Clinic A Patient"),
      patient("patient-b", "clinic-b", "Clinic B Patient"),
      encounter("encounter-a", "clinic-a", "patient-a", "meds_and_bills"),
      encounter("encounter-b", "clinic-b", "patient-b", "meds_and_bills"),
      observation("obs-a", "clinic-a", "encounter-a", "patient-a", "Chief Complaint", "cough"),
      observation("obs-b", "clinic-b", "encounter-b", "patient-b", "Chief Complaint", "fever"),
      condition("cond-a", "clinic-a", "encounter-a", "patient-a", "URI"),
      condition("cond-b", "clinic-b", "encounter-b", "patient-b", "Influenza"),
    ], "clinic-a");

    const consultations = await getConsultationsWithDetails(["meds_and_bills"], medplum as any);

    expect(consultations.map((item) => item.id)).toEqual(["encounter-a"]);
    expect(consultations.map((item) => item.patientId)).toEqual(["patient-a"]);
  });
});
