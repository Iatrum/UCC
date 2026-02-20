/**
 * Referral Service - Medplum FHIR as Source of Truth
 * Uses ServiceRequest resource for referrals
 */

import type { Annotation, ServiceRequest } from '@medplum/fhirtypes';
import { getMedplumClient } from './patient-service';
import { applyMyCoreProfile } from './mycore';

export interface ReferralData {
  patientId: string;
  specialty: string;
  facility: string;
  department?: string;
  doctorName?: string;
  urgency?: 'routine' | 'urgent' | 'stat' | 'asap';
  reason?: string;
  clinicalInfo?: string;
  letterText?: string;
  date?: Date | string;
}

export interface SavedReferral extends ReferralData {
  id: string;
  status: 'draft' | 'active' | 'on-hold' | 'revoked' | 'completed' | 'entered-in-error' | 'unknown';
  createdAt: Date;
}

const REFERRAL_LETTER_AUTHOR = 'Generated Referral Letter';

function buildReferralNotes(
  clinicalInfo?: string,
  letterText?: string,
  fallback?: Annotation[]
): Annotation[] | undefined {
  const notes: Annotation[] = [];
  const cleanClinical = clinicalInfo?.trim();
  const cleanLetter = letterText?.trim();

  if (cleanClinical) {
    notes.push({ text: cleanClinical });
  }

  if (cleanLetter) {
    notes.push({ text: cleanLetter, authorString: REFERRAL_LETTER_AUTHOR });
  }

  if (notes.length > 0) {
    return notes;
  }

  return fallback && fallback.length > 0 ? fallback : undefined;
}

function extractReferralNotes(notes?: Annotation[]): { clinicalInfo?: string; letterText?: string } {
  if (!notes || notes.length === 0) {
    return {};
  }

  const letter = notes.find((note) => note.authorString === REFERRAL_LETTER_AUTHOR)?.text;
  const clinical = notes.find((note) => note.authorString !== REFERRAL_LETTER_AUTHOR)?.text ?? notes[0]?.text;

  return {
    clinicalInfo: clinical,
    letterText: letter,
  };
}

/**
 * Save referral to Medplum as ServiceRequest
 */
export async function saveReferralToMedplum(referralData: ReferralData): Promise<string> {
  const medplum = await getMedplumClient();
  const notes = buildReferralNotes(referralData.clinicalInfo, referralData.letterText);

  const serviceRequest: ServiceRequest = applyMyCoreProfile({
    resourceType: 'ServiceRequest',
    status: 'active',
    intent: 'order',
    priority: referralData.urgency,
    subject: {
      reference: `Patient/${referralData.patientId}`,
    },
    code: {
      text: `Referral to ${referralData.specialty}`,
    },
    reasonCode: referralData.reason ? [{ text: referralData.reason }] : undefined,
    note: notes,
    performer: [
      {
        display: `${referralData.facility}${referralData.department ? ' - ' + referralData.department : ''}`,
      },
    ],
    requester: referralData.doctorName ? {
      display: referralData.doctorName,
    } : undefined,
    authoredOn: referralData.date 
      ? (typeof referralData.date === 'string' ? referralData.date : referralData.date.toISOString())
      : new Date().toISOString(),
  });

  const saved = await medplum.createResource(serviceRequest);
  console.log(`✅ Created FHIR ServiceRequest (Referral): ${saved.id}`);
  
  return saved.id!;
}

/**
 * Get referral from Medplum
 */
