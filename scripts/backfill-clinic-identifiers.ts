#!/usr/bin/env bun
/**
 * Backfill identifier=clinic|<clinicId> on clinic-owned FHIR resources.
 *
 * Dry-run by default:
 *   bun scripts/backfill-clinic-identifiers.ts
 *
 * Apply updates:
 *   APPLY=true bun scripts/backfill-clinic-identifiers.ts
 */

import type { Resource } from "@medplum/fhirtypes";
import { getAdminMedplum } from "@/lib/server/medplum-admin";

const CLINIC_SYSTEM = "clinic";
const APPLY = process.env.APPLY === "true";
const RESOURCE_TYPES = [
  "Patient",
  "Encounter",
  "Observation",
  "Condition",
  "Procedure",
  "MedicationRequest",
  "MedicationStatement",
  "AllergyIntolerance",
  "ServiceRequest",
  "DiagnosticReport",
  "ImagingStudy",
  "DocumentReference",
  "Appointment",
  "Invoice",
  "Task",
  "Basic",
  "ChargeItemDefinition",
  "Medication",
  "Communication",
  "QuestionnaireResponse",
] as const;

type AnyResource = Resource & Record<string, any>;

function clinicIdentifier(resource: AnyResource): string | undefined {
  return resource.identifier?.find((identifier: any) => identifier.system === CLINIC_SYSTEM)?.value;
}

function withClinicIdentifier<T extends AnyResource>(resource: T, clinicId: string): T {
  const identifiers = resource.identifier || [];
  if (clinicIdentifier(resource)) return resource;
  return {
    ...resource,
    identifier: [...identifiers, { system: CLINIC_SYSTEM, value: clinicId }],
  };
}

function refId(reference?: string): string | undefined {
  return reference?.split("/")?.[1];
}

async function main() {
  const medplum = await getAdminMedplum();
  const patientClinic = new Map<string, string>();
  const encounterClinic = new Map<string, string>();
  const requestClinic = new Map<string, string>();
  const studyClinic = new Map<string, string>();

  const patients = await medplum.searchResources("Patient", { _count: "10000" });
  for (const patient of patients as AnyResource[]) {
    const clinicId =
      clinicIdentifier(patient) ||
      refId(patient.managingOrganization?.reference);
    if (patient.id && clinicId) {
      patientClinic.set(patient.id, clinicId);
    }
  }

  const encounters = await medplum.searchResources("Encounter", { _count: "10000" });
  for (const encounter of encounters as AnyResource[]) {
    const patientId = refId(encounter.subject?.reference);
    const clinicId =
      clinicIdentifier(encounter) ||
      refId(encounter.serviceProvider?.reference) ||
      (patientId ? patientClinic.get(patientId) : undefined);
    if (encounter.id && clinicId) {
      encounterClinic.set(encounter.id, clinicId);
    }
  }

  const requests = await medplum.searchResources("ServiceRequest", { _count: "10000" });
  for (const request of requests as AnyResource[]) {
    const patientId = refId(request.subject?.reference);
    const encounterId = refId(request.encounter?.reference);
    const clinicId =
      clinicIdentifier(request) ||
      (encounterId ? encounterClinic.get(encounterId) : undefined) ||
      (patientId ? patientClinic.get(patientId) : undefined);
    if (request.id && clinicId) {
      requestClinic.set(request.id, clinicId);
    }
  }

  const studies = await medplum.searchResources("ImagingStudy", { _count: "10000" });
  for (const study of studies as AnyResource[]) {
    const patientId = refId(study.subject?.reference);
    const encounterId = refId(study.encounter?.reference);
    const basedOnId = refId(study.basedOn?.[0]?.reference);
    const clinicId =
      clinicIdentifier(study) ||
      (basedOnId ? requestClinic.get(basedOnId) : undefined) ||
      (encounterId ? encounterClinic.get(encounterId) : undefined) ||
      (patientId ? patientClinic.get(patientId) : undefined);
    if (study.id && clinicId) {
      studyClinic.set(study.id, clinicId);
    }
  }

  let checked = 0;
  let updated = 0;
  let unresolved = 0;

  for (const resourceType of RESOURCE_TYPES) {
    const resources = await medplum.searchResources(resourceType, { _count: "10000" } as any);
    for (const resource of resources as AnyResource[]) {
      checked += 1;
      if (clinicIdentifier(resource)) continue;

      const patientId = refId(resource.subject?.reference);
      const encounterId = refId(resource.encounter?.reference);
      const basedOnId = refId(resource.basedOn?.[0]?.reference);
      const studyId = refId(resource.imagingStudy?.[0]?.reference);
      const invoiceClinic = resource.extension?.find((ext: any) => ext.url === "https://ucc.emr/invoice/clinic-id")?.valueString;

      const clinicId =
        invoiceClinic ||
        refId(resource.managingOrganization?.reference) ||
        refId(resource.serviceProvider?.reference) ||
        (encounterId ? encounterClinic.get(encounterId) : undefined) ||
        (basedOnId ? requestClinic.get(basedOnId) : undefined) ||
        (studyId ? studyClinic.get(studyId) : undefined) ||
        (patientId ? patientClinic.get(patientId) : undefined);

      if (!clinicId) {
        unresolved += 1;
        console.warn(`Unresolved ${resourceType}/${resource.id}`);
        continue;
      }

      updated += 1;
      console.log(`${APPLY ? "Updating" : "Would update"} ${resourceType}/${resource.id} clinic=${clinicId}`);
      if (APPLY) {
        await medplum.updateResource(withClinicIdentifier(resource, clinicId));
      }
    }
  }

  console.log(JSON.stringify({ checked, updated, unresolved, apply: APPLY }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
