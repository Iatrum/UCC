/**
 * Consultation Service - Medplum as Source of Truth
 * 
 * This service treats Medplum FHIR server as the primary database.
 * All consultations are saved to and retrieved from Medplum.
 */

import { MedplumClient } from '@medplum/core';
import type { 
  Patient as FHIRPatient,
  Encounter,
  Condition,
  Composition,
  Observation,
  Procedure,
  MedicationRequest,
} from '@medplum/fhirtypes';
import { findDiagnosisByText } from './terminologies/diagnoses';
import { findMedicationByName } from './terminologies/medications';
import { validateFhirResource, logValidation } from './validation';
import { createProvenanceForResource } from './provenance-service';
import { applyMyCoreProfile, MY_CORE_IDENTIFIERS } from './mycore';

// Local types that match your app's interface
export interface ConsultationData {
  patientId: string;
  chiefComplaint?: string;
  diagnosis: string;
  procedures?: Array<{ name: string; price?: number }>;
  notes?: string;
  progressNote?: string;
  prescriptions?: Array<{
    medication: { id: string; name: string };
    frequency: string;
    duration: string;
    price?: number;
    strength?: string;
  }>;
  date?: Date;
  practitionerId?: string; // FHIR Practitioner ID
  organizationId?: string; // FHIR Organization ID
}

export interface SavedConsultation extends ConsultationData {
  id: string; // Encounter ID
  patientName?: string;
  createdAt: Date;
}

let medplumClient: MedplumClient | undefined;
let medplumInitPromise: Promise<MedplumClient> | undefined;

const CLINIC_IDENTIFIER_SYSTEM = 'clinic';

function addClinicIdentifier(identifiers: { system?: string; value?: string }[] | undefined, clinicId?: string) {
  if (!clinicId) return identifiers;
  const nextIdentifiers = [...(identifiers || [])];
  const hasClinicId = nextIdentifiers.some((id) => id.system === CLINIC_IDENTIFIER_SYSTEM && id.value === clinicId);
  if (!hasClinicId) {
    nextIdentifiers.push({ system: CLINIC_IDENTIFIER_SYSTEM, value: clinicId });
  }
  return nextIdentifiers;
}

function matchesClinic(resource: { identifier?: { system?: string; value?: string }[]; serviceProvider?: { reference?: string }; managingOrganization?: { reference?: string } }, clinicId?: string) {
  if (!clinicId) return true;
  const identifierMatch = resource.identifier?.some((id) => id.system === CLINIC_IDENTIFIER_SYSTEM && id.value === clinicId);
  const serviceProviderMatch = resource.serviceProvider?.reference === `Organization/${clinicId}`;
  const managingOrgMatch = resource.managingOrganization?.reference === `Organization/${clinicId}`;
  return Boolean(identifierMatch || serviceProviderMatch || managingOrgMatch);
}

function withClinicIdentifiers<T extends { identifier?: { system?: string; value?: string }[] }>(resource: T, clinicId?: string): T {
  if (!clinicId) return resource;
  return {
    ...resource,
    identifier: addClinicIdentifier(resource.identifier, clinicId),
  };
}

function withServiceProvider<T extends { [key: string]: any }>(resource: T, clinicId?: string): T {
  if (!clinicId) return resource;
  return {
    ...resource,
    serviceProvider: { reference: `Organization/${clinicId}` },
  };
}

