import { Consultation } from '@/lib/models'; // Import canonical types
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { getConsultationFromMedplum, getPatientConsultationsFromMedplum } from '../fhir/consultation-service';
import { withClinicIdentifier } from '../fhir/clinic-tenancy';
import { assertEncounterInClinic } from '../fhir/write-containment';

// Removed local Prescription interface definition
/*
export interface Prescription {
  medication: {
    id: string;
    name: string;
    strength?: string;
  };
  frequency: string;
  duration: string;
}
*/

// Removed local Consultation interface definition
/*
export interface Consultation {
  id?: string;
  patientId: string;
  chiefComplaint: string;
  diagnosis: string;
  procedures: string[];
  additionalNotes?: string;
  prescriptions: Prescription[];
  createdAt?: Date;
  updatedAt?: Date;
}
*/

const CONSULTATIONS = 'consultations';

// createConsultation function might be moved entirely to models.ts
// If kept here, ensure it uses the imported types correctly
/*
export async function createConsultation(consultation: Omit<Consultation, 'id' | 'createdAt' | 'updatedAt'>): Promise<string | null> {
  try {
    const docRef = await addDoc(collection(db, CONSULTATIONS), {
      ...consultation,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
    return docRef.id;
  } catch (error) {
    console.error('Error creating consultation:', error);
    return null;
  }
}
*/

// Ensure other functions use the imported Consultation type
export async function getConsultationsByPatient(patientId: string): Promise<Consultation[]> {
  try {
    const medplum = await getAdminMedplum();
    const consultations = await getPatientConsultationsFromMedplum(patientId, undefined, medplum);
    return consultations as unknown as Consultation[];
  } catch (error) {
    console.error('Error fetching patient consultations:', error);
    return [];
  }
}

export async function getConsultationById(id: string): Promise<Consultation | null> {
  try {
    const medplum = await getAdminMedplum();
    const consultation = await getConsultationFromMedplum(id, undefined, medplum);
    return (consultation as unknown as Consultation) ?? null;
  } catch (error) {
    console.error('Error fetching consultation:', error);
    return null;
  }
}

export async function updateConsultation(id: string, consultation: Partial<Consultation>, clinicId?: string): Promise<boolean> {
  try {
    // Task 350: fail closed - the encounter must belong to the caller's clinic.
    const medplum = await getAdminMedplum();
    const patientId = await assertEncounterInClinic(medplum, clinicId, id);
    if (consultation.notes) {
      await medplum.createResource(withClinicIdentifier<import("@medplum/fhirtypes").Observation>({
        resourceType: 'Observation' as const,
        status: 'final' as const,
        subject: { reference: `Patient/${patientId}` },
        encounter: { reference: `Encounter/${id}` },
        code: { text: 'Clinical Notes' },
        valueString: consultation.notes,
        effectiveDateTime: new Date().toISOString(),
      }, clinicId));
    }
    return true;
  } catch (error) {
    console.error('Error updating consultation:', error);
    return false;
  }
}

export async function deleteConsultation(id: string): Promise<boolean> {
  try {
    const medplum = await getAdminMedplum();
    await medplum.deleteResource('Encounter', id);
    return true;
  } catch (error) {
    console.error('Error deleting consultation:', error);
    return false;
  }
}
