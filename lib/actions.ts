import { QueueStatus } from './types';
import { z } from 'zod';
import { getPatientFromMedplum } from './fhir/patient-service';
import { checkInPatientInTriage, getTriageForPatient, updateQueueStatusForPatient } from './fhir/triage-service';

const idSchema = z.string().min(1);
const statusSchema = z
  .enum(['arrived', 'waiting', 'in_consultation', 'completed', 'meds_and_bills'])
  .nullable()
  .or(z.literal('arrived'))
  .or(z.literal('waiting'))
  .or(z.literal('in_consultation'))
  .or(z.literal('completed'))
  .or(z.literal('meds_and_bills')) as any;

export async function checkInPatient(patientId: string, chiefComplaint?: string) {
  try {
    idSchema.parse(patientId);
    const patient = await getPatientFromMedplum(patientId);
    if (!patient) {
      throw new Error('Patient not found');
    }
    await checkInPatientInTriage(patientId, chiefComplaint);
  } catch (error) {
    console.error('Error checking patient in:', error);
    throw error;
  }
}

export async function addPatientToQueue(patientId: string) {
  try {
    idSchema.parse(patientId);
    const patient = await getPatientFromMedplum(patientId);
    const triage = await getTriageForPatient(patientId);

    if (!patient) {
      throw new Error('Patient not found');
    }

    if (triage.queueStatus === 'waiting' || triage.queueStatus === 'in_consultation') {
      throw new Error('Patient is already in queue');
    }

    await updateQueueStatusForPatient(patientId, 'waiting');
  } catch (error) {
    console.error('Error adding patient to queue:', error);
    throw error;
  }
}

export async function removePatientFromQueue(patientId: string) {
  try {
    idSchema.parse(patientId);
    const patient = await getPatientFromMedplum(patientId);
    const triage = await getTriageForPatient(patientId);
    if (!patient) {
      throw new Error('Patient not found');
    }

    if (!triage.triage) {
      throw new Error('Patient has no triage encounter');
    }

    await updateQueueStatusForPatient(patientId, null);
  } catch (error) {
    console.error('Error removing patient from queue:', error);
    throw error;
  }
}

export async function updateQueueStatus(patientId: string, status: QueueStatus) {
  try {
    idSchema.parse(patientId);
    statusSchema.parse(status);
    const patient = await getPatientFromMedplum(patientId);
    const triage = await getTriageForPatient(patientId);
    if (!patient) {
      throw new Error('Patient not found');
    }
    if (!triage.triage) {
      throw new Error('Patient has no triage encounter');
    }
    await updateQueueStatusForPatient(patientId, status);
  } catch (error) {
    console.error('Error updating queue status:', error);
    throw error;
  }
}

export async function getQueueStatus(patientId: string): Promise<QueueStatus> {
  try {
    const triage = await getTriageForPatient(patientId);
    if (!triage.triage && !triage.queueStatus) {
      throw new Error('Patient not in queue');
    }

    return triage.queueStatus ?? null;
  } catch (error) {
    console.error('Error getting queue status:', error);
    throw error;
  }
}