const SOAP_SECTION_ORDER = ['subjective', 'objective', 'assessment', 'plan'] as const;
type SoapSectionKey = typeof SOAP_SECTION_ORDER[number];

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toNarrative(text: string | undefined) {
  const safe = escapeHtml(text ?? '').replace(/\r\n/g, '\n').replace(/\n/g, '<br/>');
  return {
    status: 'generated',
    div: `<div xmlns="http://www.w3.org/1999/xhtml">${safe}</div>`,
  };
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function narrativeToText(narrative?: { div?: string }): string {
  if (!narrative?.div) {
    return '';
  }
  const withBreaks = narrative.div
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n');
  const stripped = withBreaks.replace(/<[^>]+>/g, '');
  return decodeHtml(stripped).replace(/\r/g, '').trim();
}

function parseSoapSections(note: string) {
  const trimmed = note.trim();
  if (!trimmed) {
    return {};
  }
  const matches = [...trimmed.matchAll(/(^|\n)\s*(subjective|objective|assessment|plan)\s*:\s*/gi)];
  if (matches.length === 0) {
    return { note: trimmed };
  }

  const sections: Partial<Record<SoapSectionKey, string>> = {};
  for (let idx = 0; idx < matches.length; idx += 1) {
    const match = matches[idx];
    const label = match[2]?.toLowerCase() as SoapSectionKey | undefined;
    if (!label) continue;
    const start = (match.index ?? 0) + match[0].length;
    const end = idx + 1 < matches.length ? matches[idx + 1].index ?? trimmed.length : trimmed.length;
    const content = trimmed.slice(start, end).trim();
    if (content) {
      sections[label] = content;
    }
  }
  return sections;
}

function buildSoapNoteFromComposition(composition: Composition): string | null {
  if (!composition.section || composition.section.length === 0) {
    const text = narrativeToText(composition.text as any);
    return text || null;
  }

  const byTitle = new Map<string, string>();
  composition.section.forEach((section) => {
    const title = section.title?.trim() || '';
    if (!title) return;
    const text = narrativeToText(section.text as any);
    if (text) {
      byTitle.set(title.toLowerCase(), text);
    }
  });

  const orderedLines: string[] = [];
  SOAP_SECTION_ORDER.forEach((key) => {
    const label = key[0].toUpperCase() + key.slice(1);
    const content = byTitle.get(label.toLowerCase());
    if (content) {
      orderedLines.push(`${label}:\n${content}`);
    }
  });

  if (orderedLines.length > 0) {
    return orderedLines.join('\n\n');
  }

  const fallback = composition.section
    .map((section) => {
      const title = section.title?.trim();
      const text = narrativeToText(section.text as any);
      if (!title || !text) {
        return null;
      }
      return `${title}:\n${text}`;
    })
    .filter((line): line is string => Boolean(line));

  return fallback.length ? fallback.join('\n\n') : null;
}

async function validateAndCreate<T extends { resourceType: string }>(medplum: MedplumClient, resource: T) {
  const profiledResource = applyMyCoreProfile(resource as any) as T;
  const validation = validateFhirResource(profiledResource);
  logValidation(resource.resourceType, validation);
  if (!validation.valid) {
    throw new Error(`Invalid ${resource.resourceType}: ${validation.errors.join(', ')}`);
  }
  return medplum.createResource(profiledResource);
}

/**
 * Get authenticated Medplum client (singleton)
 */
async function getMedplumClient(): Promise<MedplumClient> {
  if (medplumClient) return medplumClient;
  if (medplumInitPromise) return medplumInitPromise;

  const baseUrl = process.env.MEDPLUM_BASE_URL || process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL || 'http://localhost:8103';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Medplum credentials not configured. Set MEDPLUM_CLIENT_ID and MEDPLUM_CLIENT_SECRET');
  }

  medplumInitPromise = (async () => {
    const medplum = new MedplumClient({
      baseUrl,
      clientId,
      clientSecret,
    });
    await medplum.startClientLogin(clientId, clientSecret);
    console.log('✅ Connected to Medplum');
    medplumClient = medplum;
    return medplum;
  })();

  return medplumInitPromise;
}

/**
 * Find or create a FHIR Patient by Firebase patient ID
 */
