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
