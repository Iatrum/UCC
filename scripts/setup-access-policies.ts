#!/usr/bin/env bun
/**
 * Setup Medplum Access Policies.
 *
 * Security model:
 * - Clinic staff access is scoped by a ProjectMembership access parameter:
 *   { name: "clinicOrganization", valueReference: Organization/<id> }.
 * - Patients are assigned to the clinic Organization with $set-accounts.
 * - Patient-related resources are scoped by Medplum tenant compartments.
 * - Platform admin access remains separate and must never be used by normal
 *   clinic routes.
 */

import { MedplumClient } from "@medplum/core";
import type { AccessPolicy, AccessPolicyResource } from "@medplum/fhirtypes";

const MEDPLUM_BASE_URL = process.env.MEDPLUM_BASE_URL || "http://localhost:8103";
const MEDPLUM_CLIENT_ID = process.env.MEDPLUM_CLIENT_ID;
const MEDPLUM_CLIENT_SECRET = process.env.MEDPLUM_CLIENT_SECRET;

const CLINIC_POLICY_NAME = "UCC Clinic Staff Policy";
const PLATFORM_ADMIN_POLICY_NAME = "UCC Platform Admin Policy";
const PATIENT_PORTAL_POLICY_NAME = "UCC Patient Portal Policy";

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

function clinicCompartmentRule(resourceType: string, interactions = ALL_INTERACTIONS): AccessPolicyResource {
  return {
    resourceType,
    criteria: `${resourceType}?_compartment=%clinicOrganization`,
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

async function setupAccessPolicies() {
  if (!MEDPLUM_CLIENT_ID || !MEDPLUM_CLIENT_SECRET) {
    throw new Error("Missing MEDPLUM_CLIENT_ID or MEDPLUM_CLIENT_SECRET");
  }

  const medplum = new MedplumClient({
    baseUrl: MEDPLUM_BASE_URL,
    clientId: MEDPLUM_CLIENT_ID,
    clientSecret: MEDPLUM_CLIENT_SECRET,
  });

  await medplum.startClientLogin(MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET);

  const clinicStaffPolicy = await upsertAccessPolicy(medplum, {
    resourceType: "AccessPolicy",
    name: CLINIC_POLICY_NAME,
    resource: [
      clinicCompartmentRule("Patient"),
      clinicCompartmentRule("Encounter"),
      clinicCompartmentRule("Observation"),
      clinicCompartmentRule("Condition"),
      clinicCompartmentRule("Procedure"),
      clinicCompartmentRule("MedicationRequest"),
      clinicCompartmentRule("MedicationStatement"),
      clinicCompartmentRule("AllergyIntolerance"),
      clinicCompartmentRule("ServiceRequest"),
      clinicCompartmentRule("DiagnosticReport"),
      clinicCompartmentRule("ImagingStudy"),
      clinicCompartmentRule("DocumentReference"),
      clinicCompartmentRule("Appointment"),
      clinicCompartmentRule("Invoice"),
      clinicCompartmentRule("Task"),
      clinicCompartmentRule("Basic"),
      clinicCompartmentRule("ChargeItemDefinition"),
      clinicCompartmentRule("Medication"),
      clinicCompartmentRule("Communication"),
      clinicCompartmentRule("QuestionnaireResponse"),
      {
        resourceType: "Practitioner",
        interaction: READ_INTERACTIONS,
      },
      {
        resourceType: "PractitionerRole",
        criteria: "PractitionerRole?organization=%clinicOrganization",
        interaction: READ_INTERACTIONS,
      },
      {
        resourceType: "Organization",
        criteria: "Organization?_id=%clinicOrganization",
        interaction: READ_INTERACTIONS,
      },
    ],
  });

  const platformAdminPolicy = await upsertAccessPolicy(medplum, {
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
  });

  const patientPortalPolicy = await upsertAccessPolicy(medplum, {
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
  });

  console.log("Medplum Access Policies ready:");
  console.log(`MEDPLUM_POLICY_CLINIC_STAFF=${clinicStaffPolicy.id}`);
  console.log(`MEDPLUM_POLICY_PLATFORM_ADMIN=${platformAdminPolicy.id}`);
  console.log(`MEDPLUM_POLICY_PATIENT=${patientPortalPolicy.id}`);
}

setupAccessPolicies().catch((error) => {
  console.error("Failed to setup Medplum access policies:", error);
  process.exit(1);
});