async function getOrCreatePatient(
  medplum: MedplumClient,
  patientData: {
    id: string; // Firebase patient ID
    name: string;
    ic?: string;
    dob?: Date;
    gender?: string;
    phone?: string;
    address?: string;
  },
  clinicId?: string
): Promise<FHIRPatient> {
  // First try to read by FHIR ID (current app uses Medplum IDs)
  let patient: FHIRPatient | undefined;
  if (patientData.id) {
    try {
      patient = await medplum.readResource('Patient', patientData.id);
    } catch {
      // Not found by ID; continue with identifier search
    }
  }

  // Try to find existing patient by Firebase ID (legacy)
  if (!patient) {
    patient = await medplum.searchOne('Patient', {
      identifier: `firebase|${patientData.id}`,
    });
  }

  // If not found and we have IC, try searching by IC
  if (!patient && patientData.ic) {
    patient = await medplum.searchOne('Patient', {
      identifier: `ic|${patientData.ic}`,
    });
  }

  // Create new patient if not found
  if (!patient) {
    patient = await medplum.createResource(
      applyMyCoreProfile({
      resourceType: 'Patient',
      identifier: addClinicIdentifier(
        [
          { system: 'firebase', value: patientData.id },
          ...(patientData.ic ? [{ system: 'ic', value: patientData.ic }] : []),
        ],
        clinicId
      ),
      name: [
        {
          text: (patientData as any).name || (patientData as any).fullName,
          family: ((patientData as any).name || (patientData as any).fullName)?.split(' ').pop(),
          given: ((patientData as any).name || (patientData as any).fullName)?.split(' ').slice(0, -1),
        },
      ],
      birthDate: (patientData as any).dob?.toISOString?.().split('T')[0] || (patientData as any).dateOfBirth,
      gender: (patientData.gender?.toLowerCase() as 'male' | 'female' | 'other') || 'unknown',
      telecom: patientData.phone ? [{ system: 'phone', value: patientData.phone }] : undefined,
      address: patientData.address ? [{ text: patientData.address }] : undefined,
      managingOrganization: clinicId ? { reference: `Organization/${clinicId}` } : undefined,
      })
    );
    console.log(`✅ Created FHIR Patient: ${patient.id}`);
  } else if (clinicId && !matchesClinic(patient as any, clinicId)) {
    // Patient exists but not linked to this clinic -> deny
    throw new Error('Patient does not belong to this clinic');
  } else if (clinicId) {
    // Ensure existing patient carries clinic identifier/organization
    const needsClinicTag = !matchesClinic(patient as any, clinicId);
    if (needsClinicTag) {
      patient = await medplum.updateResource(
        applyMyCoreProfile({
          ...patient,
          identifier: addClinicIdentifier((patient as any).identifier, clinicId),
          managingOrganization: { reference: `Organization/${clinicId}` },
        } as any)
      );
    }
  }

  return patient;
}

/**
 * Save a consultation directly to Medplum (source of truth)
 * Returns the Encounter ID which acts as the consultation ID
 */
