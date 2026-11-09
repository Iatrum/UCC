/**
 * Imaging Service - PACS Integration
 * Server-only. Do NOT import in Client Components.
 * Use lib/fhir/imaging-constants.ts for static constants and types.
 */

import { MedplumClient } from '@medplum/core';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import type {
  ServiceRequest,
  ImagingStudy,
  DiagnosticReport,
  Patient as FHIRPatient,
} from '@medplum/fhirtypes';
import { createProvenanceForResource } from './provenance-service';
import { validateAndCreate } from './fhir-helpers';
import {
  IMAGING_PROCEDURES,
  XRAY_STUDIES,
  type ImagingProcedureCode,
  type ImagingReportSummary,
  type ImagingStudyData,
  type DICOMSeries,
} from './imaging-constants';
import { XRAY_TAG_SYSTEM, requireOnlineXrayDevice } from './xray-device';
import { isModuleEnabledForClinic } from '@/lib/module-registry';
import { ConflictError, ForbiddenError } from '@/lib/server/route-helpers';
import {
  assignResourceToAccountReferences,
  assignResourceToClinicTenant,
  getResourceAccountReferences,
  getClinicIdentifierValue,
  resolveClinicTenant,
} from './clinic-tenancy';

export {
  IMAGING_PROCEDURES,
  type ImagingProcedureCode,
  type ImagingReportSummary,
  type ImagingStudyData,
  type DICOMSeries,
};

const CLINIC_IDENTIFIER_SYSTEM = 'clinic';

export const IMAGING_MODALITIES = {
  CR: { code: 'CR', display: 'Computed Radiography', system: 'http://dicom.nema.org/resources/ontology/DCM' },
  CT: { code: 'CT', display: 'Computed Tomography', system: 'http://dicom.nema.org/resources/ontology/DCM' },
  MR: { code: 'MR', display: 'Magnetic Resonance', system: 'http://dicom.nema.org/resources/ontology/DCM' },
  US: { code: 'US', display: 'Ultrasound', system: 'http://dicom.nema.org/resources/ontology/DCM' },
  DX: { code: 'DX', display: 'Digital Radiography', system: 'http://dicom.nema.org/resources/ontology/DCM' },
  MG: { code: 'MG', display: 'Mammography', system: 'http://dicom.nema.org/resources/ontology/DCM' },
  NM: { code: 'NM', display: 'Nuclear Medicine', system: 'http://dicom.nema.org/resources/ontology/DCM' },
  PT: { code: 'PT', display: 'Positron Emission Tomography', system: 'http://dicom.nema.org/resources/ontology/DCM' },
  XA: { code: 'XA', display: 'X-Ray Angiography', system: 'http://dicom.nema.org/resources/ontology/DCM' },
} as const;

export type ModalityCode = keyof typeof IMAGING_MODALITIES;

export type ImagingOrderProcedure = ImagingProcedureCode | {
  code: string;
  display: string;
  system?: string;
  modality?: string;
};

export interface ImagingOrderRequest {
  patientId: string;
  encounterId?: string;
  procedures: ImagingOrderProcedure[];
  priority?: 'routine' | 'urgent' | 'asap' | 'stat';
  clinicalIndication?: string;
  clinicalQuestion?: string;
  orderedBy?: string;
  xray?: { code: string; deviceId: string; entryId: string };
}

function resolveImagingProcedure(procedure: ImagingOrderProcedure): {
  code: string;
  display: string;
  system: string;
  modality: string;
} {
  if (typeof procedure === 'string') {
    const known = IMAGING_PROCEDURES[procedure as ImagingProcedureCode];
    return known || { code: procedure, display: procedure, system: 'http://loinc.org', modality: 'DX' };
  }

  return {
    code: procedure.code,
    display: procedure.display || procedure.code,
    system: procedure.system || 'http://loinc.org',
    modality: procedure.modality || 'DX',
  };
}

/**
 * Create an imaging order (ServiceRequest)
 */
