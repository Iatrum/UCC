/**
 * Referral Service - Medplum FHIR as Source of Truth
 * Uses ServiceRequest resource for referrals
 */

import { MedplumClient } from '@medplum/core';
import type { ServiceRequest } from '@medplum/fhirtypes';
import {
  CLINIC_IDENTIFIER_SYSTEM,
  resourceMatchesClinicTenant,
  withClinicIdentifier,
} from './clinic-tenancy';

export interface ReferralData {
  patientId: string;
  specialty: string;
  facility: string;
  department?: string;
  doctorName?: string;
  urgency?: 'routine' | 'urgent' | 'stat' | 'asap';
  reason?: string;
  clinicalInfo?: string;
  date?: Date | string;
}

export interface SavedReferral extends ReferralData {
  id: string;
  status: 'draft' | 'active' | 'on-hold' | 'revoked' | 'completed' | 'entered-in-error' | 'unknown';
  createdAt: Date;
}

const REFERRAL_CATEGORY_SYSTEM = 'https://ucc.emr/service-request-category';
const REFERRAL_CATEGORY_CODE = 'referral';
const REFERRAL_CODE_PREFIX = 'Referral to ';

function isReferralServiceRequest(serviceRequest: ServiceRequest): boolean {
  const hasReferralCategory = serviceRequest.category?.some((category) =>
    category.coding?.some(
      (coding) => coding.system === REFERRAL_CATEGORY_SYSTEM && coding.code === REFERRAL_CATEGORY_CODE
    )
  );
  return Boolean(hasReferralCategory || serviceRequest.code?.text?.startsWith(REFERRAL_CODE_PREFIX));
}

function specialtyFromServiceRequest(serviceRequest: ServiceRequest): string {
  const text = serviceRequest.code?.text || '';
  return text.startsWith(REFERRAL_CODE_PREFIX) ? text.slice(REFERRAL_CODE_PREFIX.length) : text;
}

/**
 * Save referral to Medplum as ServiceRequest
 */
export async function saveReferralToMedplum(
  medplum: MedplumClient,
  referralData: ReferralData,
  clinicId?: string
): Promise<string> {
  const serviceRequest: ServiceRequest = withClinicIdentifier<ServiceRequest>({
    resourceType: 'ServiceRequest',
    status: 'active',
    intent: 'order',
    priority: referralData.urgency,
    subject: {
      reference: `Patient/${referralData.patientId}`,
    },
    code: {
      text: `${REFERRAL_CODE_PREFIX}${referralData.specialty}`,
    },
    category: [
      {
        coding: [
          {
            system: REFERRAL_CATEGORY_SYSTEM,
            code: REFERRAL_CATEGORY_CODE,
            display: 'Referral',
          },
        ],
        text: 'Referral',
      },
    ],
    reasonCode: referralData.reason ? [{ text: referralData.reason }] : undefined,
    note: referralData.clinicalInfo ? [{ text: referralData.clinicalInfo }] : undefined,
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
  }, clinicId);

  const saved = await medplum.createResource(serviceRequest);
  console.log(`✅ Created FHIR ServiceRequest (Referral): ${saved.id}`);

  return saved.id!;
}

/**
 * Get referral from Medplum
 */
export async function getReferralFromMedplum(
  medplum: MedplumClient,
  referralId: string,
  clinicId?: string
): Promise<SavedReferral | null> {
  try {
    const serviceRequest = await medplum.readResource('ServiceRequest', referralId);
    if (!isReferralServiceRequest(serviceRequest)) {
      return null;
    }
    if (clinicId && !resourceMatchesClinicTenant(serviceRequest as any, clinicId)) {
      return null;
    }

    const performerDisplay = serviceRequest.performer?.[0]?.display || '';
    const [facility, department] = performerDisplay.split(' - ');

    return {
      id: serviceRequest.id!,
      patientId: serviceRequest.subject?.reference?.replace('Patient/', '') || '',
      specialty: specialtyFromServiceRequest(serviceRequest),
      facility: facility || '',
      department,
      doctorName: serviceRequest.requester?.display,
      urgency: serviceRequest.priority as any,
      reason: serviceRequest.reasonCode?.[0]?.text,
      clinicalInfo: serviceRequest.note?.[0]?.text,
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
 * Update referral status or fields
 */
export async function updateReferralInMedplum(
  medplum: MedplumClient,
  referralId: string,
  updates: Partial<Pick<ReferralData, 'urgency' | 'reason' | 'clinicalInfo' | 'doctorName'>> & { status?: SavedReferral['status'] },
  clinicId?: string
): Promise<void> {
  const serviceRequest = await medplum.readResource('ServiceRequest', referralId);
  if (clinicId && !resourceMatchesClinicTenant(serviceRequest as any, clinicId)) {
    throw new Error('Referral not found');
  }

  const updated: ServiceRequest = { ...serviceRequest };
  if (updates.status) updated.status = updates.status;
  if (updates.urgency !== undefined) updated.priority = updates.urgency;
  if (updates.reason !== undefined) updated.reasonCode = updates.reason ? [{ text: updates.reason }] : undefined;
  if (updates.clinicalInfo !== undefined) updated.note = updates.clinicalInfo ? [{ text: updates.clinicalInfo }] : undefined;
  if (updates.doctorName !== undefined) updated.requester = updates.doctorName ? { display: updates.doctorName } : undefined;

  await medplum.updateResource(withClinicIdentifier(updated, clinicId));
}

/**
 * Delete (revoke) a referral
 */
export async function deleteReferralFromMedplum(
  medplum: MedplumClient,
  referralId: string,
  clinicId?: string
): Promise<void> {
  if (clinicId) {
    const serviceRequest = await medplum.readResource('ServiceRequest', referralId);
    if (!resourceMatchesClinicTenant(serviceRequest as any, clinicId)) {
      throw new Error('Referral not found');
    }
  }
  await medplum.deleteResource('ServiceRequest', referralId);
}

/**
 * Get patient referrals from Medplum
 */
export async function getPatientReferralsFromMedplum(
  medplum: MedplumClient,
  patientId: string,
  clinicId?: string
): Promise<SavedReferral[]> {
  try {
    const serviceRequests = await medplum.searchResources('ServiceRequest', {
      subject: `Patient/${patientId}`,
      ...(clinicId ? { identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}` } : {}),
      _sort: '-authored',
    });

    const mapped = await Promise.all(
      serviceRequests.map(async (sr) => {
        if (!isReferralServiceRequest(sr)) {
          return null;
        }
        const saved = await getReferralFromMedplum(medplum, sr.id!, clinicId);
        return saved;
      })
    );

    return mapped.filter((r): r is SavedReferral => r !== null);
  } catch (error) {
    console.error('Failed to get patient referrals from Medplum:', error);
    return [];
  }
}
