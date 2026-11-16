/**
 * PACS ingress (X-ray phase 3): turn a study that Orthanc has stored into a FHIR ImagingStudy.
 * Server-only.
 *
 * Rules:
 *  - The clinic is the authenticated device's clinic. Nothing outside it is read or written.
 *  - A study is attached automatically ONLY when its DICOM AccessionNumber equals the accession
 *    identifier of exactly one open X-ray order of that clinic.
 *  - Everything else (no/unknown accession, ambiguous, order closed or already holding another study)
 *    goes to the clinic's review list (a FHIR Task) and is never attached without a staff decision.
 *  - Re-notification of a known study only refreshes its series/instance counts (idempotent).
 */
import type { MedplumClient } from '@medplum/core';
import type { ImagingStudy, ServiceRequest, Task } from '@medplum/fhirtypes';
import { receiveImagingStudy } from '@/lib/fhir/imaging-service';
import { assignResourceToClinicTenant, getClinicIdentifierValue, resolveClinicTenant } from '@/lib/fhir/clinic-tenancy';
import { XRAY_TAG_SYSTEM } from '@/lib/fhir/xray-device';
import { isPacsStoredStudy, isXrayStudy, PACS_STORED_TAG } from '@/lib/fhir/pacs-link';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/server/route-helpers';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { DICOM_UID_SYSTEM, XRAY_ACCESSION_SYSTEM, normalizeAccessionNumber, readAccessionNumber, readStudyUid } from './accession';
import { fetchOrthancStudy, pacsServesClinic, requirePacsConfig, type OrthancStudy } from './orthanc-client';
import type { ImagingStudyData } from '@/lib/fhir/imaging-constants';

export const UNMATCHED_TASK_SYSTEM = 'https://ucc.emr/pacs/task';
export const UNMATCHED_TASK_CODE = 'unmatched-study';
const DCM = 'http://dicom.nema.org/resources/ontology/DCM';
const FHIR_ID = /^[A-Za-z0-9.-]{1,64}$/;

export type UnmatchedReason = 'no-accession' | 'no-order' | 'ambiguous' | 'order-closed' | 'order-has-study';

export type IngestOutcome =
  | { outcome: 'matched'; imagingStudyId: string; serviceRequestId?: string; created: boolean }
  | { outcome: 'unmatched'; reviewId: string; reason: UnmatchedReason };

const NO_CACHE = { cache: 'no-cache' as const };
const inClinic = (resource: { identifier?: { system?: string; value?: string }[] }, clinicId: string) =>
  getClinicIdentifierValue(resource) === clinicId;
const isXrayOrder = (order: ServiceRequest) =>
  Boolean(order.meta?.tag?.some((tag) => tag.system === XRAY_TAG_SYSTEM && tag.code === 'xray'));

function toStudyData(study: OrthancStudy): ImagingStudyData {
  return {
    studyUid: study.studyUid,
    accessionNumber: study.accessionNumber,
    modality: study.modality,
    description: study.description,
    numberOfSeries: study.series.length,
    numberOfInstances: study.numberOfInstances,
    started: study.started,
    series: study.series.map((s) => ({
      uid: s.uid, number: s.number, modality: s.modality, description: s.description,
      numberOfInstances: s.numberOfInstances, bodySite: s.bodySite,
    })),
  };
}

function twoIdentifiers(a: string, b: string, extra: Record<string, string> = {}): URLSearchParams {
  const query = new URLSearchParams(extra);
  query.append('identifier', a);
  query.append('identifier', b);
  return query;
}

async function findStudyByUid(medplum: MedplumClient, clinicId: string, studyUid: string): Promise<ImagingStudy | undefined> {
  const found = await medplum.searchResources('ImagingStudy',
    twoIdentifiers(`clinic|${clinicId}`, `${DICOM_UID_SYSTEM}|urn:oid:${studyUid}`, { _count: '5' }), NO_CACHE);
  return found.find((s) => inClinic(s, clinicId) && readStudyUid(s) === studyUid);
}

async function findReviewTask(medplum: MedplumClient, clinicId: string, studyUid: string): Promise<Task | undefined> {
  const found = await medplum.searchResources('Task',
    twoIdentifiers(`clinic|${clinicId}`, `${DICOM_UID_SYSTEM}|urn:oid:${studyUid}`, { _count: '5' }), NO_CACHE);
  return found.find((t) => inClinic(t, clinicId) && isReviewTask(t) && readStudyUid(t) === studyUid);
}