export async function createImagingOrder(
  order: ImagingOrderRequest,
  medplum: MedplumClient,
  clinicId: string
): Promise<string> {
  const client = medplum;
  const clinicTenant = await resolveClinicTenant(client, clinicId);

  console.log(`🏥 Creating imaging order for patient ${order.patientId}`);

  const xrayStudy = order.xray && XRAY_STUDIES.find((s) => s.code === order.xray!.code);
  if (order.xray) {
    if (!(await isModuleEnabledForClinic('pacs', clinicId))) {
      throw new ForbiddenError('PACS module is disabled for this clinic');
    }
    if (!xrayStudy || !order.encounterId || !/^[a-zA-Z0-9-]{1,64}$/.test(order.xray.entryId || '') || !/^[a-zA-Z0-9-]{1,64}$/.test(order.xray.deviceId || '')) {
      throw new ConflictError('Invalid X-ray order');
    }
    await requireOnlineXrayDevice(client, clinicId, order.xray.deviceId);
    order = { ...order, procedures: [{ code: xrayStudy.code, display: xrayStudy.name, system: xrayStudy.system, modality: xrayStudy.modality }] };
  }

  const serviceRequests: ServiceRequest[] = [];

  for (const procedureCode of order.procedures) {
    const procedure = resolveImagingProcedure(procedureCode);
    const modality = IMAGING_MODALITIES[procedure.modality as ModalityCode];

    const resource: ServiceRequest = {
      resourceType: 'ServiceRequest',
      identifier: [{ system: CLINIC_IDENTIFIER_SYSTEM, value: clinicId },
        ...(order.xray ? [{ system: 'https://ucc.emr/xray/order-entry', value: `${clinicId}:${order.encounterId}:${order.xray.entryId}` }] : [])],
      meta: order.xray ? { tag: [{ system: XRAY_TAG_SYSTEM, code: 'xray' }] } : undefined,
      status: 'active',
      intent: 'order',
      priority: order.priority || 'routine',
      category: [{
        coding: [{
          system: 'http://snomed.info/sct',
          code: '363679005',
          display: 'Imaging',
        }],
      }],
      code: {
        coding: [{
          system: procedure.system,
          code: procedure.code,
          display: procedure.display,
        }],
        text: procedure.display,
      },
      subject: {
        reference: `Patient/${order.patientId}`,
      },
      encounter: order.encounterId ? {
        reference: `Encounter/${order.encounterId}`,
      } : undefined,
      performer: order.xray ? [{ reference: `Device/${order.xray.deviceId}` }] : undefined,
      authoredOn: new Date().toISOString(),
      requester: order.orderedBy
        ? order.orderedBy.startsWith('Practitioner/')
          ? { reference: order.orderedBy }
          : { display: order.orderedBy }
        : undefined,
      reasonCode: order.clinicalIndication ? [{
        text: order.clinicalIndication,
      }] : undefined,
      note: [
        ...(order.clinicalIndication ? [{ text: `Clinical Indication: ${order.clinicalIndication}` }] : []),
        ...(order.clinicalQuestion ? [{ text: `Clinical Question: ${order.clinicalQuestion}` }] : []),
      ],
    };
    const serviceRequest = order.xray
      ? await client.createResourceIfNoneExist(resource, new URLSearchParams({ identifier: `https://ucc.emr/xray/order-entry|${clinicId}:${order.encounterId}:${order.xray.entryId}` }).toString())
      : await validateAndCreate<ServiceRequest>(client, resource);
    await assignResourceToClinicTenant(client, 'ServiceRequest', serviceRequest, clinicTenant);

    serviceRequests.push(serviceRequest);
    console.log(`✅ Created imaging ServiceRequest: ${serviceRequest.id} for ${procedure.display}`);

    // Create Provenance for audit trail (non-blocking)
    if (serviceRequest.id) {
      try {
        await createProvenanceForResource(
          client,
          'ServiceRequest',
          serviceRequest.id,
          order.orderedBy?.startsWith('Practitioner/') ? order.orderedBy.split('/')[1] : undefined,
          clinicId,
          'CREATE',
          clinicTenant ? [{ reference: clinicTenant.accountReference }] : undefined
        );
        console.log(`✅ Created Provenance for ServiceRequest/${serviceRequest.id}`);
      } catch (error) {
        console.warn(`⚠️  Failed to create Provenance for ServiceRequest (non-blocking):`, error);
      }
    }
  }

  return serviceRequests[0]?.id || '';
}

