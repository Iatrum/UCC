/**
 * X-ray device bridge -- translates a device-reported study (the same
 * ImagingStudyData JSON shape POST /api/imaging/receive already accepts)
 * into the existing receiveImagingStudy pipeline, restricted to
 * ServiceRequests the composer's online-device X-ray flow created.
 *
 * Kept as a plain module (not a live Medplum Bot resource) for the same
 * reason lib/poct/analyser-bot.ts is -- see .ai/progress-task10.md.
 */

import type { MedplumClient } from '@medplum/core';
import type { ServiceRequest } from '@medplum/fhirtypes';
import { receiveImagingStudy, type ImagingStudyData } from '@/lib/fhir/imaging-service';
import { getClinicIdentifierValue } from '@/lib/fhir/clinic-tenancy';
import { isModuleEnabledForClinic } from '@/lib/module-registry';
import { ForbiddenError, ConflictError } from '@/lib/server/route-helpers';
import { XRAY_TAG_SYSTEM } from '@/lib/fhir/xray-device';

export interface XrayStudyMessage {
  serviceRequestId: string;
  study: ImagingStudyData;
}

export interface IngestResult {
  serviceRequestId: string;
  imagingStudyId: string;
}

function isXrayServiceRequest(sr: ServiceRequest): boolean {
  return sr.meta?.tag?.some((t) => t.system === XRAY_TAG_SYSTEM && t.code === 'xray') ?? false;
}

/**
 * Store a device-reported study via the same path /api/imaging/receive uses.
 * Only acts on ServiceRequests tagged `xray` (this is the POCT X-ray device
 * bridge, not a general imaging receiver -- that's /api/imaging/receive).
 */
export async function ingestXrayStudy(input: XrayStudyMessage, medplum: MedplumClient): Promise<IngestResult> {
  const serviceRequest = await medplum.readResource('ServiceRequest', input.serviceRequestId);
  if (!isXrayServiceRequest(serviceRequest)) {
    throw new Error(`ServiceRequest/${input.serviceRequestId} is not an X-ray device order`);
  }

  const clinicId = getClinicIdentifierValue(serviceRequest);
  if (!clinicId || !(await isModuleEnabledForClinic('pacs', clinicId))) {
    throw new ForbiddenError('PACS module is disabled for this clinic');
  }
  // Retransmission after a completed order returns its existing study. Corrections
  // need a separate explicit workflow rather than creating a duplicate study.
  if (serviceRequest.status === 'completed') {
    const existing = await medplum.searchOne('ImagingStudy', {
      basedon: `ServiceRequest/${input.serviceRequestId}`,
    }, { cache: 'no-cache' });
    if (!existing?.id) throw new ConflictError('Completed X-ray order has no study');
    return { serviceRequestId: input.serviceRequestId, imagingStudyId: existing.id };
  }
  if (serviceRequest.status !== 'active' && serviceRequest.status !== 'on-hold') {
    throw new ConflictError('X-ray order cannot receive a study in its current status');
  }

  const imagingStudyId = await receiveImagingStudy(input.serviceRequestId, input.study, medplum);
  return { serviceRequestId: input.serviceRequestId, imagingStudyId };
}
