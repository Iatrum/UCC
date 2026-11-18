import { createHash } from 'node:crypto';
import type { MedplumClient } from '@medplum/core';
import type { DocumentReference } from '@medplum/fhirtypes';
import { assertOrderClinic } from '@/lib/fhir/clinic-tenancy';
import { ConflictError, ForbiddenError } from '@/lib/server/route-helpers';
import { loadMe } from '@/lib/server/medplum-auth';

const KEY_SYSTEM = 'urn:ucc:consultation-draft';
export type DraftScope = {
  medplum: MedplumClient; clinicId: string; patientId: string;
  practitioner: string; draftId: string; consultationId?: string;
};
const fresh = { cache: 'no-cache' as const, headers: { 'X-Medplum': 'extended' } };
export async function draftScope(
  medplum: MedplumClient, clinicId: string, patientId: string, draftId: string, consultationId?: string,
): Promise<DraftScope> {
  // Shares the memoised GET /auth/me that requireClinicAuth already made for this token
  // (getProfileAsync() issued a second, uncached one).
  const { profile } = await loadMe(medplum);
  if (profile?.resourceType !== 'Practitioner' || !profile.id) throw new ForbiddenError('Practitioner required');
  await assertOrderClinic(medplum, clinicId, patientId, consultationId);
  return { medplum, clinicId, patientId, draftId, consultationId, practitioner: `Practitioner/${profile.id}` };
}
function key(scope: DraftScope) {
  return createHash('sha256').update(JSON.stringify([
    scope.clinicId, scope.practitioner, scope.patientId, scope.consultationId || '', scope.draftId,
  ])).digest('hex');
}
function authorize(scope: DraftScope, doc: DocumentReference) {
  if (doc.subject?.reference !== `Patient/${scope.patientId}` ||
      doc.author?.length !== 1 || doc.author[0].reference !== scope.practitioner ||
      !doc.identifier?.some(i => i.system === 'clinic' && i.value === scope.clinicId) ||
      !doc.identifier?.some(i => i.system === KEY_SYSTEM && i.value === key(scope))) {
    throw new ForbiddenError('Draft unavailable');
  }
}
export async function readDraft(scope: DraftScope): Promise<DocumentReference | undefined> {
  const doc = await scope.medplum.searchOne('DocumentReference', {
    identifier: `${KEY_SYSTEM}|${key(scope)}`,
    subject: `Patient/${scope.patientId}`, author: scope.practitioner,
  }, fresh);
  if (doc) authorize(scope, doc);
  return doc;
}
export function draftValue<T>(doc: DocumentReference | undefined, empty: T): T {
  if (!doc || doc.status !== 'current') return empty;
  const data = doc.content[0]?.attachment.data;
  if (!data) throw new Error('Draft content unavailable');
  return JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as T;
}
export async function writeDraft<T>(scope: DraftScope, value: T, existing?: DocumentReference) {
  const resource: DocumentReference = {
    resourceType: 'DocumentReference', status: 'current', docStatus: 'preliminary',
    identifier: [{ system: 'clinic', value: scope.clinicId }, { system: KEY_SYSTEM, value: key(scope) }],
    type: { coding: [{ system: KEY_SYSTEM, code: 'unsigned-draft' }] },
    subject: { reference: `Patient/${scope.patientId}` }, author: [{ reference: scope.practitioner }],
    ...(scope.consultationId ? { context: { encounter: [{ reference: `Encounter/${scope.consultationId}` }] } } : {}),
    date: new Date().toISOString(),
    content: [{ attachment: { contentType: 'application/json', data: Buffer.from(JSON.stringify(value)).toString('base64') } }],
  };
  if (!existing) {
    const created = await scope.medplum.createResourceIfNoneExist(resource,
      new URLSearchParams({ identifier: `${KEY_SYSTEM}|${key(scope)}` }).toString());
    authorize(scope, created);
    // A competing first writer must not be silently replaced.
    if (created.content[0]?.attachment.data !== resource.content[0].attachment.data) {
      throw new ConflictError('Draft changed in another window. Reload before editing.');
    }
    return created;
  }
  authorize(scope, existing);
  return scope.medplum.updateResource({ ...resource, id: existing.id, meta: existing.meta }, {
    headers: { 'If-Match': `W/"${existing.meta?.versionId}"` },
  });
}
export async function clearDraft(scope: DraftScope, version?: string) {
  const doc = await readDraft(scope);
  if (!doc || doc.status !== 'current') return;
  if (version && version !== doc.meta?.versionId) throw new ConflictError('Draft changed in another window.');
  return scope.medplum.updateResource({
    ...doc, status: 'superseded', content: [{ attachment: { contentType: 'application/json', data: 'e30=' } }],
  }, { headers: { 'If-Match': `W/"${doc.meta?.versionId}"` } });
}
