/**
 * Lab Service - POCT (Point-of-Care Testing) Integration
 * 
 * Handles lab orders and results using FHIR resources:
 * - ServiceRequest: Lab orders
 * - DiagnosticReport: Lab results
 * - Observation: Individual test results
 */

import { MedplumClient } from '@medplum/core';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import type {
  ServiceRequest,
  DiagnosticReport,
  Observation,
  Patient as FHIRPatient,
} from '@medplum/fhirtypes';
import { createProvenanceForResource } from './provenance-service';
import { validateAndCreate } from './fhir-helpers';
import { createResourcesInBundle } from './bundle-helpers';
import { POCT_TESTS } from './lab-constants';
import { POCT_TAG_SYSTEM, requireOnlineAnalyser } from './poct-device';
import { isModuleEnabledForClinic } from '@/lib/module-registry';
import { ConflictError, ForbiddenError } from '@/lib/server/route-helpers';
import { LAB_TESTS, type LabTestCode, type LabReportSummary, type LabResult } from './lab-constants';
import {
  assignResourceToAccountReferences,
  assignResourceToClinicTenant,
  getResourceAccountReferences,
  resolveClinicTenant,
} from './clinic-tenancy';

export { LAB_TESTS, type LabTestCode, type LabReportSummary, type LabResult };

const CLINIC_IDENTIFIER_SYSTEM = 'clinic';

export type LabOrderTest = LabTestCode | {
  code: string;
  display: string;
  system?: string;
};

export interface LabOrderRequest {
  patientId: string;
  encounterId?: string;
  tests: LabOrderTest[];
  priority?: 'routine' | 'urgent' | 'asap' | 'stat';
  clinicalNotes?: string;
  orderedBy?: string;
  poct?: { code: string; analyserId: string; entryId: string };
}

function resolveLabTest(test: LabOrderTest): { code: string; display: string; system: string } {
  if (typeof test === 'string') {
    const known = LAB_TESTS[test as LabTestCode];
    return known || { code: test, display: test, system: 'http://loinc.org' };
  }

  return {
    code: test.code,
    display: test.display || test.code,
    system: test.system || 'http://loinc.org',
  };
}

/**
 * Create a lab order (ServiceRequest)
 */
export async function createLabOrder(order: LabOrderRequest, medplum: MedplumClient, clinicId: string): Promise<string> {
  const client = medplum;
  const clinicTenant = await resolveClinicTenant(client, clinicId);
  const clinicQuery = { identifier: `clinic|${clinicId}` };
  const patient = await client.searchOne('Patient', { ...clinicQuery, _id: order.patientId });
  if (!patient) throw new ForbiddenError('Patient unavailable in current clinic');
  if (order.encounterId) {
    const encounter = await client.searchOne('Encounter', { ...clinicQuery, _id: order.encounterId });
    if (!encounter || encounter.subject?.reference !== `Patient/${order.patientId}`) throw new ForbiddenError('Encounter unavailable in current clinic');
  }
  const poctTest = order.poct && POCT_TESTS.find((t) => t.code === order.poct!.code);
  if (order.poct) {
    if (!(await isModuleEnabledForClinic('poct', clinicId))) {
      throw new ForbiddenError('POCT module is disabled for this clinic');
    }
    if (!poctTest || !order.encounterId || !/^[a-zA-Z0-9-]{1,64}$/.test(order.poct.entryId || '') || !/^[a-zA-Z0-9-]{1,64}$/.test(order.poct.analyserId || '')) {
      throw new ConflictError('Invalid POCT order');
    }
    await requireOnlineAnalyser(client, clinicId, order.poct.analyserId, poctTest.analyserType);
    order = { ...order, tests: [{ code: poctTest.code, display: poctTest.name, system: poctTest.system }] };
  }

  // Create a ServiceRequest for each test
  const serviceRequests: ServiceRequest[] = [];
  
  for (const testCode of order.tests) {
    const test = resolveLabTest(testCode);
    
    const resource: ServiceRequest = {
      resourceType: 'ServiceRequest',
      identifier: [{ system: CLINIC_IDENTIFIER_SYSTEM, value: clinicId },
        ...(order.poct ? [{ system: 'https://ucc.emr/poct/order-entry', value: `${clinicId}:${order.encounterId}:${order.poct.entryId}` }] : [])],
      meta: order.poct ? { tag: [{ system: POCT_TAG_SYSTEM, code: 'poct' }] } : undefined,
      category: [{ coding: [{ system: 'http://snomed.info/sct', code: '108252007', display: 'Laboratory procedure' }] }],
      performer: order.poct ? [{ reference: `Device/${order.poct.analyserId}` }] : undefined,
      status: 'active',
      intent: 'order',
      priority: order.priority || 'routine',
      code: {
        coding: [{
          system: test.system,
          code: test.code,
          display: test.display,
        }],
        text: test.display,
      },
      subject: {
        reference: `Patient/${order.patientId}`,
      },
      encounter: order.encounterId ? {
        reference: `Encounter/${order.encounterId}`,
      } : undefined,
      authoredOn: new Date().toISOString(),
      requester: order.orderedBy
        ? order.orderedBy.startsWith('Practitioner/')
          ? { reference: order.orderedBy }
          : { display: order.orderedBy }
        : undefined,
      note: order.clinicalNotes ? [{
        text: order.clinicalNotes,
      }] : undefined,
    };
    const serviceRequest = order.poct
      ? await client.createResourceIfNoneExist(resource, new URLSearchParams({ identifier: `https://ucc.emr/poct/order-entry|${clinicId}:${order.encounterId}:${order.poct.entryId}` }).toString())
      : await validateAndCreate<ServiceRequest>(client, resource);
    await assignResourceToClinicTenant(client, 'ServiceRequest', serviceRequest, clinicTenant);
    
    serviceRequests.push(serviceRequest);
    console.log(`✅ Created ServiceRequest: ${serviceRequest.id} for ${test.display}`);
    
    // Create Provenance for audit trail (non-blocking)
    if (serviceRequest.id) {
      try {
        await createProvenanceForResource(
          client,
          'ServiceRequest',
          serviceRequest.id,
          order.orderedBy?.startsWith('Practitioner/') ? order.orderedBy.split('/')[1] : undefined,
          clinicId,
          'CREATE'
        );
        console.log(`✅ Created Provenance for ServiceRequest/${serviceRequest.id}`);
      } catch (error) {
        console.warn(`⚠️  Failed to create Provenance for ServiceRequest (non-blocking):`, error);
      }
    }
  }

  // Return the first service request ID (or you could return all IDs)
  return serviceRequests[0]?.id || '';
}

