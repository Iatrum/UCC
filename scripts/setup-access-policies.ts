#!/usr/bin/env bun
/**
 * Setup Medplum Access Policies.
 *
 * Security model:
 * - Clinic staff access is scoped by the stable clinic identifier:
 *   { name: "clinicId", valueString: "<clinic-subdomain>" }.
 * - Clinic-owned FHIR resources carry identifier { system: "clinic", value: clinicId }.
 * - HealthcareService account parameters remain on memberships for compatibility
 *   with existing Medplum account metadata, but policy criteria must not rely on
 *   `_compartment` or account-only searches.
 * - Platform admin access remains separate and must never be used by normal
 *   clinic routes.
 */

import { MedplumClient } from "@medplum/core";
import type { AccessPolicy, AccessPolicyResource, Organization, ProjectMembership } from "@medplum/fhirtypes";

const MEDPLUM_BASE_URL = process.env.MEDPLUM_BASE_URL || "http://localhost:8103";
const MEDPLUM_CLIENT_ID = process.env.MEDPLUM_CLIENT_ID;
const MEDPLUM_CLIENT_SECRET = process.env.MEDPLUM_CLIENT_SECRET;

const CLINIC_POLICY_NAME = "UCC Clinic Staff Policy";
const PLATFORM_ADMIN_POLICY_NAME = "UCC Platform Admin Policy";
const PATIENT_PORTAL_POLICY_NAME = "UCC Patient Portal Policy";
const CLINIC_IDENTIFIER_SYSTEM = "clinic";

const ALL_INTERACTIONS: AccessPolicyResource["interaction"] = [
  "create",
  "read",
  "update",
  "delete",
  "search",
  "history",
  "vread",
];

const READ_INTERACTIONS: AccessPolicyResource["interaction"] = [
  "read",
  "search",
  "history",
  "vread",
];

function clinicIdentifierRule(resourceType: string, interactions = ALL_INTERACTIONS): AccessPolicyResource {
  return {
    resourceType,
    criteria: `${resourceType}?identifier=${CLINIC_IDENTIFIER_SYSTEM}|%clinicId`,
    interaction: interactions,
  };
}

function patientOwnedRule(resourceType: string): AccessPolicyResource {
  return {
    resourceType,
    criteria:
      resourceType === "Patient"
        ? "Patient?_id=%patient.id"
        : `${resourceType}?subject=Patient/%patient.id`,
    interaction: READ_INTERACTIONS,
  };
}

async function upsertAccessPolicy(
  medplum: MedplumClient,
  policy: Omit<AccessPolicy, "id">
): Promise<AccessPolicy> {
  const existing = await medplum.searchOne("AccessPolicy", {
    name: policy.name,
  });

  if (existing?.id) {
    return medplum.updateResource<AccessPolicy>({
      ...existing,
      ...policy,
      id: existing.id,
    });
  }

  return medplum.createResource<AccessPolicy>(policy);
}

function referenceId(reference?: string): string | undefined {
  return reference?.split("/")?.[1];
}

function parameterValue(
  parameters: NonNullable<NonNullable<ProjectMembership["access"]>[number]["parameter"]>,
  name: string
): string | undefined {
  const parameter = parameters.find((item) => item.name === name) as any;
  return parameter?.valueString || referenceId(parameter?.valueReference?.reference);
}

async function getClinicIdentifierForOrganization(
  medplum: MedplumClient,
  organizationId: string
): Promise<string | undefined> {
  const organization = await medplum.readResource("Organization", organizationId) as Organization;
  return organization.identifier?.find((identifier) => identifier.system === CLINIC_IDENTIFIER_SYSTEM)?.value;
}

async function withIdentifierPolicyParameters(
  medplum: MedplumClient,
  membership: ProjectMembership,
  clinicPolicyReference: string
): Promise<{ membership: ProjectMembership; changed: boolean }> {
  let changed = false;
  const access = [];

  for (const entry of membership.access || []) {
    const parameters = [...(entry.parameter || [])];
    const hasPolicyReference = entry.policy.reference === clinicPolicyReference;
    const organizationId =
      parameterValue(parameters, "clinicOrganizationId") ||
      parameterValue(parameters, "clinicOrganization");
    const hasLegacyClinicScope =
      Boolean(parameterValue(parameters, "clinicAccount")) ||
      Boolean(parameterValue(parameters, "clinicOrganization"));

    if ((hasPolicyReference || hasLegacyClinicScope) && organizationId) {
      const clinicId = parameterValue(parameters, "clinicId") || await getClinicIdentifierForOrganization(medplum, organizationId);
      if (clinicId && !parameterValue(parameters, "clinicId")) {
        parameters.push({ name: "clinicId", valueString: clinicId });
        changed = true;
      }
      if (!parameterValue(parameters, "clinicOrganizationId")) {
        parameters.push({ name: "clinicOrganizationId", valueString: organizationId });
        changed = true;
      }
    }

    access.push({ ...entry, parameter: parameters });
  }

  return changed ? { membership: { ...membership, access }, changed } : { membership, changed };
}

async function reconcileClinicStaffMemberships(
  medplum: MedplumClient,
  clinicPolicyReference: string
): Promise<number> {
  const memberships = await medplum.searchResources("ProjectMembership", { _count: "1000" });
  let updated = 0;

  for (const membership of memberships as ProjectMembership[]) {
    if (!membership.id || !membership.access?.length) continue;
    const result = await withIdentifierPolicyParameters(medplum, membership, clinicPolicyReference);
    if (!result.changed) continue;
    await medplum.updateResource(result.membership);
    updated += 1;
  }

  return updated;
}