/**
 * Receive imaging study from PACS and create ImagingStudy resource
 */
export async function receiveImagingStudy(
  serviceRequestId: string,
  studyData: ImagingStudyData,
  medplum: MedplumClient
): Promise<string> {
  const client = medplum;
  
  console.log(`📸 Receiving imaging study ${studyData.studyUid} for ServiceRequest ${serviceRequestId}`);

  // Get the original service request
  const serviceRequest = await client.readResource('ServiceRequest', serviceRequestId);
  const accountRefs = getResourceAccountReferences(serviceRequest);
  
  if (!serviceRequest.subject?.reference) {
    throw new Error('ServiceRequest has no patient reference');
  }

  // Create ImagingStudy resource
  const imagingStudy = await validateAndCreate<ImagingStudy>(client, {
    resourceType: 'ImagingStudy',
    identifier: [
      ...(studyData.accessionNumber ? [{
        system: 'accession',
        value: studyData.accessionNumber,
      }] : []),
    ],
    status: 'available',
    subject: {
      reference: serviceRequest.subject.reference,
    },
    encounter: serviceRequest.encounter,
    started: studyData.started?.toISOString(),
    basedOn: [{
      reference: `ServiceRequest/${serviceRequestId}`,
    }],
    numberOfSeries: studyData.numberOfSeries,
    numberOfInstances: studyData.numberOfInstances,
    procedureCode: serviceRequest.code ? [{
      coding: serviceRequest.code.coding,
      text: serviceRequest.code.text,
    }] : undefined,
    modality: studyData.modality ? [{
      system: 'http://dicom.nema.org/resources/ontology/DCM',
      code: studyData.modality,
    }] : undefined,
    description: studyData.description,
    series: studyData.series.map(s => ({
      uid: s.uid,
      number: s.number,
      modality: {
        system: 'http://dicom.nema.org/resources/ontology/DCM',
        code: s.modality,
      },
      description: s.description,
      numberOfInstances: s.numberOfInstances,
      bodySite: s.bodySite ? {
        display: s.bodySite,
      } : undefined,
      started: s.started?.toISOString(),
      endpoint: s.endpoint ? [{
        reference: s.endpoint,
      }] : undefined,
    })),
  });
  await assignResourceToAccountReferences(client, 'ImagingStudy', imagingStudy, accountRefs);

  console.log(`✅ Created ImagingStudy: ${imagingStudy.id}`);

  // Create Provenance for audit trail (non-blocking)
  if (imagingStudy.id) {
    try {
      await createProvenanceForResource(
        client,
        'ImagingStudy',
        imagingStudy.id,
        undefined, // Could extract from serviceRequest.requester if needed
        undefined,
        'CREATE',
        accountRefs
      );
      console.log(`✅ Created Provenance for ImagingStudy/${imagingStudy.id}`);
    } catch (error) {
      console.warn(`⚠️  Failed to create Provenance for ImagingStudy (non-blocking):`, error);
    }
  }

  // Update ServiceRequest status
  await client.updateResource({
    ...serviceRequest,
    status: 'completed',
  });

  return imagingStudy.id!;
}

/**
 * Create imaging report (radiologist interpretation)
 */
