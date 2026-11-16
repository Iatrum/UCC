import { Patient as AppPatient, Prescription, ProcedureRecord } from "@/lib/models";
import type { MedplumClient } from '@medplum/core';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { assertPatientInClinic, makeClinicStamper } from './write-containment';
import { findMedicationByName } from "./terminologies/medications";
import { formatMedicationNameWithStrength } from "@/lib/prescriptions";
import { validateFhirResource, logValidation } from "./validation";

type PatientInput = Omit<AppPatient, 'email' | 'postalCode' | 'address' | 'emergencyContact' | 'medicalHistory'> & {
  email?: string;
  postalCode?: string;
  address?: string;
  emergencyContact?: { name: string; relationship: string; phone: string };
  medicalHistory?: { allergies: string[]; conditions: string[]; medications: string[] };
};

type ConsultationInput = {
  date?: Date;
  updatedAt?: Date | string;
  type?: string;
  chiefComplaint?: string;
};

export async function toFhirPatient(app: PatientInput, clinicId?: string, client?: MedplumClient): Promise<{ reference: string; id: string }> {
  // MEDPLUM ONLY - No Firebase fallback
  const nameParts = app.fullName.trim().split(/\s+/);
  const family = nameParts.pop() || '';
  const given = nameParts.length > 0 ? nameParts : [app.fullName];

  const resource: any = {
    resourceType: "Patient",
    active: true,  // FHIR compliance: mark patient as active
    identifier: [
      {
        system: "http://www.nric.gov.my",
        value: app.nric,
        use: "official"
      }
    ],
    name: [
      {
        use: "official",
        text: app.fullName,
        family: family,
        given: given,
      }
    ],
    gender: app.gender,
    birthDate: typeof app.dateOfBirth === 'string'
      ? app.dateOfBirth.split('T')[0]
      : new Date(app.dateOfBirth).toISOString().split('T')[0],
    telecom: [
      ...(app.phone ? [{
        system: 'phone',
        value: app.phone,
        use: 'mobile'
      }] : []),
      ...(app.email ? [{
        system: 'email',
        value: app.email,
        use: 'home'
      }] : []),
    ],
    address: app.address ? [{
      use: 'home',
      text: app.address,
      postalCode: app.postalCode,
      country: 'MY',
    }] : undefined,
    contact: app.emergencyContact ? [{
      relationship: [{
        text: app.emergencyContact.relationship,
      }],
      name: { text: app.emergencyContact.name },
      telecom: [{
        system: 'phone',
        value: app.emergencyContact.phone,
        use: 'mobile',
      }],
    }] : undefined,
  };

  // Validate resource (always validate, but only throw in development)
  const validation = validateFhirResource(resource);
  if (!validation.valid) {
    console.error('❌ FHIR Patient validation failed:', validation.errors);
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`Invalid FHIR Patient: ${validation.errors.join(', ')}`);
    }
  }
  logValidation('Patient', validation);

  // Save to Medplum ONLY
  const created = await createScopedResource(resource, clinicId, client);
  return { reference: `Patient/${created.id}`, id: created.id };
}

export async function toFhirEncounter(
  patientRef: string,
  consult: ConsultationInput,
  practitionerRef?: string,  // Optional practitioner reference for FHIR compliance
  clinicId?: string,
  client?: MedplumClient
): Promise<{ reference: string; id: string }> {
  // MEDPLUM ONLY - No Firebase fallback
  const startDate = new Date(consult.date ?? new Date()).toISOString();
  const endDate = consult.updatedAt
    ? new Date(consult.updatedAt).toISOString()
    : startDate;

  const resource: any = {
    resourceType: "Encounter",
    status: "finished",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory"
    },
    type: [{
      text: consult.type || "General Consultation"
    }],
    subject: { reference: patientRef },
    participant: practitionerRef ? [{  // FHIR compliance: link practitioner
      type: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
          code: 'PPRF',
          display: 'primary performer'
        }]
      }],
      individual: { reference: practitionerRef }
    }] : undefined,
    period: {
      start: startDate,
      end: endDate
    },
    reasonCode: consult.chiefComplaint ? [{
      text: consult.chiefComplaint
    }] : undefined,
  };

  // Save to Medplum ONLY
  const created = await createScopedResource(resource, clinicId, client);
  return { reference: `Encounter/${created.id}`, id: created.id };
}

