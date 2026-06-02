import { QueueStatus } from './types';
import { z } from 'zod';
import { getPatientFromMedplum } from './fhir/patient-service';
import { checkInPatientInTriage, getTriageForPatient, updateQueueStatusForPatient } from './fhir/triage-service';
import { resolveClinicIdFromServerScope } from './server/clinic';
import { getMedplumForRequest } from './server/medplum-auth';

const idSchema = z.string().min(1);
const statusSchema = z
  .enum(['arrived', 'waiting', 'in_consultation', 'completed', 'meds_and_bills'])
  .nullable()
  .or(z.literal('arrived'))
  .or(z.literal('waiting'))
  .or(z.literal('in_consultation'))
  .or(z.literal('completed'))
  .or(z.literal('meds_and_bills')) as any;

async function getClinicalActionContext() {
  const [medplum, clinicId] = await Promise.all([
    getMedplumForRequest(),
    resolveClinicIdFromServerScope(),
  ]);
  if (!clinicId) {
    throw new Error('Clinic scope is required.');
  }
  return { medplum, clinicId };
}

export async function checkInPatient(patientId: string, chiefComplaint?: string) {
  try {
    idSchema.parse(patientId);
    const { medplum, clinicId } = await getClinicalActionContext();
    const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
    if (!patient) {
      throw new Error('Patient not found');
    }
    await checkInPatientInTriage(patientId, chiefComplaint, undefined, medplum, clinicId);
  } catch (error) {
    console.error('Error checking patient in:', error);
    throw error;
  }
}

export async function addPatientToQueue(patientId: string) {
  try {
    idSchema.parse(patientId);
    const { medplum, clinicId } = await getClinicalActionContext();
    const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
    const triage = await getTriageForPatient(patientId, medplum, clinicId);

    if (!patient) {
      throw new Error('Patient not found');
    }

    if (triage.queueStatus === 'waiting' || triage.queueStatus === 'in_consultation') {
      throw new Error('Patient is already in queue');
    }

    await updateQueueStatusForPatient(patientId, 'waiting', medplum, clinicId);
  } catch (error) {
    console.error('Error adding patient to queue:', error);
    throw error;
  }
}

export async function removePatientFromQueue(patientId: string) {
  try {
    idSchema.parse(patientId);
    const { medplum, clinicId } = await getClinicalActionContext();
    const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
    const triage = await getTriageForPatient(patientId, medplum, clinicId);
    if (!patient) {
      throw new Error('Patient not found');
    }

    if (!triage.triage) {
      throw new Error('Patient has no triage encounter');
    }

    await updateQueueStatusForPatient(patientId, null, medplum, clinicId);
  } catch (error) {
    console.error('Error removing patient from queue:', error);
    throw error;
  }
}

export async function updateQueueStatus(patientId: string, status: QueueStatus) {
  try {
    idSchema.parse(patientId);
    statusSchema.parse(status);
    const { medplum, clinicId } = await getClinicalActionContext();
    const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
    const triage = await getTriageForPatient(patientId, medplum, clinicId);
    if (!patient) {
      throw new Error('Patient not found');
    }
    if (!triage.triage) {
      throw new Error('Patient has no triage encounter');
    }
    await updateQueueStatusForPatient(patientId, status, medplum, clinicId);
  } catch (error) {
    console.error('Error updating queue status:', error);
    throw error;
  }
}

export async function getQueueStatus(patientId: string): Promise<QueueStatus> {
  try {
    const { medplum, clinicId } = await getClinicalActionContext();
    const triage = await getTriageForPatient(patientId, medplum, clinicId);
    if (!triage.triage && !triage.queueStatus) {
      throw new Error('Patient not in queue');
    }

    return triage.queueStatus ?? null;
  } catch (error) {
    console.error('Error getting queue status:', error);
    throw error;
  }
}