function isReviewTask(task: Task): boolean {
  return Boolean(task.code?.coding?.some((c) => c.system === UNMATCHED_TASK_SYSTEM && c.code === UNMATCHED_TASK_CODE));
}

function reviewInputs(study: OrthancStudy): NonNullable<Task['input']> {
  const input: NonNullable<Task['input']> = [];
  const add = (name: string, value: string | undefined) => { if (value) input.push({ type: { text: name }, valueString: value }); };
  add('orthancStudyId', study.orthancStudyId);
  add('accessionNumber', study.accessionNumber);
  add('description', study.description);
  add('modality', study.modality);
  add('dicomPatientId', study.dicomPatientId);
  add('dicomPatientName', study.dicomPatientName);
  add('started', study.started?.toISOString());
  input.push({ type: { text: 'numberOfInstances' }, valueInteger: study.numberOfInstances });
  return input;
}

async function upsertReviewTask(medplum: MedplumClient, clinicId: string, study: OrthancStudy, reason: UnmatchedReason): Promise<string> {
  const existing = await findReviewTask(medplum, clinicId, study.studyUid);
  if (existing?.id) {
    // A dismissed or attached study stays decided; only an open entry is refreshed.
    if (existing.status === 'requested') {
      await medplum.updateResource<Task>({ ...existing, statusReason: { text: reason }, input: reviewInputs(study), lastModified: new Date().toISOString() });
    }
    return existing.id;
  }
  const task = await medplum.createResource<Task>({
    resourceType: 'Task',
    status: 'requested',
    intent: 'unknown',
    code: { coding: [{ system: UNMATCHED_TASK_SYSTEM, code: UNMATCHED_TASK_CODE, display: 'Unmatched imaging study' }] },
    identifier: [{ system: 'clinic', value: clinicId }, { system: DICOM_UID_SYSTEM, value: `urn:oid:${study.studyUid}` }],
    description: 'Imaging study received without a matching X-ray order',
    statusReason: { text: reason },
    authoredOn: new Date().toISOString(),
    input: reviewInputs(study),
  });
  await assignResourceToClinicTenant(medplum, 'Task', task, await resolveClinicTenant(medplum, clinicId));
  return task.id!;
}

async function closeReviewTask(medplum: MedplumClient, clinicId: string, studyUid: string, imagingStudyId: string): Promise<void> {
  const task = await findReviewTask(medplum, clinicId, studyUid);
  if (task?.status === 'requested') {
    await medplum.updateResource<Task>({ ...task, status: 'completed', focus: { reference: `ImagingStudy/${imagingStudyId}` }, lastModified: new Date().toISOString() });
  }
}

async function refreshStudy(medplum: MedplumClient, existing: ImagingStudy, study: OrthancStudy): Promise<void> {
  const data = toStudyData(study);
  await medplum.updateResource<ImagingStudy>({
    ...existing,
    // A phase-2 device notification may have created this study before the pixels arrived.
    // Only this trusted Orthanc read-back can promote it to a stored, viewer-ready study.
    meta: isXrayStudy(existing) && !isPacsStoredStudy(existing)
      ? { ...existing.meta, tag: [...(existing.meta?.tag ?? []), PACS_STORED_TAG] }
      : existing.meta,
    numberOfSeries: data.numberOfSeries,
    numberOfInstances: data.numberOfInstances,
    description: data.description ?? existing.description,
    series: data.series.map((s) => ({
      uid: s.uid, number: s.number, modality: { system: DCM, code: s.modality }, description: s.description,
      numberOfInstances: s.numberOfInstances, bodySite: s.bodySite ? { display: s.bodySite } : undefined,
    })),
  });
}

