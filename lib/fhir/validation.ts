/**
 * FHIR Resource Validation
 * 
 * Validates FHIR resources against basic requirements
 */

import type { Resource } from '@medplum/fhirtypes';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a FHIR resource
 */
export function validateFhirResource(resource: any): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check resourceType
  if (!resource.resourceType) {
    errors.push('Missing required field: resourceType');
    return { valid: false, errors, warnings };
  }

  // Validate based on resource type
  switch (resource.resourceType) {
    case 'Patient':
      validatePatient(resource, errors, warnings);
      break;
    case 'Encounter':
      validateEncounter(resource, errors, warnings);
      break;
    case 'Condition':
      validateCondition(resource, errors, warnings);
      break;
    case 'MedicationRequest':
      validateMedicationRequest(resource, errors, warnings);
      break;
    case 'ServiceRequest':
      validateServiceRequest(resource, errors, warnings);
      break;
    case 'DocumentReference':
      validateDocumentReference(resource, errors, warnings);
      break;
    case 'Observation':
      validateObservation(resource, errors, warnings);
      break;
    case 'ImagingStudy':
      validateImagingStudy(resource, errors, warnings);
      break;
    case 'DiagnosticReport':
      validateDiagnosticReport(resource, errors, warnings);
      break;
    case 'AllergyIntolerance':
      validateAllergyIntolerance(resource, errors, warnings);
      break;
    case 'MedicationStatement':
      validateMedicationStatement(resource, errors, warnings);
      break;
    default:
      warnings.push(`No specific validation for ${resource.resourceType}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate Patient resource
 */
function validatePatient(patient: any, errors: string[], warnings: string[]) {
  // Required fields
  if (!patient.name || patient.name.length === 0) {
    errors.push('Patient: name is required');
  } else {
    const name = patient.name[0];
    if (!name.text && (!name.family || !name.given)) {
      warnings.push('Patient: name should have either text or family+given');
    }
  }

  // Identifiers
  if (!patient.identifier || patient.identifier.length === 0) {
    warnings.push('Patient: identifier is recommended');
  } else {
    patient.identifier.forEach((id: any, idx: number) => {
      if (!id.system) {
        warnings.push(`Patient: identifier[${idx}] should have a system`);
      }
      if (!id.value) {
        errors.push(`Patient: identifier[${idx}] must have a value`);
      }
    });
  }

  // Gender
  if (patient.gender && !['male', 'female', 'other', 'unknown'].includes(patient.gender)) {
    errors.push(`Patient: invalid gender value '${patient.gender}'`);
  }

  // Birth date format
  if (patient.birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(patient.birthDate)) {
    errors.push('Patient: birthDate must be in YYYY-MM-DD format');
  }

  // Telecom
  if (patient.telecom) {
    patient.telecom.forEach((tel: any, idx: number) => {
      if (!tel.system) {
        warnings.push(`Patient: telecom[${idx}] should have a system`);
      }
      if (!tel.value) {
        errors.push(`Patient: telecom[${idx}] must have a value`);
      }
    });
  }
}

/**
 * Validate Encounter resource
 */
function validateEncounter(encounter: any, errors: string[], warnings: string[]) {
  // Required fields
  if (!encounter.status) {
    errors.push('Encounter: status is required');
  } else if (!['planned', 'arrived', 'triaged', 'in-progress', 'onleave', 'finished', 'cancelled'].includes(encounter.status)) {
    errors.push(`Encounter: invalid status '${encounter.status}'`);
  }

  if (!encounter.class) {
    errors.push('Encounter: class is required');
  }

  if (!encounter.subject || !encounter.subject.reference) {
    errors.push('Encounter: subject reference is required');
  }

  // Period
  if (encounter.period) {
    if (!encounter.period.start) {
      warnings.push('Encounter: period.start is recommended');
    }
    if (encounter.status === 'finished' && !encounter.period.end) {
      warnings.push('Encounter: period.end is recommended for finished encounters');
    }
  }

  // References
  validateReference(encounter.subject, 'Encounter.subject', errors);
}

/**
 * Validate Condition resource
 */
function validateCondition(condition: any, errors: string[], warnings: string[]) {
  // Required fields
  if (!condition.subject || !condition.subject.reference) {
    errors.push('Condition: subject reference is required');
  }

  if (!condition.code) {
    errors.push('Condition: code is required');
  } else {
    if (!condition.code.text && (!condition.code.coding || condition.code.coding.length === 0)) {
      errors.push('Condition: code must have either text or coding');
    }
  }

  // Clinical status
  if (condition.clinicalStatus) {
    const validClinicalStatuses = ['active', 'recurrence', 'relapse', 'inactive', 'remission', 'resolved'];
    const code = condition.clinicalStatus.coding?.[0]?.code;
    if (code && !validClinicalStatuses.includes(code)) {
      errors.push(`Condition: invalid clinicalStatus '${code}'`);
    }
  }

  // Verification status
  if (condition.verificationStatus) {
    const validVerificationStatuses = ['unconfirmed', 'provisional', 'differential', 'confirmed', 'refuted', 'entered-in-error'];
    const code = condition.verificationStatus.coding?.[0]?.code;
    if (code && !validVerificationStatuses.includes(code)) {
      errors.push(`Condition: invalid verificationStatus '${code}'`);
    }
  }

  // References
  validateReference(condition.subject, 'Condition.subject', errors);
  if (condition.encounter) {
    validateReference(condition.encounter, 'Condition.encounter', errors);
  }
}

/**
 * Validate MedicationRequest resource
 */
function validateMedicationRequest(medReq: any, errors: string[], warnings: string[]) {
  // Required fields
  if (!medReq.status) {
    errors.push('MedicationRequest: status is required');
  } else if (!['active', 'on-hold', 'cancelled', 'completed', 'entered-in-error', 'stopped', 'draft', 'unknown'].includes(medReq.status)) {
    errors.push(`MedicationRequest: invalid status '${medReq.status}'`);
  }

  if (!medReq.intent) {
    errors.push('MedicationRequest: intent is required');
  } else if (!['proposal', 'plan', 'order', 'original-order', 'reflex-order', 'filler-order', 'instance-order', 'option'].includes(medReq.intent)) {
    errors.push(`MedicationRequest: invalid intent '${medReq.intent}'`);
  }

  if (!medReq.subject || !medReq.subject.reference) {
    errors.push('MedicationRequest: subject reference is required');
  }

  // Medication
  if (!medReq.medicationCodeableConcept && !medReq.medicationReference) {
    errors.push('MedicationRequest: medication is required (medicationCodeableConcept or medicationReference)');
  }

  // References
  validateReference(medReq.subject, 'MedicationRequest.subject', errors);
  if (medReq.encounter) {
    validateReference(medReq.encounter, 'MedicationRequest.encounter', errors);
  }
}

/**
 * Validate ServiceRequest resource
 */
function validateServiceRequest(servReq: any, errors: string[], warnings: string[]) {
  // Required fields
  if (!servReq.status) {
    errors.push('ServiceRequest: status is required');
  } else if (!['draft', 'active', 'on-hold', 'revoked', 'completed', 'entered-in-error', 'unknown'].includes(servReq.status)) {
    errors.push(`ServiceRequest: invalid status '${servReq.status}'`);
  }

  if (!servReq.intent) {
    errors.push('ServiceRequest: intent is required');
  } else if (!['proposal', 'plan', 'directive', 'order', 'original-order', 'reflex-order', 'filler-order', 'instance-order', 'option'].includes(servReq.intent)) {
    errors.push(`ServiceRequest: invalid intent '${servReq.intent}'`);
  }

  if (!servReq.subject || !servReq.subject.reference) {
    errors.push('ServiceRequest: subject reference is required');
  }

  // Code
  if (servReq.code && !servReq.code.text && (!servReq.code.coding || servReq.code.coding.length === 0)) {
    warnings.push('ServiceRequest: code should have text or coding');
  }

  // References
  validateReference(servReq.subject, 'ServiceRequest.subject', errors);
  if (servReq.encounter) {
    validateReference(servReq.encounter, 'ServiceRequest.encounter', errors);
  }
}

/**
 * Validate DocumentReference resource
 */
function validateDocumentReference(resource: any, errors: string[], warnings: string[]): void {
  if (!resource.status) {
    errors.push('DocumentReference: Missing required field: status');
  }

  if (!resource.type) {
    errors.push('DocumentReference: Missing required field: type');
  }

  if (!resource.subject?.reference) {
    errors.push('DocumentReference: Missing required field: subject');
  }

  if (!resource.content || resource.content.length === 0) {
    errors.push('DocumentReference: Missing required field: content');
  } else {
    resource.content.forEach((c: any, idx: number) => {
      if (!c.attachment) {
        errors.push(`DocumentReference: content[${idx}] missing attachment`);
      } else {
        if (!c.attachment.contentType) {
          warnings.push(`DocumentReference: content[${idx}] missing attachment.contentType`);
        }
        if (!c.attachment.url && !c.attachment.data) {
          errors.push(`DocumentReference: content[${idx}] attachment missing url or data`);
        }
      }
    });
  }

  if (!resource.author || resource.author.length === 0) {
    warnings.push('DocumentReference: Missing recommended field: author');
  }
}

/**
 * Validate Observation resource
 */
function validateObservation(obs: any, errors: string[], warnings: string[]) {
  if (!obs.status) {
    errors.push('Observation: status is required');
  }

  if (!obs.code) {
    errors.push('Observation: code is required');
  } else {
    if (!obs.code.text && (!obs.code.coding || obs.code.coding.length === 0)) {
      warnings.push('Observation: code should have text or coding');
    }
  }

  if (!obs.subject || !obs.subject.reference) {
    errors.push('Observation: subject reference is required');
  }

  validateReference(obs.subject, 'Observation.subject', errors);
  if (obs.encounter) {
    validateReference(obs.encounter, 'Observation.encounter', errors);
  }
}

/**
 * Validate ImagingStudy resource
 */
function validateImagingStudy(study: any, errors: string[], warnings: string[]) {
  if (!study.status) {
    errors.push('ImagingStudy: status is required');
  }

  if (!study.subject || !study.subject.reference) {
    errors.push('ImagingStudy: subject reference is required');
  }

  validateReference(study.subject, 'ImagingStudy.subject', errors);
  if (study.encounter) {
    validateReference(study.encounter, 'ImagingStudy.encounter', errors);
  }
}

/**
 * Validate DiagnosticReport resource
 */
function validateDiagnosticReport(report: any, errors: string[], warnings: string[]) {
  if (!report.status) {
    errors.push('DiagnosticReport: status is required');
  }

  if (!report.code) {
    errors.push('DiagnosticReport: code is required');
  }

  if (!report.subject || !report.subject.reference) {
    errors.push('DiagnosticReport: subject reference is required');
  }

  validateReference(report.subject, 'DiagnosticReport.subject', errors);
  if (report.encounter) {
    validateReference(report.encounter, 'DiagnosticReport.encounter', errors);
  }
}

/**
 * Validate AllergyIntolerance resource
 */
function validateAllergyIntolerance(allergy: any, errors: string[], warnings: string[]) {
  if (!allergy.patient || !allergy.patient.reference) {
    errors.push('AllergyIntolerance: patient reference is required');
  }

  if (!allergy.code) {
    errors.push('AllergyIntolerance: code is required');
  }

  validateReference(allergy.patient, 'AllergyIntolerance.patient', errors);
}

/**
 * Validate MedicationStatement resource
 */
function validateMedicationStatement(med: any, errors: string[], warnings: string[]) {
  if (!med.status) {
    errors.push('MedicationStatement: status is required');
  }

  if (!med.subject || !med.subject.reference) {
    errors.push('MedicationStatement: subject reference is required');
  }

  if (!med.medicationCodeableConcept && !med.medicationReference) {
    errors.push('MedicationStatement: medication is required');
  }

  validateReference(med.subject, 'MedicationStatement.subject', errors);
}

/**
 * Validate a FHIR reference
 */
function validateReference(reference: any, fieldName: string, errors: string[]) {
  if (!reference) return;

  if (!reference.reference) {
    errors.push(`${fieldName}: reference must have a reference value`);
  } else if (!/^[A-Z][a-zA-Z]+\/[A-Za-z0-9\-\.]{1,64}$/.test(reference.reference)) {
    errors.push(`${fieldName}: reference format should be 'ResourceType/id'`);
  }
}

/**
 * Log validation result
 */
export function logValidation(resourceType: string, result: ValidationResult) {
  if (result.valid) {
    console.log(`✅ ${resourceType} validation passed`);
  } else {
    console.error(`❌ ${resourceType} validation failed:`, result.errors);
  }
  
  if (result.warnings.length > 0) {
    console.warn(`⚠️  ${resourceType} warnings:`, result.warnings);
  }
}







