import type { AccessPolicyResource } from '@medplum/fhirtypes';

const READ: AccessPolicyResource['interaction'] = ['read', 'search', 'history', 'vread'];
// These resources inherit their accounts from Patient compartment references.
const PATIENT_LINKED = new Set([
  'Encounter', 'Observation', 'Condition', 'Procedure', 'MedicationRequest',
  'MedicationStatement', 'AllergyIntolerance', 'ServiceRequest', 'DiagnosticReport',
  'ImagingStudy', 'DocumentReference', 'Appointment', 'Invoice', 'Task',
  'Communication', 'QuestionnaireResponse',
]);

/** Version-specific write enforcement: see research/isolation-prereqs.md. */
export function clinicCompartmentRules(resourceType: string): AccessPolicyResource[] {
  const criteria = `${resourceType}?_compartment=%clinicAccount`;
  if (!PATIENT_LINKED.has(resourceType)) {
    return [{ resourceType, criteria, interaction: ['create', 'read', 'update', 'delete', 'search', 'history', 'vread'] }];
  }
  const writeConstraint: AccessPolicyResource["writeConstraint"] = [{
    language: 'text/fhirpath',
    // All access[] entries carry the same server-derived union. Existing
    // single-clinic memberships remain compatible without the new parameter.
    expression: "meta.accounts.exists() and meta.accounts.all(reference = '%clinicAccount' or reference.matches('%clinicWriteAccounts'))",
  }];
  const readonlyFields = ['meta.accounts', 'meta.account', 'meta.compartment'];
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
      interaction: ['update', 'delete'], readonlyFields, writeConstraint,
    },
  ];
}

export function clinicProvenanceRules(): AccessPolicyResource[] {
  // Targets do not inherit accounts: only the server helper may create audits,
  // after checking every target using the acting client's permissions.
  return [{ resourceType: 'Provenance', criteria: 'Provenance?_compartment=%clinicAccount', interaction: READ }];
}