/** Create/update the ImagingStudy for a study held by the clinic PACS, or file it for review. */
export async function ingestPacsStudy(study: OrthancStudy, medplum: MedplumClient, deviceClinicId: string): Promise<IngestOutcome> {
  if (!deviceClinicId) throw new ForbiddenError('Device is not bound to a clinic');

  const known = await findStudyByUid(medplum, deviceClinicId, study.studyUid);
  if (known?.id) {
    await refreshStudy(medplum, known, study);
    return { outcome: 'matched', imagingStudyId: known.id, serviceRequestId: known.basedOn?.[0]?.reference?.split('/')[1], created: false };
  }

  const unmatched = async (reason: UnmatchedReason): Promise<IngestOutcome> =>
    ({ outcome: 'unmatched', reason, reviewId: await upsertReviewTask(medplum, deviceClinicId, study, reason) });

  // Once an unknown study has entered review, a later matching order or corrected accession
  // must not silently attach it. Only the explicit staff attach action can decide its patient.
  const reviewed = await findReviewTask(medplum, deviceClinicId, study.studyUid);
  if (reviewed?.id) {
    const reason = (reviewed.statusReason?.text || 'no-order') as UnmatchedReason;
    return unmatched(reason);
  }

  const accession = normalizeAccessionNumber(study.accessionNumber);
  if (!accession) return unmatched('no-accession');

  // Clinic AND accession in the query, then re-checked on the returned resources: an order of another
  // clinic carrying the same accession number can never match.
  const candidates = (await medplum.searchResources('ServiceRequest',
    twoIdentifiers(`clinic|${deviceClinicId}`, `${XRAY_ACCESSION_SYSTEM}|${accession}`, { _count: '5' }), NO_CACHE))
    .filter((order) => order.id && inClinic(order, deviceClinicId) && readAccessionNumber(order) === accession && isXrayOrder(order));
  if (!candidates.length) return unmatched('no-order');
  if (candidates.length > 1) return unmatched('ambiguous');
  const order = candidates[0];
  if (order.status === 'completed') return unmatched('order-has-study');
  if (order.status !== 'active' && order.status !== 'on-hold') return unmatched('order-closed');

  // receiveImagingStudy re-reads the order (extended) and asserts it is in the device's clinic.
  const imagingStudyId = await receiveImagingStudy(order.id!, toStudyData(study), medplum, deviceClinicId, { pacsStored: true });
  await closeReviewTask(medplum, deviceClinicId, study.studyUid, imagingStudyId);
  return { outcome: 'matched', imagingStudyId, serviceRequestId: order.id, created: true };
}

// ---------------------------------------------------------------------------------------------
// Review list (clinic staff). Tasks are clinic configuration-like work items that the staff
// AccessPolicy does not grant, so they are read/written with the server client, always scoped by the
// caller's authenticated clinicId (same pattern as lib/fhir/xray-device.ts).
// ---------------------------------------------------------------------------------------------

export interface UnmatchedStudy {
  id: string;
  studyUid: string;
  reason: string;
  receivedAt?: string;
  accessionNumber?: string;
  description?: string;
  modality?: string;
  dicomPatientId?: string;
  dicomPatientName?: string;
  started?: string;
  numberOfInstances?: number;
}

function projectTask(task: Task): UnmatchedStudy {
  const value = (name: string) => task.input?.find((i) => i.type?.text === name)?.valueString;
  return {
    id: task.id!,
    studyUid: readStudyUid(task) || '',
    reason: task.statusReason?.text || 'no-order',
    receivedAt: task.authoredOn,
    accessionNumber: value('accessionNumber'),
    description: value('description'),
    modality: value('modality'),
    dicomPatientId: value('dicomPatientId'),
    dicomPatientName: value('dicomPatientName'),
    started: value('started'),
    numberOfInstances: task.input?.find((i) => i.type?.text === 'numberOfInstances')?.valueInteger,
  };
}

export async function listUnmatchedStudies(clinicId: string): Promise<UnmatchedStudy[]> {
  const client = await getAdminMedplum();
  const tasks = await client.searchResources('Task', {
    identifier: `clinic|${clinicId}`,
    code: `${UNMATCHED_TASK_SYSTEM}|${UNMATCHED_TASK_CODE}`,
    status: 'requested',
    _sort: '-authored-on',
    _count: '50',
  }, NO_CACHE);
  return tasks.filter((t) => t.id && inClinic(t, clinicId) && isReviewTask(t) && t.status === 'requested').map(projectTask);
}

async function readOpenReviewTask(client: MedplumClient, clinicId: string, reviewId: string): Promise<Task> {
  if (!FHIR_ID.test(reviewId)) throw new NotFoundError('Unmatched study not found');
  // Search with BOTH clinic and id: never read another clinic's entry by id.
  const task = await client.searchOne('Task', { identifier: `clinic|${clinicId}`, _id: reviewId }, NO_CACHE);
  if (!task?.id || !inClinic(task, clinicId) || !isReviewTask(task)) throw new NotFoundError('Unmatched study not found');
  if (task.status !== 'requested') throw new ConflictError('This study has already been reviewed');
  return task;
}