export async function createImagingReport(
  imagingStudyId: string,
  findings: string,
  impression: string,
  status: 'preliminary' | 'final' = 'final',
  radiologist?: string,
  medplum?: MedplumClient
): Promise<string> {
  const client = medplum ?? (await getAdminMedplum());
  
  console.log(`📝 Creating imaging report for study ${imagingStudyId}`);

  // Get the imaging study
  const imagingStudy = await client.readResource('ImagingStudy', imagingStudyId);
  const accountRefs = getResourceAccountReferences(imagingStudy);
  // Clinic identifier is on the originating ServiceRequest, not the ImagingStudy itself;
  // needed so the Lab tab's live-update subscription (criteria includes identifier=clinic|<id>)
  // can match this report.
  const basedOnServiceRequestId = imagingStudy.basedOn?.[0]?.reference?.split('/')[1];
  const clinicId = basedOnServiceRequestId
    ? getClinicIdentifierValue(await client.readResource('ServiceRequest', basedOnServiceRequestId))
    : undefined;

  // Create DiagnosticReport
  const report = await validateAndCreate<DiagnosticReport>(client, {
    resourceType: 'DiagnosticReport',
    identifier: clinicId ? [{ system: CLINIC_IDENTIFIER_SYSTEM, value: clinicId }] : undefined,
    status,
    category: [{
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
        code: 'RAD',
        display: 'Radiology',
      }],
    }],
    code: imagingStudy.procedureCode?.[0] || { text: 'Imaging Report' },
    subject: imagingStudy.subject,
    encounter: imagingStudy.encounter,
    effectiveDateTime: imagingStudy.started,
    issued: new Date().toISOString(),
    imagingStudy: [{
      reference: `ImagingStudy/${imagingStudyId}`,
    }],
    conclusion: impression,
    conclusionCode: findings ? [{
      text: findings,
    }] : undefined,
    presentedForm: [{
      contentType: 'text/plain',
      data: Buffer.from(`FINDINGS:\n${findings}\n\nIMPRESSION:\n${impression}`).toString('base64'),
      title: 'Radiology Report',
    }],
    resultsInterpreter: radiologist ? [{
      display: radiologist,
    }] : undefined,
  });
  await assignResourceToAccountReferences(client, 'DiagnosticReport', report, accountRefs);

  console.log(`✅ Created imaging DiagnosticReport: ${report.id}`);

  // Create Provenance for audit trail (non-blocking)
  if (report.id) {
    try {
      await createProvenanceForResource(
        client,
        'DiagnosticReport',
        report.id,
        radiologist ? undefined : undefined, // Could parse radiologist ID if provided
        undefined,
        'CREATE',
        accountRefs
      );
      console.log(`✅ Created Provenance for DiagnosticReport/${report.id}`);
    } catch (error) {
      console.warn(`⚠️  Failed to create Provenance for DiagnosticReport (non-blocking):`, error);
    }
  }

  return report.id!;
}

/**
 * Get all imaging orders for a patient
 */
export async function getPatientImagingOrders(patientId: string, medplum: MedplumClient): Promise<ServiceRequest[]> {
  const client = medplum;
  
  const orders = await client.searchResources('ServiceRequest', {
    subject: `Patient/${patientId}`,
    category: '363679005', // SNOMED CT code for Imaging
    _sort: '-authored',
  });

  return orders;
}

/**
 * Get all imaging studies for a patient
 */
export async function getPatientImagingStudies(patientId: string, medplum: MedplumClient): Promise<ImagingReportSummary[]> {
  const client = medplum;
  
  const studies = await client.searchResources('ImagingStudy', {
    subject: `Patient/${patientId}`,
    _sort: '-started',
  });

  const summaries: ImagingReportSummary[] = [];

  for (const study of studies) {
    // Get associated diagnostic report if exists
    const reports = await client.searchResources('DiagnosticReport', {
      study: `ImagingStudy/${study.id}`,
    });

    const report = reports[0];

    summaries.push({
      id: study.id!,
      patientId,
      patientName: study.subject?.display,
      encounterId: study.encounter?.reference?.split('/')[1],
      procedure: study.procedureCode?.[0]?.text || 'Unknown Procedure',
      modality: study.modality?.[0]?.code || 'Unknown',
      status: study.status as any,
      orderedAt: study.started ? new Date(study.started) : new Date(),
      performedAt: study.started ? new Date(study.started) : undefined,
      study: {
        studyUid: study.identifier?.[0]?.value || '',
        accessionNumber: study.identifier?.find(i => i.system === 'accession')?.value,
        modality: study.modality?.[0]?.code || '',
        description: study.description,
        numberOfSeries: study.numberOfSeries || 0,
        numberOfInstances: study.numberOfInstances || 0,
        started: study.started ? new Date(study.started) : undefined,
        series: (study.series || []).map(s => ({
          uid: s.uid,
          number: s.number || 0,
          modality: s.modality?.code || '',
          description: s.description,
          numberOfInstances: s.numberOfInstances || 0,
          bodySite: s.bodySite?.display,
          started: s.started ? new Date(s.started) : undefined,
          endpoint: s.endpoint?.[0]?.reference,
        })),
      },
      report: report ? {
        id: report.id!,
        status: report.status as any,
        findings: report.conclusionCode?.[0]?.text,
        impression: report.conclusion,
        radiologist: report.resultsInterpreter?.[0]?.display,
        issuedAt: report.issued ? new Date(report.issued) : undefined,
      } : undefined,
    });
  }

  return summaries;
}