export async function saveConsultationToMedplum(
  consultation: ConsultationData,
  patientData: {
    id: string;
    name: string;
    ic?: string;
    dob?: Date;
    gender?: string;
    phone?: string;
    address?: string;
  },
  clinicId?: string
): Promise<string> {
  const medplum = await getMedplumClient();
  
  console.log(`💾 Saving consultation to Medplum (source of truth)...`);

  // 1. Verify patient exists in Medplum
  const patient = await getOrCreatePatient(medplum, patientData, clinicId);
  const patientReference = `Patient/${patient.id}`;

  // 2. Create Encounter (this is the consultation)
  const encounterDate = consultation.date?.toISOString() || new Date().toISOString();
  const practitionerRef = consultation.practitionerId
    ? `Practitioner/${consultation.practitionerId}`
    : undefined;

  const encounter = await validateAndCreate<Encounter>(medplum, withServiceProvider(withClinicIdentifiers({
      resourceType: 'Encounter',
      status: 'finished',
      class: {
        system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
        code: 'AMB',
        display: 'ambulatory',
      },
      type: [{
        coding: [{
          system: 'http://fhir.hie.moh.gov.my/CodeSystem/specialty-my-core',
          code: 'GP',
          display: 'General Practice',
        }],
        text: 'General Practice Consultation',
      }],
      subject: {
        reference: patientReference,
        display: patientData.name,
      },
      participant: practitionerRef ? [{
        type: [{
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType',
            code: 'PPRF',
            display: 'primary performer',
          }],
        }],
        individual: { reference: practitionerRef },
      }] : undefined,
      period: {
        start: encounterDate,
        end: encounterDate,
      },
      identifier: [
        {
          system: MY_CORE_IDENTIFIERS.ENCOUNTER_ID,
          value: `${consultation.patientId}-${Date.now()}`,
        },
      ],
    }, clinicId), clinicId));
  console.log(`✅ Created Encounter (Consultation): ${encounter.id}`);

  const createdConditions: Condition[] = [];
  const createdProcedures: Procedure[] = [];
  const createdMedications: MedicationRequest[] = [];
  let chiefComplaintObservation: Observation | undefined;

  // 3. Create Chief Complaint (Observation) if provided
  if (consultation.chiefComplaint) {
    chiefComplaintObservation = await validateAndCreate<Observation>(medplum, withClinicIdentifiers({
      resourceType: 'Observation',
      status: 'final',
      subject: { reference: patientReference },
      encounter: { reference: `Encounter/${encounter.id}` },
      code: {
        coding: [{ system: 'http://loinc.org', code: '8661-1', display: 'Chief Complaint' }],
        text: 'Chief Complaint',
      },
      valueString: consultation.chiefComplaint,
      effectiveDateTime: encounterDate,
    }, clinicId)) as Observation;
  }

  // 4. Create Diagnosis (Condition) with ICD-10/SNOMED if available
  if (consultation.diagnosis) {
    const diagnosisCode = findDiagnosisByText(consultation.diagnosis);
    const code: any = { text: consultation.diagnosis };
    if (diagnosisCode) {
      code.coding = [];
      if (diagnosisCode.icd10) {
        code.coding.push({
          system: 'http://hl7.org/fhir/sid/icd-10',
          code: diagnosisCode.icd10.code,
          display: diagnosisCode.icd10.display,
        });
      }
      if (diagnosisCode.snomed) {
        code.coding.push({
          system: 'http://snomed.info/sct',
          code: diagnosisCode.snomed.code,
          display: diagnosisCode.snomed.display,
        });
      }
    }

    const condition = await validateAndCreate<Condition>(medplum, withClinicIdentifiers({
      resourceType: 'Condition',
      subject: { reference: patientReference },
      encounter: { reference: `Encounter/${encounter.id}` },
      code,
      recordedDate: encounterDate,
      clinicalStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: 'active',
            display: 'Active',
          },
        ],
      },
      verificationStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
            code: 'confirmed',
            display: 'Confirmed',
          },
        ],
      },
    }, clinicId)) as Condition;
    createdConditions.push(condition);
  }

  // 6. Create Procedures
  if (consultation.procedures) {
    for (const proc of consultation.procedures) {
      const codeable = proc.codingCode || proc.codingDisplay || proc.codingSystem
        ? {
            coding: proc.codingCode
              ? [
                  {
                    system: proc.codingSystem || 'http://snomed.info/sct',
                    code: proc.codingCode,
                    display: proc.codingDisplay || proc.name,
                  },
                ]
              : undefined,
            text: proc.codingDisplay || proc.name,
          }
        : { text: proc.name };

      const procedure = await validateAndCreate<Procedure>(medplum, withClinicIdentifiers({
        resourceType: 'Procedure',
        status: 'completed',
        subject: { reference: patientReference },
        encounter: { reference: `Encounter/${encounter.id}` },
        code: codeable,
        performedDateTime: encounterDate,
      }, clinicId)) as Procedure;
      createdProcedures.push(procedure);
    }
  }

  // 7. Create Prescriptions (MedicationRequests)
  if (consultation.prescriptions) {
    for (const rx of consultation.prescriptions) {
      const medicationCode = findMedicationByName(rx.medication.name);
      const medicationCodeableConcept: any = {
        text: `${rx.medication.name}${rx.medication.strength ? ` ${rx.medication.strength}` : ''}`,
      };
      if (medicationCode?.rxnorm) {
        medicationCodeableConcept.coding = [
          {
            system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
            code: medicationCode.rxnorm.code,
            display: medicationCode.rxnorm.display,
          },
        ];
      }

      const medicationRequest = await validateAndCreate<MedicationRequest>(medplum, withClinicIdentifiers({
        resourceType: 'MedicationRequest',
        status: 'active',
        intent: 'order',
        subject: { reference: patientReference },
        encounter: { reference: `Encounter/${encounter.id}` },
        medicationCodeableConcept,
        requester: consultation.practitionerId
          ? { reference: `Practitioner/${consultation.practitionerId}` }
          : undefined,
        dosageInstruction: [
          {
            text: `${(rx as any).dosage || ''} ${rx.frequency || ''} for ${rx.duration || ''}`.trim(),
          },
        ],
        authoredOn: encounterDate,
      }, clinicId)) as MedicationRequest;
      createdMedications.push(medicationRequest);
    }
  }

  // 8. Create Composition — full encounter summary (Epic/MY Core best practice)
  {
    const compositionSections: any[] = [];

    // Chief Complaint section (LOINC 10154-3)
    if (chiefComplaintObservation?.id) {
      compositionSections.push({
        title: 'Chief Complaint',
        code: { coding: [{ system: 'http://loinc.org', code: '10154-3', display: 'Chief complaint' }] },
        text: toNarrative(consultation.chiefComplaint),
        entry: [{ reference: `Observation/${chiefComplaintObservation.id}` }],
      });
    }

    // Diagnoses section (LOINC 29308-4 — Problem list)
    if (createdConditions.length > 0) {
      compositionSections.push({
        title: 'Diagnoses',
        code: { coding: [{ system: 'http://loinc.org', code: '29308-4', display: 'Diagnosis' }] },
        text: toNarrative(createdConditions.map((c: any) => c.code?.text).filter(Boolean).join('; ')),
        entry: createdConditions.filter((c) => c.id).map((c) => ({ reference: `Condition/${c.id}` })),
      });
    }

    // Medications section (LOINC 10160-0)
    if (createdMedications.length > 0) {
      const medTexts = createdMedications.map((m: any) => {
        const name = m.medicationCodeableConcept?.text || 'Medication';
        const dosage = m.dosageInstruction?.[0]?.text || '';
        return dosage ? `${name} — ${dosage}` : name;
      });
      compositionSections.push({
        title: 'Medications',
        code: { coding: [{ system: 'http://loinc.org', code: '10160-0', display: 'History of Medication use' }] },
        text: toNarrative(medTexts.join('\n')),
        entry: createdMedications.filter((m) => m.id).map((m) => ({ reference: `MedicationRequest/${m.id}` })),
      });
    }

    // Procedures section (LOINC 47519-4)
    if (createdProcedures.length > 0) {
      compositionSections.push({
        title: 'Procedures',
        code: { coding: [{ system: 'http://loinc.org', code: '47519-4', display: 'History of Procedures' }] },
        text: toNarrative(createdProcedures.map((p: any) => p.code?.text).filter(Boolean).join('; ')),
        entry: createdProcedures.filter((p) => p.id).map((p) => ({ reference: `Procedure/${p.id}` })),
      });
    }

    // SOAP narrative sections — the doctor's clinical note
    if (consultation.notes) {
      const soapParsed = parseSoapSections(consultation.notes);
      const hasSoapSections = SOAP_SECTION_ORDER.some((key) => soapParsed[key]);

      if (hasSoapSections) {
        for (const key of SOAP_SECTION_ORDER) {
          const text = soapParsed[key];
          if (!text) continue;
          const title = key[0].toUpperCase() + key.slice(1);
          const SOAP_LOINC: Record<string, { code: string; display: string }> = {
            subjective: { code: '61150-9', display: 'Subjective' },
            objective: { code: '61149-1', display: 'Objective' },
            assessment: { code: '51848-0', display: 'Assessment' },
            plan: { code: '18776-5', display: 'Plan of care' },
          };
          compositionSections.push({
            title,
            code: { coding: [{ system: 'http://loinc.org', ...SOAP_LOINC[key] }] },
            text: toNarrative(text),
          });
        }
      } else {
        // Single clinical note (not parsed into SOAP sections)
        compositionSections.push({
          title: 'Clinical Notes',
          code: { coding: [{ system: 'http://loinc.org', code: '55752-0', display: 'Clinical information' }] },
          text: toNarrative(consultation.notes),
        });
      }
    }

    // Progress note section (LOINC 11506-3) — if separate from SOAP
    if (consultation.progressNote && consultation.progressNote !== consultation.notes) {
      compositionSections.push({
        title: 'Progress Note',
        code: { coding: [{ system: 'http://loinc.org', code: '11506-3', display: 'Progress note' }] },
        text: toNarrative(consultation.progressNote),
      });
    }

    // Only create Composition if there's meaningful content
    if (compositionSections.length > 0) {
      const compositionAuthor: { reference: string }[] = practitionerRef
        ? [{ reference: practitionerRef }]
        : clinicId
          ? [{ reference: `Organization/${clinicId}` }]
          : [{ reference: patientReference }];

      await validateAndCreate<Composition>(medplum, {
        resourceType: 'Composition',
        status: 'final',
        identifier: {
          system: MY_CORE_IDENTIFIERS.COMPOSITION_ID,
          value: `enc-${encounter.id}-${Date.now()}`,
        },
        type: {
          coding: [{ system: 'http://loinc.org', code: '34133-9', display: 'Summary of episode note' }],
        },
        title: `Visit Summary — ${new Date(encounterDate).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}`,
        subject: { reference: patientReference, display: patientData.name },
        encounter: { reference: `Encounter/${encounter.id}` },
        date: encounterDate,
        author: compositionAuthor,
        custodian: clinicId ? { reference: `Organization/${clinicId}` } : undefined,
        text: toNarrative(consultation.notes || consultation.diagnosis || 'Visit summary'),
        section: compositionSections,
      } as any);
    }
  }

  // Create Provenance for audit trail
  try {
    await createProvenanceForResource(
      'Encounter',
      encounter.id!,
      consultation.practitionerId,
      consultation.organizationId || clinicId,
      'CREATE'
    );
    console.log(`✅ Created Provenance for consultation audit trail`);
  } catch (error) {
    console.warn(`⚠️  Failed to create Provenance (non-blocking):`, error);
  }

  console.log(`✅ Consultation saved to Medplum: ${encounter.id}`);
  return encounter.id!;
}