export async function toFhirCondition(patientRef: string, encounterRef: string, diagnosis: string, clinicId?: string, client?: MedplumClient): Promise<{ reference: string; id: string }> {
  // MEDPLUM ONLY - No Firebase fallback

  const code: any = {
    text: diagnosis
  };

  const resource: any = {
    resourceType: "Condition",
    subject: { reference: patientRef },
    encounter: { reference: encounterRef },
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
            code: 'encounter-diagnosis',
            display: 'Encounter Diagnosis'
          }
        ]
      }
    ],
    code,
    clinicalStatus: {
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
        code: 'active',
        display: 'Active'
      }]
    },
    verificationStatus: {
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
        code: 'confirmed',
        display: 'Confirmed'
      }]
    },
    recordedDate: new Date().toISOString(),
  };

  // Validate resource (always validate, but only throw in development)
  const validation = validateFhirResource(resource);
  if (!validation.valid) {
    console.error('❌ FHIR Condition validation failed:', validation.errors);
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`Invalid FHIR Condition: ${validation.errors.join(', ')}`);
    }
  }
  logValidation('Condition', validation);

  // Save to Medplum ONLY
  const created = await createScopedResource(resource, clinicId, client);
  return { reference: `Condition/${created.id}`, id: created.id };
}

export async function toFhirMedicationRequest(patientRef: string, encounterRef: string, p: Prescription, clinicId?: string, client?: MedplumClient): Promise<{ reference: string; id: string }> {
  // MEDPLUM ONLY - No Firebase fallback
  const freqMap: Record<string, number> = { od: 1, bd: 2, tds: 3, qid: 4 };
  const frequency = p.frequency ? freqMap[(p.frequency as string).toLowerCase()] : undefined;

  // Try to find coded medication (RxNorm)
  const medicationCode = findMedicationByName(p.medication.name);

  // Build medication code with RxNorm if available
  const medicationCodeableConcept: any = {
    text: formatMedicationNameWithStrength(p.medication.name, p.medication.strength)
  };

  if (medicationCode?.rxnorm) {
    medicationCodeableConcept.coding = [{
      system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
      code: medicationCode.rxnorm.code,
      display: medicationCode.rxnorm.display
    }];
  }

  const resource: any = {
    resourceType: "MedicationRequest",
    status: "active",
    intent: "order",
    subject: { reference: patientRef },
    encounter: { reference: encounterRef },
    medicationCodeableConcept,
    authoredOn: new Date().toISOString(),
    dosageInstruction: frequency ? [{
      timing: {
        repeat: {
          frequency,
          period: 1,
          periodUnit: 'd'
        }
      },
      text: `${p.frequency} for ${p.duration}`
    }] : undefined,
  };

  // Validate resource (always validate, but only throw in development)
  const validation = validateFhirResource(resource);
  if (!validation.valid) {
    console.error('❌ FHIR MedicationRequest validation failed:', validation.errors);
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`Invalid FHIR MedicationRequest: ${validation.errors.join(', ')}`);
    }
  }
  logValidation('MedicationRequest', validation);

  // Save to Medplum ONLY
  const created = await createScopedResource(resource, clinicId, client);
  return { reference: `MedicationRequest/${created.id}`, id: created.id };
}

export async function toFhirServiceRequest(patientRef: string, encounterRef: string, pr: ProcedureRecord, clinicId?: string, client?: MedplumClient): Promise<{ reference: string; id: string }> {
  // MEDPLUM ONLY - No Firebase fallback
  const codeable = pr.codingCode || pr.codingDisplay || pr.codingSystem
    ? {
      coding: pr.codingCode
        ? [{
          system: pr.codingSystem || undefined,
          code: pr.codingCode,
          display: pr.codingDisplay || pr.name
        }]
        : undefined,
      text: pr.codingDisplay || pr.name,
    }
    : { text: pr.name };

  const resource: any = {
    resourceType: "ServiceRequest",
    status: "completed",
    intent: "order",
    subject: { reference: patientRef },
    encounter: { reference: encounterRef },
    code: codeable,
    note: pr.notes ? [{ text: pr.notes }] : undefined,
    authoredOn: new Date().toISOString(),
  };

  // Save to Medplum ONLY
  const created = await createScopedResource(resource, clinicId, client);
  return { reference: `ServiceRequest/${created.id}`, id: created.id };
}

// All mapper writes use the same authorized client and tenant as the route.
async function createScopedResource(resource: any, clinicId?: string, client?: MedplumClient) {
  const medplum = client ?? await getAdminMedplum();
  const { stamp } = await makeClinicStamper(medplum, clinicId);
  if (resource.resourceType !== 'Patient') {
    const patientId = /^Patient\/([A-Za-z0-9.-]+)$/.exec(resource.subject?.reference ?? '')?.[1];
    const encounterId = resource.encounter?.reference?.slice('Encounter/'.length);
    await assertPatientInClinic(medplum, clinicId, patientId, encounterId);
  }
  return medplum.createResource(stamp(resource));
}