/**
 * Get imaging studies for an encounter
 */
export async function getEncounterImagingStudies(encounterId: string, medplum: MedplumClient): Promise<ImagingReportSummary[]> {
  const client = medplum;
  
  const studies = await client.searchResources('ImagingStudy', {
    encounter: `Encounter/${encounterId}`,
    _sort: '-started',
  });

  const summaries: ImagingReportSummary[] = [];

  for (const study of studies) {
    const reports = await client.searchResources('DiagnosticReport', {
      study: `ImagingStudy/${study.id}`,
    });

    const report = reports[0];

    summaries.push({
      id: study.id!,
      patientId: study.subject?.reference?.split('/')[1] || '',
      patientName: study.subject?.display,
      encounterId,
      procedure: study.procedureCode?.[0]?.text || 'Unknown Procedure',
      modality: study.modality?.[0]?.code || 'Unknown',
      status: study.status as any,
      orderedAt: study.started ? new Date(study.started) : new Date(),
      performedAt: study.started ? new Date(study.started) : undefined,
      study: {
        studyUid: study.identifier?.[0]?.value || '',
        accessionNumber: study.identifier?.find(i => i.system === 'accession')?.value,
        modality: study.modality?.[0]?.code || '',
        description: study.description,
        numberOfSeries: study.numberOfSeries || 0,
        numberOfInstances: study.numberOfInstances || 0,
        started: study.started ? new Date(study.started) : undefined,
        series: (study.series || []).map(s => ({
          uid: s.uid,
          number: s.number || 0,
          modality: s.modality?.code || '',
          description: s.description,
          numberOfInstances: s.numberOfInstances || 0,
          bodySite: s.bodySite?.display,
          started: s.started ? new Date(s.started) : undefined,
          endpoint: s.endpoint?.[0]?.reference,
        })),
      },
      report: report ? {
        id: report.id!,
        status: report.status as any,
        findings: report.conclusionCode?.[0]?.text,
        impression: report.conclusion,
        radiologist: report.resultsInterpreter?.[0]?.display,
        issuedAt: report.issued ? new Date(report.issued) : undefined,
      } : undefined,
    });
  }

  return summaries;
}

/**
 * Get a specific imaging study
 */
export async function getImagingStudy(studyId: string, medplum: MedplumClient): Promise<ImagingReportSummary | null> {
  try {
    const client = medplum;
    
    const study = await client.readResource('ImagingStudy', studyId);
    
    const reports = await client.searchResources('DiagnosticReport', {
      study: `ImagingStudy/${studyId}`,
    });

    const report = reports[0];

    return {
      id: study.id!,
      patientId: study.subject?.reference?.split('/')[1] || '',
      patientName: study.subject?.display,
      encounterId: study.encounter?.reference?.split('/')[1],
      procedure: study.procedureCode?.[0]?.text || 'Unknown Procedure',
      modality: study.modality?.[0]?.code || 'Unknown',
      status: study.status as any,
      orderedAt: study.started ? new Date(study.started) : new Date(),
      performedAt: study.started ? new Date(study.started) : undefined,
      study: {
        studyUid: study.identifier?.[0]?.value || '',
        accessionNumber: study.identifier?.find(i => i.system === 'accession')?.value,
        modality: study.modality?.[0]?.code || '',
        description: study.description,
        numberOfSeries: study.numberOfSeries || 0,
        numberOfInstances: study.numberOfInstances || 0,
        started: study.started ? new Date(study.started) : undefined,
        series: (study.series || []).map(s => ({
          uid: s.uid,
          number: s.number || 0,
          modality: s.modality?.code || '',
          description: s.description,
          numberOfInstances: s.numberOfInstances || 0,
          bodySite: s.bodySite?.display,
          started: s.started ? new Date(s.started) : undefined,
          endpoint: s.endpoint?.[0]?.reference,
        })),
      },
      report: report ? {
        id: report.id!,
        status: report.status as any,
        findings: report.conclusionCode?.[0]?.text,
        impression: report.conclusion,
        radiologist: report.resultsInterpreter?.[0]?.display,
        issuedAt: report.issued ? new Date(report.issued) : undefined,
      } : undefined,
    };
  } catch (error) {
    console.error('Failed to get imaging study:', error);
    return null;
  }
}