export async function getReferralFromMedplum(referralId: string): Promise<SavedReferral | null> {
  try {
    const medplum = await getMedplumClient();
    const serviceRequest = await medplum.readResource('ServiceRequest', referralId);
    
    const performerDisplay = serviceRequest.performer?.[0]?.display || '';
    const [facility, department] = performerDisplay.split(' - ');
    const { clinicalInfo, letterText } = extractReferralNotes(serviceRequest.note);

    return {
      id: serviceRequest.id!,
      patientId: serviceRequest.subject?.reference?.replace('Patient/', '') || '',
      specialty: serviceRequest.code?.text || '',
      facility: facility || '',
      department,
      doctorName: serviceRequest.requester?.display,
      urgency: serviceRequest.priority as any,
      reason: serviceRequest.reasonCode?.[0]?.text,
      clinicalInfo,
      letterText,
      date: serviceRequest.authoredOn ? new Date(serviceRequest.authoredOn) : new Date(),
      status: serviceRequest.status as any,
      createdAt: serviceRequest.meta?.lastUpdated ? new Date(serviceRequest.meta.lastUpdated) : new Date(),
    };
  } catch (error) {
    console.error('Failed to get referral from Medplum:', error);
    return null;
  }
}

/**
 * Update referral in Medplum
 */
export async function updateReferralInMedplum(
  referralId: string,
  updates: Partial<ReferralData> & { status?: ServiceRequest['status'] }
): Promise<void> {
  const medplum = await getMedplumClient();
  const serviceRequest = await medplum.readResource('ServiceRequest', referralId);

  const performerDisplay = serviceRequest.performer?.[0]?.display || '';
  const [existingFacility, existingDepartment] = performerDisplay.split(' - ');
  const existingNotes = extractReferralNotes(serviceRequest.note);

  const nextFacility = updates.facility ?? existingFacility;
  const nextDepartment = updates.department ?? existingDepartment;
  const shouldUpdatePerformer = updates.facility !== undefined || updates.department !== undefined;

  const shouldUpdateNotes = 'clinicalInfo' in updates || 'letterText' in updates;
  const mergedNotes = shouldUpdateNotes
    ? buildReferralNotes(
        'clinicalInfo' in updates ? updates.clinicalInfo : existingNotes.clinicalInfo,
        'letterText' in updates ? updates.letterText : existingNotes.letterText
      )
    : serviceRequest.note;

  const updated: ServiceRequest = applyMyCoreProfile({
    ...serviceRequest,
    status: updates.status ?? serviceRequest.status,
    priority: updates.urgency ?? serviceRequest.priority,
    subject:
      updates.patientId !== undefined
        ? { reference: `Patient/${updates.patientId}` }
        : serviceRequest.subject,
    code:
      updates.specialty !== undefined
        ? { text: `Referral to ${updates.specialty}` }
        : serviceRequest.code,
    reasonCode:
      updates.reason !== undefined
        ? updates.reason
          ? [{ text: updates.reason }]
          : undefined
        : serviceRequest.reasonCode,
    note: mergedNotes,
    performer: shouldUpdatePerformer
      ? [
          {
            display: `${nextFacility}${nextDepartment ? ' - ' + nextDepartment : ''}`,
          },
        ]
      : serviceRequest.performer,
    requester:
      updates.doctorName !== undefined
        ? updates.doctorName
          ? { display: updates.doctorName }
          : undefined
        : serviceRequest.requester,
    authoredOn:
      updates.date !== undefined
        ? typeof updates.date === 'string'
          ? updates.date
          : updates.date.toISOString()
        : serviceRequest.authoredOn,
  });

  await medplum.updateResource(updated);
}

/**
 * Get patient referrals from Medplum
 */
export async function getPatientReferralsFromMedplum(patientId: string): Promise<SavedReferral[]> {
  try {
    const medplum = await getMedplumClient();
    
    const serviceRequests = await medplum.searchResources('ServiceRequest', {
      subject: `Patient/${patientId}`,
      _sort: '-authored',
    });

    const mapped = await Promise.all(
      serviceRequests.map(async (sr) => {
        const saved = await getReferralFromMedplum(sr.id!);
        return saved;
      })
    );

    return mapped.filter((r): r is SavedReferral => r !== null);
  } catch (error) {
    console.error('Failed to get patient referrals from Medplum:', error);
    return [];
  }
}