export async function dismissUnmatchedStudy(clinicId: string, reviewId: string, actor?: string): Promise<void> {
  const client = await getAdminMedplum();
  const task = await readOpenReviewTask(client, clinicId, reviewId);
  await client.updateResource<Task>({
    ...task, status: 'rejected', lastModified: new Date().toISOString(),
    owner: actor ? { reference: actor } : task.owner,
  });
}

/**
 * Staff decision: attach a reviewed study to an open X-ray order of the SAME clinic. The order is
 * looked up with the caller's own client (their access policy applies) and the study is re-read from
 * the PACS, so nothing from the browser is trusted beyond the two ids.
 */
export async function attachUnmatchedStudy(
  clinicId: string, reviewId: string, serviceRequestId: string, staffMedplum: MedplumClient, actor?: string
): Promise<{ imagingStudyId: string }> {
  const config = requirePacsConfig();
  const client = await getAdminMedplum();
  const task = await readOpenReviewTask(client, clinicId, reviewId);
  if (!FHIR_ID.test(serviceRequestId)) throw new ForbiddenError('Order unavailable in current clinic');
  const order = await staffMedplum.searchOne('ServiceRequest', { identifier: `clinic|${clinicId}`, _id: serviceRequestId }, NO_CACHE);
  if (!order?.id || !inClinic(order, clinicId)) throw new ForbiddenError('Order unavailable in current clinic');
  if (!isXrayOrder(order) || (order.status !== 'active' && order.status !== 'on-hold')) {
    throw new ConflictError('Only an open X-ray order can receive a study');
  }
  const studyUid = readStudyUid(task);
  const orthancStudyId = task.input?.find((i) => i.type?.text === 'orthancStudyId')?.valueString;
  if (!pacsServesClinic(config, clinicId)) throw new ForbiddenError('PACS storage is not available to this clinic');
  const study = orthancStudyId ? await fetchOrthancStudy(config, orthancStudyId) : undefined;
  if (!study || !studyUid || study.studyUid !== studyUid) throw new ConflictError('The study is no longer available in the PACS');
  if (await findStudyByUid(client, clinicId, studyUid)) throw new ConflictError('This study is already attached to an order');

  const imagingStudyId = await receiveImagingStudy(order.id, toStudyData(study), client, clinicId, { pacsStored: true });
  await client.updateResource<Task>({
    ...task, status: 'completed', lastModified: new Date().toISOString(),
    focus: { reference: `ImagingStudy/${imagingStudyId}` },
    owner: actor ? { reference: actor } : task.owner,
  });
  return { imagingStudyId };
}

export interface OpenXrayOrder {
  id: string;
  display: string;
  accessionNumber?: string;
  authoredOn?: string;
  patientName?: string;
}

/** Open X-ray orders of the caller's clinic, for the "attach to order" picker. Uses the caller's client. */
export async function listOpenXrayOrders(clinicId: string, staffMedplum: MedplumClient): Promise<OpenXrayOrder[]> {
  const orders = (await staffMedplum.searchResources('ServiceRequest', {
    identifier: `clinic|${clinicId}`, _tag: `${XRAY_TAG_SYSTEM}|xray`, status: 'active,on-hold', _sort: '-authored', _count: '50',
  }, NO_CACHE)).filter((o) => o.id && inClinic(o, clinicId) && isXrayOrder(o));
  const patientIds = [...new Set(orders.map((o) => o.subject?.reference?.split('/')[1]).filter((id): id is string => Boolean(id && FHIR_ID.test(id))))];
  const names = new Map<string, string>();
  if (patientIds.length) {
    const patients = await staffMedplum.searchResources('Patient', { identifier: `clinic|${clinicId}`, _id: patientIds.join(','), _count: '50' }, NO_CACHE);
    for (const p of patients) {
      const n = p.name?.[0];
      const label = n?.text || [...(n?.given ?? []), n?.family].filter(Boolean).join(' ');
      if (p.id && label) names.set(p.id, label);
    }
  }
  return orders.map((o) => ({
    id: o.id!,
    display: o.code?.text || o.code?.coding?.[0]?.display || 'X-ray study',
    accessionNumber: readAccessionNumber(o),
    authoredOn: o.authoredOn,
    patientName: names.get(o.subject?.reference?.split('/')[1] || ''),
  }));
}
