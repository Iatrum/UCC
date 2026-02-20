import { Consultation } from '@/lib/models'; // Import canonical types
import { getMedplumClient } from '../fhir/patient-service';
import { getConsultationFromMedplum, getPatientConsultationsFromMedplum } from '../fhir/consultation-service';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
    const consultations = await getPatientConsultationsFromMedplum(patientId);
    return consultations as unknown as Consultation[];
  } catch (error) {
    console.error('Error fetching patient consultations:', error);
    return [];
  }
}

export async function getConsultationById(id: string): Promise<Consultation | null> {
  try {
    const consultation = await getConsultationFromMedplum(id);
    return (consultation as unknown as Consultation) ?? null;
  } catch (error) {
    console.error('Error fetching consultation:', error);
    return null;
  }
}

export async function updateConsultation(id: string, consultation: Partial<Consultation>): Promise<boolean> {
  try {
    if (consultation.notes) {
      const medplum = await getMedplumClient();
      const encounter = await medplum.readResource('Encounter', id);
      const safeNotes = escapeHtml(consultation.notes).replace(/\r\n/g, '\n').replace(/\n/g, '<br/>');
      await medplum.createResource({
        resourceType: 'Composition',
        status: 'amended',
        type: {
          coding: [{ system: 'http://loinc.org', code: '11506-3', display: 'Progress note' }],
          text: 'SOAP note',
        },
        title: 'SOAP Note (Amendment)',
        subject: encounter.subject,
        encounter: { reference: `Encounter/${id}` },
        date: new Date().toISOString(),
        text: {
          status: 'generated',
          div: `<div xmlns="http://www.w3.org/1999/xhtml">${safeNotes}</div>`,
        },
      });
    }
    return true;
  } catch (error) {
    console.error('Error updating consultation:', error);
    return false;
  }
}

export async function deleteConsultation(id: string): Promise<boolean> {
  try {
    const medplum = await getMedplumClient();
    await medplum.deleteResource('Encounter', id);
    return true;
  } catch (error) {
    console.error('Error deleting consultation:', error);
    return false;
  }
}