/**
 * Receive lab results from POCT system and create DiagnosticReport + Observations
 */
export async function receiveLabResults(
  serviceRequestId: string,
  results: LabResult[],
  conclusion?: string,
  medplum?: MedplumClient
): Promise<string> {
  const client = medplum ?? (await getAdminMedplum());
  
  console.log(`📊 Receiving lab results for ServiceRequest ${serviceRequestId}`);

  // Get the original service request
  const serviceRequest = await client.readResource('ServiceRequest', serviceRequestId);
  const accountRefs = getResourceAccountReferences(serviceRequest);
  
  if (!serviceRequest.subject?.reference) {
    throw new Error('ServiceRequest has no patient reference');
  }

  // Create Observation resources (prepare for Bundle)
  const observationResources: Observation[] = [];
  
  for (const result of results) {
    observationResources.push({
      resourceType: 'Observation',
      status: result.status as any,
      code: {
        coding: [{
          system: 'http://loinc.org',
          code: result.testCode,
          display: result.testName,
        }],
        text: result.testName,
      },
      subject: {
        reference: serviceRequest.subject.reference,
      },
      encounter: serviceRequest.encounter,
      effectiveDateTime: result.performedAt?.toISOString() || new Date().toISOString(),
      issued: new Date().toISOString(),
      valueQuantity: typeof result.value === 'number' ? {
        value: result.value,
        unit: result.unit,
      } : undefined,
      valueString: typeof result.value === 'string' ? result.value : undefined,
      referenceRange: result.referenceRange ? [{
        text: result.referenceRange,
      }] : undefined,
      interpretation: result.interpretation ? [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
          code: result.interpretation === 'normal' ? 'N' : 
                result.interpretation === 'high' ? 'H' : 
                result.interpretation === 'low' ? 'L' : 'A',
          display: result.interpretation,
        }],
      }] : undefined,
    } as Observation);
  }

  // Create DiagnosticReport resource (prepare for Bundle)
  // Note: We'll need to update result references after Observations are created
  const diagnosticReportResource: DiagnosticReport = {
    resourceType: 'DiagnosticReport',
    status: results.every(r => r.status === 'final') ? 'final' : 'partial',
    code: serviceRequest.code || { text: 'Laboratory Report' },
    subject: {
      reference: serviceRequest.subject.reference,
    },
    encounter: serviceRequest.encounter,
    effectiveDateTime: new Date().toISOString(),
    issued: new Date().toISOString(),
    result: [], // Will be populated after Observations are created
    conclusion: conclusion,
    basedOn: [{
      reference: `ServiceRequest/${serviceRequestId}`,
    }],
  };

  // Create all Observations in a Bundle transaction
  const observations = await createResourcesInBundle<Observation>(client, observationResources);
  await Promise.all(
    observations.map((obs) => assignResourceToAccountReferences(client, 'Observation', obs, accountRefs))
  );
  console.log(`✅ Created ${observations.length} Observations in Bundle transaction`);

  // Create Provenance for Observations (non-blocking)
  for (const obs of observations) {
    if (obs.id) {
      try {
        await createProvenanceForResource(client, 'Observation', obs.id, undefined, undefined, 'CREATE');
      } catch (error) {
        console.warn(`⚠️  Failed to create Provenance for Observation/${obs.id} (non-blocking):`, error);
      }
    }
  }

  // Update DiagnosticReport with Observation references
  diagnosticReportResource.result = observations.map(obs => ({
    reference: `Observation/${obs.id}`,
  }));

  // Create DiagnosticReport
  const diagnosticReport = await validateAndCreate<DiagnosticReport>(client, diagnosticReportResource);
  await assignResourceToAccountReferences(client, 'DiagnosticReport', diagnosticReport, accountRefs);

  console.log(`✅ Created DiagnosticReport: ${diagnosticReport.id}`);

  // Create Provenance for audit trail (non-blocking)
  if (diagnosticReport.id) {
    try {
      await createProvenanceForResource(
        client,
        'DiagnosticReport',
        diagnosticReport.id,
        undefined,
        undefined,
        'CREATE'
      );
      console.log(`✅ Created Provenance for DiagnosticReport/${diagnosticReport.id}`);
    } catch (error) {
      console.warn(`⚠️  Failed to create Provenance for DiagnosticReport (non-blocking):`, error);
    }
  }

  // Update ServiceRequest status to completed
  await client.updateResource({
    ...serviceRequest,
    status: 'completed',
  });

  return diagnosticReport.id!;
}

