/**
 * Export consultation to Medplum as FHIR resources
 * This runs automatically when a consultation is created
 */

import { MedplumClient } from '@medplum/core';
import type { Composition, Condition, MedicationRequest, Observation, Procedure } from '@medplum/fhirtypes';
import type { Consultation } from '@/lib/models';
import { applyMyCoreProfile } from './mycore';

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

/**
 * Get authenticated Medplum client
 */
async function getMedplumClient(): Promise<MedplumClient | null> {
  try {
    const baseUrl = process.env.MEDPLUM_BASE_URL || process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL;
    const clientId = process.env.MEDPLUM_CLIENT_ID;
    const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;

    if (!baseUrl || !clientId || !clientSecret) {
      console.warn('⚠️  Medplum not configured, skipping export');
      return null;
    }

    const medplum = new MedplumClient({
      baseUrl,
      clientId,
      clientSecret,
    });

    await medplum.startClientLogin(clientId, clientSecret);
    return medplum;
  } catch (error) {
    console.error('❌ Failed to initialize Medplum client:', error);
    return null;
  }
}

/**
 * Export a consultation to Medplum as FHIR resources
 * Creates: Patient, Encounter, Condition, Procedure, MedicationRequests
 */
export async function exportConsultationToMedplum(
  consultation: Consultation & { id: string },
  patientData: {
    name: string;
    ic?: string;
    dob?: Date;
    gender?: string;
    phone?: string;
    address?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const medplum = await getMedplumClient();
    if (!medplum) {
      return { success: false, error: 'Medplum not configured' };
    }

    console.log(`📤 Exporting consultation ${consultation.id} to Medplum...`);

    // 1. Create or get Patient resource
    let patient;
    if (patientData.ic) {
      patient = await medplum.searchOne('Patient', {
        identifier: patientData.ic,
      });
    }

    if (!patient) {
      patient = await medplum.createResource(
        applyMyCoreProfile({
        resourceType: 'Patient',
        identifier: patientData.ic
          ? [{ system: 'urn:ic', value: patientData.ic }]
          : [{ system: 'urn:firebase', value: consultation.patientId }],
        name: [
          {
            text: patientData.name,
            family: patientData.name.split(' ').pop(),
            given: patientData.name.split(' ').slice(0, -1),
          },
        ],
        birthDate: patientData.dob?.toISOString().split('T')[0],
        gender: (patientData.gender?.toLowerCase() as 'male' | 'female' | 'other') || 'unknown',
        telecom: patientData.phone
          ? [{ system: 'phone', value: patientData.phone }]
          : undefined,
        address: patientData.address ? [{ text: patientData.address }] : undefined,
        })
      );
      console.log(`✅ Created Patient: ${(patient as any).id}`);
    } else {
      console.log(`✅ Found existing Patient: ${(patient as any).id}`);
    }

    // 2. Create Encounter
    const encounterDate = consultation.date
      ? new Date(consultation.date).toISOString()
      : new Date().toISOString();

    const encounter = await medplum.createResource(
      applyMyCoreProfile({
      resourceType: 'Encounter',
      status: 'finished',
      class: {
        system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
        code: 'AMB',
        display: 'ambulatory',
      },
      subject: {
        reference: `Patient/${(patient as any).id}`,
        display: patientData.name,
      },
      period: {
        start: encounterDate,
        end: encounterDate,
      },
      identifier: [
        {
          system: 'urn:firebase-consultation',
          value: consultation.id,
        },
      ],
      })
    );
    console.log(`✅ Created Encounter: ${(encounter as any).id}`);

    const createdConditions: Condition[] = [];
    const createdProcedures: Procedure[] = [];
    const createdMedications: MedicationRequest[] = [];
    let chiefComplaintObservation: Observation | undefined;

    // 3. Create Condition (Diagnosis)
    if (consultation.diagnosis) {
      const condition = await medplum.createResource(
        applyMyCoreProfile({
        resourceType: 'Condition',
        subject: {
          reference: `Patient/${(patient as any).id}`,
        },
        encounter: {
          reference: `Encounter/${(encounter as any).id}`,
        },
        code: {
          text: consultation.diagnosis,
        },
        recordedDate: encounterDate,
        })
      );
      console.log(`✅ Created Condition: ${(condition as any).id}`);
      createdConditions.push(condition as Condition);
    }

    // 4. Create Observation for Chief Complaint
    if (consultation.chiefComplaint) {
      const observation = await medplum.createResource<Observation>(
        applyMyCoreProfile({
        resourceType: 'Observation',
        status: 'final',
        subject: {
          reference: `Patient/${(patient as any).id}`,
        },
        encounter: {
          reference: `Encounter/${(encounter as any).id}`,
        },
        code: {
          text: 'Chief Complaint',
        },
        valueString: consultation.chiefComplaint,
        effectiveDateTime: encounterDate,
        }) as Observation
      );
      console.log(`✅ Created Chief Complaint Observation: ${(observation as any).id}`);
      chiefComplaintObservation = observation;
    }
    
    // 5. Create Procedures
    if (consultation.procedures && consultation.procedures.length > 0) {
      for (const proc of consultation.procedures) {
        const procedure = await medplum.createResource(
          applyMyCoreProfile({
          resourceType: 'Procedure',
          status: 'completed',
          subject: {
            reference: `Patient/${(patient as any).id}`,
          },
          encounter: {
            reference: `Encounter/${(encounter as any).id}`,
          },
          code: {
            text: typeof proc === 'string' ? proc : (proc as any).name || 'Procedure',
          },
          performedDateTime: encounterDate,
          })
        );
        console.log(`✅ Created Procedure: ${(procedure as any).id}`);
        createdProcedures.push(procedure as Procedure);
      }
    }

    // 6. Create MedicationRequests (Prescriptions)
    if (consultation.prescriptions && consultation.prescriptions.length > 0) {
      for (const rx of consultation.prescriptions) {
        const medicationRequest = await medplum.createResource(
          applyMyCoreProfile({
          resourceType: 'MedicationRequest',
          status: 'active',
          intent: 'order',
          subject: {
            reference: `Patient/${(patient as any).id}`,
          },
          encounter: {
            reference: `Encounter/${(encounter as any).id}`,
          },
          medicationCodeableConcept: {
            text: rx.medication?.name || 'Medication',
          },
          dosageInstruction: [
            {
              text: `${rx.frequency} for ${rx.duration}`,
              timing: {
                repeat: {
                  frequency: 1,
                  period: 1,
                  periodUnit: 'd',
                },
              },
            },
          ],
          authoredOn: encounterDate,
          })
        );
        console.log(`✅ Created MedicationRequest: ${(medicationRequest as any).id}`);
        createdMedications.push(medicationRequest as MedicationRequest);
      }
    }

    // 7. Create SOAP Note (Composition)
    if (consultation.notes) {
      const planEntries = [
        ...createdProcedures.filter((proc) => proc.id).map((proc) => ({ reference: `Procedure/${proc.id}` })),
        ...createdMedications.filter((med) => med.id).map((med) => ({ reference: `MedicationRequest/${med.id}` })),
      ];

      const assessmentEntries = createdConditions
        .filter((condition) => condition.id)
        .map((condition) => ({ reference: `Condition/${condition.id}` }));

      const subjectiveEntries = chiefComplaintObservation?.id
        ? [{ reference: `Observation/${chiefComplaintObservation.id}` }]
        : [];

      const allEntries = [...subjectiveEntries, ...assessmentEntries, ...planEntries];

      await medplum.createResource<Composition>(
        applyMyCoreProfile({
          resourceType: 'Composition',
          status: 'final',
          type: {
            coding: [{ system: 'http://loinc.org', code: '11506-3', display: 'Progress note' }],
            text: 'SOAP note',
          },
          title: 'SOAP Note',
          subject: {
            reference: `Patient/${(patient as any).id}`,
          },
          encounter: {
            reference: `Encounter/${(encounter as any).id}`,
          },
          date: encounterDate,
          text: toNarrative(consultation.notes),
          section: [
            {
              title: 'SOAP Note',
              text: toNarrative(consultation.notes),
              ...(allEntries.length ? { entry: allEntries } : {}),
            },
          ],
        }) as Composition
      );
      console.log(`✅ Created SOAP Composition`);
    }

    console.log(`✅ Successfully exported consultation ${consultation.id} to Medplum`);
    return { success: true };
  } catch (error: any) {
    console.error(`❌ Failed to export consultation to Medplum:`, error);
    return {
      success: false,
      error: error.message || String(error),
    };
  }
}