export function buildClinicStaffPolicy(): Omit<AccessPolicy, "id"> {
  return {
    resourceType: "AccessPolicy",
    name: CLINIC_POLICY_NAME,
    resource: [
      clinicIdentifierRule("Patient"),
      clinicIdentifierRule("Encounter"),
      clinicIdentifierRule("Observation"),
      clinicIdentifierRule("Condition"),
      clinicIdentifierRule("Procedure"),
      clinicIdentifierRule("MedicationRequest"),
      clinicIdentifierRule("MedicationStatement"),
      clinicIdentifierRule("AllergyIntolerance"),
      clinicIdentifierRule("ServiceRequest"),
      clinicIdentifierRule("DiagnosticReport"),
      clinicIdentifierRule("ImagingStudy"),
      clinicIdentifierRule("DocumentReference"),
      clinicIdentifierRule("Appointment"),
      clinicIdentifierRule("Invoice"),
      clinicIdentifierRule("Task"),
      clinicIdentifierRule("Basic"),
      clinicIdentifierRule("ChargeItemDefinition"),
      clinicIdentifierRule("Medication"),
      clinicIdentifierRule("Communication"),
      clinicIdentifierRule("QuestionnaireResponse"),
      clinicIdentifierRule("Schedule"),
      clinicIdentifierRule("Slot"),
      {
        resourceType: "Practitioner",
        interaction: READ_INTERACTIONS,
      },
      {
        resourceType: "PractitionerRole",
        criteria: "PractitionerRole?organization=Organization/%clinicOrganizationId",
        interaction: READ_INTERACTIONS,
      },
      {
        resourceType: "Organization",
        criteria: `Organization?identifier=${CLINIC_IDENTIFIER_SYSTEM}|%clinicId`,
        interaction: READ_INTERACTIONS,
      },
      {
        resourceType: "HealthcareService",
        criteria: `HealthcareService?identifier=${CLINIC_IDENTIFIER_SYSTEM}|%clinicId`,
        interaction: READ_INTERACTIONS,
      },
    ],
  };
}

export function buildPlatformAdminPolicy(): Omit<AccessPolicy, "id"> {
  return {
    resourceType: "AccessPolicy",
    name: PLATFORM_ADMIN_POLICY_NAME,
    resource: [
      {
        resourceType: "*",
        interaction: ALL_INTERACTIONS,
      },
      {
        resourceType: "AccessPolicy",
        interaction: ALL_INTERACTIONS,
      },
      {
        resourceType: "ProjectMembership",
        interaction: ALL_INTERACTIONS,
      },
      {
        resourceType: "User",
        interaction: ALL_INTERACTIONS,
      },
    ],
  };
}

export function buildPatientPortalPolicy(): Omit<AccessPolicy, "id"> {
  return {
    resourceType: "AccessPolicy",
    name: PATIENT_PORTAL_POLICY_NAME,
    resource: [
      patientOwnedRule("Patient"),
      patientOwnedRule("Encounter"),
      patientOwnedRule("Observation"),
      patientOwnedRule("Condition"),
      patientOwnedRule("MedicationRequest"),
      patientOwnedRule("DocumentReference"),
      {
        resourceType: "Appointment",
        criteria: "Appointment?actor=Patient/%patient.id",
        interaction: ["create", "read", "update", "search", "history", "vread"],
      },
    ],
  };
}

export async function setupAccessPolicies() {
  if (!MEDPLUM_CLIENT_ID || !MEDPLUM_CLIENT_SECRET) {
    throw new Error("Missing MEDPLUM_CLIENT_ID or MEDPLUM_CLIENT_SECRET");
  }

  const medplum = new MedplumClient({
    baseUrl: MEDPLUM_BASE_URL,
    clientId: MEDPLUM_CLIENT_ID,
    clientSecret: MEDPLUM_CLIENT_SECRET,
  });

  await medplum.startClientLogin(MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET);

  const clinicStaffPolicy = await upsertAccessPolicy(medplum, buildClinicStaffPolicy());
  const platformAdminPolicy = await upsertAccessPolicy(medplum, buildPlatformAdminPolicy());
  const patientPortalPolicy = await upsertAccessPolicy(medplum, buildPatientPortalPolicy());
  const reconciledMemberships = clinicStaffPolicy.id
    ? await reconcileClinicStaffMemberships(medplum, `AccessPolicy/${clinicStaffPolicy.id}`)
    : 0;

  console.log("Medplum Access Policies ready:");
  console.log(`MEDPLUM_POLICY_CLINIC_STAFF=${clinicStaffPolicy.id}`);
  console.log(`MEDPLUM_POLICY_PLATFORM_ADMIN=${platformAdminPolicy.id}`);
  console.log(`MEDPLUM_POLICY_PATIENT=${patientPortalPolicy.id}`);
  console.log(`RECONCILED_CLINIC_STAFF_MEMBERSHIPS=${reconciledMemberships}`);
}

if (import.meta.main) {
  setupAccessPolicies().catch((error) => {
    console.error("Failed to setup Medplum access policies:", error);
    process.exit(1);
  });
}