/**
 * Get all lab orders for a patient
 */
export async function getPatientLabOrders(patientId: string, medplum: MedplumClient): Promise<ServiceRequest[]> {
  const client = medplum;

  const orders = await client.searchResources('ServiceRequest', {
    subject: `Patient/${patientId}`,
    category: 'laboratory',
    _sort: '-authored',
  });

  return orders;
}

export interface PoctOrderSummary {
  id: string;
  patientId: string;
  patientName: string;
  testCode: string;
  testName: string;
  status: NonNullable<ServiceRequest['status']>;
  priority?: ServiceRequest['priority'];
  authoredOn?: string;
  analyserId?: string;
}

function getPatientDisplayName(patient: FHIRPatient): string {
  const name = patient.name?.[0];
  if (!name) return patient.id || 'Patient';
  if (name.text) return name.text;
  const parts = [...(name.given || []), name.family].filter(Boolean);
  return parts.join(' ') || patient.id || 'Patient';
}

/**
 * Get every POCT order (ServiceRequest tagged `poct`) for a clinic, regardless of patient.
 * Used by the /poct worklist page so it reflects orders signed from the treatment composer.
 */
export async function getClinicPoctOrders(clinicId: string, medplum: MedplumClient): Promise<PoctOrderSummary[]> {
  const client = medplum;

  const orders = await client.searchResources('ServiceRequest', {
    identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}`,
    _tag: `${POCT_TAG_SYSTEM}|poct`,
    _sort: '-authored',
    _count: '200',
  }, { cache: 'no-cache' });

  const patientIds = [...new Set(
    orders.map((order) => order.subject?.reference?.split('/')[1]).filter((id): id is string => Boolean(id))
  )];
  const patients = patientIds.length > 0
    ? await client.searchResources('Patient', { _id: patientIds.join(','), _count: String(patientIds.length) }, { cache: 'no-cache' })
    : [];
  const patientMap = new Map(patients.map((patient) => [patient.id, patient]));

  return orders.map((order) => {
    const patientId = order.subject?.reference?.split('/')[1] || '';
    const patient = patientMap.get(patientId);
    return {
      id: order.id!,
      patientId,
      patientName: patient ? getPatientDisplayName(patient) : patientId,
      testCode: order.code?.coding?.[0]?.code || '',
      testName: order.code?.text || order.code?.coding?.[0]?.display || 'POCT test',
      status: order.status || 'active',
      priority: order.priority,
      authoredOn: order.authoredOn,
      analyserId: order.performer?.[0]?.reference?.split('/')[1],
    };
  });
}

function observationToLabResult(obs: Observation): LabResult {
  return {
    testCode: obs.code?.coding?.[0]?.code || '',
    testName: obs.code?.text || obs.code?.coding?.[0]?.display || 'Unknown',
    value: (obs as any).valueQuantity?.value ?? (obs as any).valueString ?? 'N/A',
    unit: (obs as any).valueQuantity?.unit,
    referenceRange: obs.referenceRange?.[0]?.text,
    interpretation: obs.interpretation?.[0]?.coding?.[0]?.display as any,
    status: obs.status as any,
    performedAt: obs.effectiveDateTime ? new Date(obs.effectiveDateTime) : undefined,
  };
}

function buildLabReportSummary(
  report: DiagnosticReport,
  results: LabResult[],
  patientIdOverride?: string,
  encounterIdOverride?: string,
): LabReportSummary {
  return {
    id: report.id!,
    patientId: patientIdOverride ?? report.subject?.reference?.split('/')[1] ?? '',
    patientName: report.subject?.display,
    encounterId: encounterIdOverride ?? report.encounter?.reference?.split('/')[1],
    status: report.status as any,
    orderedAt: report.effectiveDateTime ? new Date(report.effectiveDateTime) : new Date(),
    issuedAt: report.issued ? new Date(report.issued) : undefined,
    results,
    conclusion: report.conclusion,
  };
}

function mapReportsToSummaries(
  reports: DiagnosticReport[],
  obsMap: Map<string, Observation>,
  patientIdOverride?: string,
  encounterIdOverride?: string,
): LabReportSummary[] {
  return reports.map((report) => {
    const results = (report.result ?? []).flatMap((ref) => {
      const obsId = ref.reference?.split('/')[1];
      if (!obsId) return [];
      const obs = obsMap.get(obsId);
      if (!obs) return [];
      return [observationToLabResult(obs)];
    });
    return buildLabReportSummary(report, results, patientIdOverride, encounterIdOverride);
  });
}

/**
 * Get all lab results for a patient
 */
export async function getPatientLabResults(patientId: string, medplum: MedplumClient): Promise<LabReportSummary[]> {
  const client = medplum;

  const reports = await client.searchResources('DiagnosticReport', {
    subject: `Patient/${patientId}`,
    _sort: '-issued',
  });

  const allObsIds = reports.flatMap((report) =>
    (report.result ?? [])
      .map((ref) => ref.reference?.split('/')[1])
      .filter((id): id is string => Boolean(id))
  );

  const allObservations = allObsIds.length > 0
    ? await client.searchResources('Observation', { _id: allObsIds.join(',') })
    : [];

  const obsMap = new Map(allObservations.map((obs) => [obs.id!, obs]));

  return mapReportsToSummaries(reports, obsMap, patientId);
}

/**
 * Update a lab order (e.g. cancel or change priority)
 */
export async function updateLabOrder(
  serviceRequestId: string,
  updates: { status?: 'active' | 'on-hold' | 'revoked' | 'completed'; priority?: 'routine' | 'urgent' | 'asap' | 'stat'; clinicalNotes?: string },
  medplum: MedplumClient
): Promise<void> {
  const serviceRequest = await medplum.readResource('ServiceRequest', serviceRequestId);
  const updated: ServiceRequest = { ...serviceRequest };
  if (updates.status) updated.status = updates.status;
  if (updates.priority) updated.priority = updates.priority;
  if (updates.clinicalNotes !== undefined) updated.note = updates.clinicalNotes ? [{ text: updates.clinicalNotes }] : undefined;
  await medplum.updateResource(updated);
  console.log(`✅ Updated ServiceRequest ${serviceRequestId}`);
}

/**
 * Delete a lab order
 */
export async function deleteLabOrder(serviceRequestId: string, medplum: MedplumClient): Promise<void> {
  await medplum.deleteResource('ServiceRequest', serviceRequestId);
  console.log(`✅ Deleted ServiceRequest ${serviceRequestId}`);
}

/**
 * Get a specific lab report by ID
 */
export async function getLabReport(reportId: string, medplum: MedplumClient): Promise<LabReportSummary | null> {
  try {
    const client = medplum;

    const report = await client.readResource('DiagnosticReport', reportId);

    const obsIds = (report.result ?? [])
      .map((ref) => ref.reference?.split('/')[1])
      .filter((id): id is string => Boolean(id));

    const observations = obsIds.length > 0
      ? await client.searchResources('Observation', { _id: obsIds.join(',') })
      : [];

    const obsMap = new Map(observations.map((obs) => [obs.id!, obs]));

    return mapReportsToSummaries([report], obsMap)[0] ?? null;
  } catch (error) {
    console.error('Failed to get lab report:', error);
    return null;
  }
}

/**
 * Get lab results for an encounter
 */
export async function getEncounterLabResults(encounterId: string, medplum: MedplumClient): Promise<LabReportSummary[]> {
  const client = medplum;

  const reports = await client.searchResources('DiagnosticReport', {
    encounter: `Encounter/${encounterId}`,
    _sort: '-issued',
  });

  const allObsIds = reports.flatMap((report) =>
    (report.result ?? [])
      .map((ref) => ref.reference?.split('/')[1])
      .filter((id): id is string => Boolean(id))
  );

  const allObservations = allObsIds.length > 0
    ? await client.searchResources('Observation', { _id: allObsIds.join(',') })
    : [];

  const obsMap = new Map(allObservations.map((obs) => [obs.id!, obs]));

  return mapReportsToSummaries(reports, obsMap, undefined, encounterId);
}