/**
 * Get a consultation from Medplum by Encounter ID
 */
export async function getConsultationFromMedplum(encounterId: string, clinicId?: string): Promise<SavedConsultation | null> {
  try {
    const medplum = await getMedplumClient();
    
    // Get the encounter
    const encounter = await medplum.readResource('Encounter', encounterId);
    if (!matchesClinic(encounter as any, clinicId)) {
      return null;
    }
    
    // Get related resources
    const [conditions, observations, procedures, medications, compositions] = await Promise.all([
      medplum.searchResources('Condition', { encounter: `Encounter/${encounterId}` }),
      medplum.searchResources('Observation', { encounter: `Encounter/${encounterId}` }),
      medplum.searchResources('Procedure', { encounter: `Encounter/${encounterId}` }),
      medplum.searchResources('MedicationRequest', { encounter: `Encounter/${encounterId}` }),
      medplum.searchResources('Composition', { encounter: `Encounter/${encounterId}` }),
    ]);

    const patientId = encounter.subject?.reference?.replace('Patient/', '') || '';

    // Extract data
    const chiefComplaint = observations.find(
      (obs) => (obs as any).code?.text === 'Chief Complaint'
    );
    const clinicalNotes = observations.find(
      (obs) => (obs as any).code?.text === 'Clinical Notes'
    );

    const progressNote = observations.find(
      (obs) => (obs as any).code?.text === 'Progress Note'
    );

    const latestComposition = compositions
      .slice()
      .sort((a, b) => {
        const aTime = (a.meta?.lastUpdated ? new Date(a.meta.lastUpdated).getTime() : 0);
        const bTime = (b.meta?.lastUpdated ? new Date(b.meta.lastUpdated).getTime() : 0);
        return bTime - aTime;
      })[0];

    const soapNote = latestComposition ? buildSoapNoteFromComposition(latestComposition as Composition) : null;

    return {
      id: encounter.id!,
      patientId,
      patientName: encounter.subject?.display,
      chiefComplaint: (chiefComplaint as any)?.valueString || '',
      diagnosis: conditions[0] ? ((conditions[0] as any).code?.text || '') : '',
      notes: soapNote || (clinicalNotes as any)?.valueString,
      progressNote: (progressNote as any)?.valueString,
      procedures: procedures.map((proc) => ({
        name: (proc as any).code?.text || 'Procedure',
        price: 0,
      })),
      prescriptions: medications.map((med) => ({
        medication: {
          id: med.id || '',
          name: (med as any).medicationCodeableConcept?.text || 'Medication',
        },
        frequency: (med as any).dosageInstruction?.[0]?.text || '',
        duration: '',
        price: 0,
      })),
      date: encounter.period?.start ? new Date(encounter.period.start) : new Date(),
      createdAt: encounter.meta?.lastUpdated ? new Date(encounter.meta.lastUpdated) : new Date(),
    };
  } catch (error) {
    console.error('Failed to get consultation from Medplum:', error);
    return null;
  }
}