export interface PendingXrayOrder {
  id: string;
  code: string;
  display: string;
  status: NonNullable<ServiceRequest['status']>;
  priority?: ServiceRequest['priority'];
  authoredOn?: string;
  deviceId?: string;
}

/**
 * Get X-ray orders (ServiceRequest tagged `xray`) for a patient that are still
 * waiting on a result (not completed/revoked/cancelled). Used by the Lab tab
 * so staff can see a study is in progress, not just the final result.
 */
export async function getPatientPendingXrayOrders(patientId: string, medplum: MedplumClient, clinicId: string): Promise<PendingXrayOrder[]> {
  if (!(await isModuleEnabledForClinic('pacs', clinicId))) return [];
  const orders = await medplum.searchResources('ServiceRequest', {
    identifier: `clinic|${clinicId}`,
    subject: `Patient/${patientId}`,
    _tag: `${XRAY_TAG_SYSTEM}|xray`,
    status: 'active,on-hold',
    _sort: '-authored',
  }, { cache: 'no-cache' });

  return orders.map((order) => ({
    id: order.id!,
    code: order.code?.coding?.[0]?.code || '',
    display: order.code?.text || order.code?.coding?.[0]?.display || 'X-ray study',
    status: order.status || 'active',
    priority: order.priority,
    authoredOn: order.authoredOn,
    deviceId: order.performer?.[0]?.reference?.split('/')[1],
  }));
}

function isXrayTaggedOrder(serviceRequest: ServiceRequest): boolean {
  return Boolean(serviceRequest.meta?.tag?.some((tag) => tag.system === XRAY_TAG_SYSTEM && tag.code === 'xray'));
}

/**
 * A disabled pacs module must block mutation of its own X-ray orders, same as it blocks
 * creating new ones -- but a generic (non-device) imaging order must stay mutable
 * regardless of the toggle, since it's a separate, always-on feature.
 */
async function assertXrayOrderMutable(serviceRequest: ServiceRequest, clinicId: string): Promise<void> {
  if (isXrayTaggedOrder(serviceRequest) && !(await isModuleEnabledForClinic('pacs', clinicId))) {
    throw new ForbiddenError('PACS module is disabled for this clinic');
  }
}

/**
 * Update an imaging order (e.g. cancel or change priority)
 */
export async function updateImagingOrder(
  serviceRequestId: string,
  updates: { status?: 'active' | 'on-hold' | 'revoked' | 'completed'; priority?: 'routine' | 'urgent' | 'asap' | 'stat'; clinicalIndication?: string },
  medplum: MedplumClient,
  clinicId: string
): Promise<void> {
  const serviceRequest = await medplum.readResource('ServiceRequest', serviceRequestId);
  await assertXrayOrderMutable(serviceRequest, clinicId);
  const updated: ServiceRequest = { ...serviceRequest };
  if (updates.status) updated.status = updates.status;
  if (updates.priority) updated.priority = updates.priority;
  if (updates.clinicalIndication !== undefined) {
    updated.reasonCode = updates.clinicalIndication ? [{ text: updates.clinicalIndication }] : undefined;
  }
  await medplum.updateResource(updated);
  console.log(`✅ Updated ImagingOrder ServiceRequest ${serviceRequestId}`);
}

/**
 * Delete an imaging order
 */
export async function deleteImagingOrder(serviceRequestId: string, medplum: MedplumClient, clinicId: string): Promise<void> {
  const serviceRequest = await medplum.readResource('ServiceRequest', serviceRequestId);
  await assertXrayOrderMutable(serviceRequest, clinicId);
  await medplum.deleteResource('ServiceRequest', serviceRequestId);
  console.log(`✅ Deleted ImagingOrder ServiceRequest ${serviceRequestId}`);
}
