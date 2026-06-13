import { describe, expect, it } from "bun:test";
import type { Condition, Encounter, Invoice, Patient } from "@medplum/fhirtypes";
import { getInvoice, getPatientInvoices, voidInvoice } from "../../lib/fhir/billing-service";
import { getConsultationsWithDetails } from "../../lib/models";
import { CLINIC_IDENTIFIER_SYSTEM, resourceMatchesClinicTenant } from "../../lib/fhir/clinic-tenancy";

const TRIAGE_ENCOUNTER_EXTENSION_URL = "https://ucc.emr/triage-encounter";

type FakeResource = (Encounter | Invoice | Patient | Condition) & Record<string, any>;

function clinicIdentifier(clinicId: string) {
  return { system: CLINIC_IDENTIFIER_SYSTEM, value: clinicId };
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

function condition(id: string, clinicId: string, encounterId: string, patientId: string, diagnosis: string): Condition {
  return {
    resourceType: "Condition",
    id,
    identifier: [clinicIdentifier(clinicId)],
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounterId}` },
    code: { text: diagnosis },
  };
}

/**
 * Minimal Medplum stand-in. Resources are stored flat and "Organization" reads
 * resolve directly to the requested id, matching the app-level model where a
 * clinic's Organization id is the clinicId itself.
 */
function makeFakeMedplum(resources: FakeResource[]) {
  return {
    async readResource(resourceType: string, id: string) {
      if (resourceType === "Organization") {
        return { resourceType: "Organization", id } as any;
      }
      const found = resources.find((resource) => resource.resourceType === resourceType && resource.id === id);
      if (!found) throw new Error(`${resourceType}/${id} not found`);
      return found;
    },
    async searchOne(resourceType: string, params: Record<string, string>) {
      if (resourceType === "HealthcareService" && params.identifier) {
        const [, clinicId] = params.identifier.split("|");
        return { resourceType: "HealthcareService", id: `account-${clinicId}` } as any;
      }
      return undefined;
    },
    async updateResource(resource: FakeResource) {
      return resource;
    },
    async deleteResource() {
      return undefined;
    },
    async searchResources(resourceType: string, params: Record<string, string> = {}) {
      let matches = resources.filter((resource) => resource.resourceType === resourceType);

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
  } as any;
}

describe("resourceMatchesClinicTenant", () => {
  it("matches a resource carrying the clinic identifier", () => {
    const resource = { identifier: [clinicIdentifier("clinic-a")] };
    expect(resourceMatchesClinicTenant(resource, "clinic-a")).toBe(true);
    expect(resourceMatchesClinicTenant(resource, "clinic-b")).toBe(false);
  });

  it("falls back to legacy managingOrganization/serviceProvider references", () => {
    const managed = { managingOrganization: { reference: "Organization/clinic-a" } };
    expect(resourceMatchesClinicTenant(managed, "clinic-a")).toBe(true);
    expect(resourceMatchesClinicTenant(managed, "clinic-b")).toBe(false);

    const served = { serviceProvider: { reference: "Organization/clinic-a" } };
    expect(resourceMatchesClinicTenant(served, "clinic-a")).toBe(true);
    expect(resourceMatchesClinicTenant(served, "clinic-b")).toBe(false);
  });

  it("treats a missing clinicId as unscoped", () => {
    const resource = { identifier: [clinicIdentifier("clinic-a")] };
    expect(resourceMatchesClinicTenant(resource, undefined)).toBe(true);
    expect(resourceMatchesClinicTenant(resource, null)).toBe(true);
  });
});

describe("billing-service clinic isolation", () => {
  it("hides a direct invoice ID from another clinic", async () => {
    const medplum = makeFakeMedplum([
      invoice("invoice-a", "clinic-a", "patient-a", "encounter-a"),
      invoice("invoice-b", "clinic-b", "patient-b", "encounter-b"),
    ]);

    await expect(getInvoice(medplum, "invoice-b", "clinic-a")).resolves.toBeNull();
    await expect(voidInvoice(medplum, "invoice-b", "clinic-a")).rejects.toThrow("Access denied");
  });

  it("filters patient invoice lists to the authenticated clinic", async () => {
    const medplum = makeFakeMedplum([
      invoice("invoice-a", "clinic-a", "patient-shared", "encounter-a"),
      invoice("invoice-b", "clinic-b", "patient-shared", "encounter-b"),
    ]);

    const invoices = await getPatientInvoices(medplum, "patient-shared", "clinic-a");

    expect(invoices.map((item) => item.id)).toEqual(["invoice-a"]);
  });
});

describe("getConsultationsWithDetails clinic isolation", () => {
  it("does not include another clinic's billable encounter in the billing queue", async () => {
    const medplum = makeFakeMedplum([
      patient("patient-a", "clinic-a", "Clinic A Patient"),
      patient("patient-b", "clinic-b", "Clinic B Patient"),
      encounter("encounter-a", "clinic-a", "patient-a", "meds_and_bills"),
      encounter("encounter-b", "clinic-b", "patient-b", "meds_and_bills"),
      condition("cond-a", "clinic-a", "encounter-a", "patient-a", "URI"),
      condition("cond-b", "clinic-b", "encounter-b", "patient-b", "Influenza"),
    ]);

    const consultations = await getConsultationsWithDetails(["meds_and_bills"], medplum, "clinic-a");

    expect(consultations.map((item) => item.id)).toEqual(["encounter-a"]);
    expect(consultations.map((item) => item.patientId)).toEqual(["patient-a"]);
    expect(consultations.map((item) => item.diagnosis)).toEqual(["URI"]);
  });
});
