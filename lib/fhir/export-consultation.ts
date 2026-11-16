/**
 * Export consultation to Medplum as FHIR resources
 * This runs automatically when a consultation is created
 */

import { MedplumClient } from '@medplum/core';
import type { Observation } from '@medplum/fhirtypes';
import type { Consultation } from '@/lib/models';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { makeClinicStamper } from '@/lib/fhir/write-containment';

async function getMedplumClient(): Promise<MedplumClient | null> {
  try {
    return await getAdminMedplum();
  } catch (error) {
    console.error('❌ Failed to get Medplum admin client:', error);
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
  },
  clinicId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const medplum = await getMedplumClient();
    if (!medplum) {
      return { success: false, error: 'Medplum not configured' };
    }

    // Task 350: fail closed - every export is owned by exactly one clinic.
    if (!clinicId) {
      return { success: false, error: 'Clinic context is required' };
    }
    const { stamp, isOwn, patientSearch } = await makeClinicStamper(medplum, clinicId);

    console.log(`📤 Exporting consultation ${consultation.id} to Medplum...`);

    // 1. Create or get Patient resource
    let patient;
    if (patientData.ic) {
      // Only re-use a Patient that belongs to this clinic; never read across clinics.
      const matches = await medplum.searchResources('Patient', { ...patientSearch, identifier: patientData.ic }, { cache: 'no-cache', headers: { 'X-Medplum': 'extended' } });
      patient = matches.find((candidate) => isOwn(candidate));
    }

    if (!patient) {
      patient = await medplum.createResource(stamp({
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
      }));
      console.log(`✅ Created Patient: ${(patient as any).id}`);
    } else {
      console.log(`✅ Found existing Patient: ${(patient as any).id}`);
    }

    // 2. Create Encounter
    const encounterDate = consultation.date
      ? new Date(consultation.date).toISOString()
      : new Date().toISOString();

    const encounter = await medplum.createResource(stamp({
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
    }));
    console.log(`✅ Created Encounter: ${(encounter as any).id}`);

    // 3. Create Condition (Diagnosis)
    if (consultation.diagnosis) {
      const condition = await medplum.createResource(stamp({
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
      }));
      console.log(`✅ Created Condition: ${(condition as any).id}`);
    }

    // 4. Create Observation for Chief Complaint
    if (consultation.chiefComplaint) {
      const observation = await medplum.createResource<Observation>(stamp({
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
      }));
      console.log(`✅ Created Chief Complaint Observation: ${(observation as any).id}`);
    }

    // 5. Create Observation for Clinical Notes
    if (consultation.notes) {
      const notesObs = await medplum.createResource<Observation>(stamp({
        resourceType: 'Observation',
        status: 'final',
        subject: {
          reference: `Patient/${(patient as any).id}`,
        },
        encounter: {
          reference: `Encounter/${(encounter as any).id}`,
        },
        code: {
          text: 'Clinical Notes',
        },
        valueString: consultation.notes,
        effectiveDateTime: encounterDate,
      }));
      console.log(`✅ Created Clinical Notes Observation: ${notesObs.id}`);
    }

    // 6. Create Procedures
    if (consultation.procedures && consultation.procedures.length > 0) {
      for (const proc of consultation.procedures) {
        const procedure = await medplum.createResource(stamp({
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
        }));
        console.log(`✅ Created Procedure: ${(procedure as any).id}`);
      }
    }

    // 7. Create MedicationRequests (Prescriptions)
    if (consultation.prescriptions && consultation.prescriptions.length > 0) {
      for (const rx of consultation.prescriptions) {
        const medicationRequest = await medplum.createResource(stamp({
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
        }));
        console.log(`✅ Created MedicationRequest: ${(medicationRequest as any).id}`);
      }
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
