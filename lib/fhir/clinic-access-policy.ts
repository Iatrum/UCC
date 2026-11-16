import type { AccessPolicyResource } from '@medplum/fhirtypes';

const READ: AccessPolicyResource['interaction'] = ['read', 'search', 'history', 'vread'];
// FHIR R4 Patient compartment reference paths (not the search parameter names).
// Task has no Patient compartment in R4 and retains its existing policy behavior.
const PATIENT_PATHS: Record<string, string[]> = {
  Encounter: ['subject'], Observation: ['subject', 'performer'],
  Condition: ['subject', 'asserter'], Procedure: ['subject', 'performer.actor'],
  MedicationRequest: ['subject'], MedicationStatement: ['subject'],
  AllergyIntolerance: ['patient', 'recorder', 'asserter'],
  ServiceRequest: ['subject', 'performer'], DiagnosticReport: ['subject'],
  ImagingStudy: ['subject'], DocumentReference: ['subject', 'author'],
  Appointment: ['participant.actor'], Invoice: ['subject', 'recipient'],
  Communication: ['subject', 'sender', 'recipient'],
  QuestionnaireResponse: ['subject', 'author'],
};

/** Version-specific write enforcement: see research/isolation-prereqs.md. */
export function clinicCompartmentRules(resourceType: string): AccessPolicyResource[] {
  const criteria = `${resourceType}?_compartment=%clinicAccount`;
  const paths = PATIENT_PATHS[resourceType];
  if (!paths) {
    return [{ resourceType, criteria, interaction: ['create', 'read', 'update', 'delete', 'search', 'history', 'vread'] }];
  }
  const writeConstraint: AccessPolicyResource["writeConstraint"] = [{
    language: 'text/fhirpath',
    // All access[] entries carry the same server-derived union. Existing
    // single-clinic memberships remain compatible without the new parameter.
    expression: "meta.accounts.exists() and meta.accounts.all(reference = '%clinicAccount' or reference.matches('%clinicWriteAccounts'))",
  }];
  // In a superAdmin project, extended writes may supply accounts. Removing
  // ALL incoming metadata on create forces server-side Patient inheritance.
  // On update Medplum restores the existing top-level meta, preserving accounts.
  const readonlyFields = ['meta'];
  const patients = (version: string) => `(${paths.map(path => `${version}.${path}`).join(' | ')})` +
    ".where(reference.startsWith('Patient/')).reference";
  const updateConstraint: NonNullable<AccessPolicyResource['writeConstraint']> = [...writeConstraint, {
    language: 'text/fhirpath',
    // Preserved metadata must not authorize reparenting to a foreign patient.
    expression: `${patients('%before')} ~ ${patients('%after')}`,
  }];
  return [
    { resourceType, criteria, interaction: READ },
    {
      resourceType, interaction: ['create'], readonlyFields, writeConstraint,
    },
    {
      resourceType, criteria,
      // Check the existing record as well as the candidate: foreign records
      // cannot be adopted into an allowed clinic by changing their patient.
      compartment: { reference: '%clinicAccount' },
      interaction: ['update', 'delete'], readonlyFields, writeConstraint: updateConstraint,
    },
  ];
}

export function clinicProvenanceRules(): AccessPolicyResource[] {
  // Targets do not inherit accounts: only the server helper may create audits,
  // after checking every target using the acting client's permissions.
  return [{ resourceType: 'Provenance', criteria: 'Provenance?_compartment=%clinicAccount', interaction: READ }];
}

export const CLINIC_POLICY_NAME = 'UCC Clinic Staff Policy';
export const APP_SERVER_POLICY_NAME = 'UCC App Server Policy';

/** Resource types whose rows are partitioned by clinic through meta.accounts. */
export const CLINIC_COMPARTMENT_TYPES = [
  'Patient', 'Encounter', 'Observation', 'Condition', 'Procedure', 'MedicationRequest',
  'MedicationStatement', 'AllergyIntolerance', 'ServiceRequest', 'DiagnosticReport',
  'ImagingStudy', 'DocumentReference', 'Appointment', 'Invoice', 'Task', 'Basic',
  'ChargeItemDefinition', 'Medication', 'Communication', 'QuestionnaireResponse',
  'Schedule', 'Slot',
] as const;

/**
 * Staff directory rules. Practitioner is partitioned by meta.accounts (one
 * clinic HealthcareService per active PractitionerRole, kept in sync by
 * admin-service `syncPractitionerClinicAccounts` and by the Task 5 migration),
 * plus the caller's own profile, so a clinic cannot enumerate another clinic's
 * staff. Medplum forbids `_has` in policy criteria (axp-3), so a reverse chain
 * through PractitionerRole is not possible. See .ai/research/task5-topology.md.
 */
export function clinicDirectoryRules(): AccessPolicyResource[] {
  return [
    {
      resourceType: 'Practitioner',
      criteria: 'Practitioner?_compartment=%clinicAccount',
      interaction: READ,
    },
    { resourceType: 'Practitioner', criteria: 'Practitioner?_id=%profile.id', interaction: READ },
    { resourceType: 'PractitionerRole', criteria: 'PractitionerRole?organization=%clinicOrganization', interaction: READ },
    { resourceType: 'Organization', criteria: 'Organization?_id=%clinicOrganization', interaction: READ },
    { resourceType: 'HealthcareService', criteria: 'HealthcareService?_id=%clinicAccount', interaction: READ },
  ];
}

/** The complete "UCC Clinic Staff Policy" resource list (single source of truth). */
export function clinicStaffPolicyResources(): AccessPolicyResource[] {
  return [
    ...CLINIC_COMPARTMENT_TYPES.flatMap((type) => clinicCompartmentRules(type)),
    ...clinicProvenanceRules(),
    ...clinicDirectoryRules(),
  ];
}

const ALL: AccessPolicyResource['interaction'] = ['create', 'read', 'update', 'delete', 'search', 'history', 'vread'];

/**
 * Least-privilege policy for the app server's ClientApplication (project
 * admin membership in the clinic project). Only the clinical, scheduling and
 * configuration types the app actually touches; NOT "*". Medplum adds the
 * project-admin grants (ProjectMembership/User/AccessPolicy/Project, all scoped
 * to the member's own project) because the membership is admin; it can never
 * reach other projects, Bot, ClientApplication, Login, Agent, etc.
 */
export function appServerPolicyResources(): AccessPolicyResource[] {
  const full = (resourceType: string): AccessPolicyResource => ({ resourceType, interaction: ALL });
  const readOnly = (resourceType: string): AccessPolicyResource => ({ resourceType, interaction: READ });
  return [
    ...CLINIC_COMPARTMENT_TYPES.map(full),
    ...['Provenance', 'AuditEvent', 'Questionnaire', 'Organization', 'HealthcareService', 'Location',
      'Practitioner', 'PractitionerRole', 'Device', 'Subscription', 'Binary', 'StructureDefinition'].map(full),
    ...['SearchParameter', 'ValueSet', 'CodeSystem'].map(readOnly),
  ];
}