/**
 * Get all consultations for a patient by their Medplum Patient resource ID.
 */
export async function getPatientConsultationsFromMedplum(patientId: string, clinicId?: string): Promise<SavedConsultation[]> {
  try {
    const medplum = await getMedplumClient();

    const searchParams: Record<string, string> = {
      subject: `Patient/${patientId}`,
      _sort: '-date',
      ...(clinicId ? { 'service-provider': `Organization/${clinicId}` } : {}),
    };

    const encounters = await medplum.searchResources('Encounter', searchParams);

    const consultations = await Promise.all(
      encounters
        .filter((enc) => !clinicId || matchesClinic(enc as any, clinicId))
        .map((encounter) => getConsultationFromMedplum(encounter.id!, clinicId))
    );

    return consultations.filter((c): c is SavedConsultation => c !== null);
  } catch (error) {
    console.error('Failed to get patient consultations from Medplum:', error);
    return [];
  }
}

/**
 * Get all recent consultations (for dashboard, etc.)
 */
export async function getRecentConsultationsFromMedplum(limit = 10, clinicId?: string): Promise<SavedConsultation[]> {
  try {
    const medplum = await getMedplumClient();
    
    const encounters = await medplum.searchResources('Encounter', {
      _count: String(limit),
      _sort: '-date',
      ...(clinicId ? { 'service-provider': `Organization/${clinicId}`, identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}` } : {}),
    });

    const consultations = await Promise.all(
      encounters
        .filter((enc) => matchesClinic(enc as any, clinicId))
        .map((encounter) => getConsultationFromMedplum(encounter.id!, clinicId))
    );

    return consultations.filter((c): c is SavedConsultation => c !== null);
  } catch (error) {
    console.error('Failed to get recent consultations from Medplum:', error);
    return [];
  }
}
