import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { OperationOutcomeError, notFound, type MedplumClient } from '@medplum/core';
import { STORAGE_PATH_EXTENSION_URL } from '../../lib/fhir/structure-definitions';

// Task 482: route-level checks. Fake data only; real services run against a fake Medplum, only
// auth and Firebase Storage are mocked (all real exports kept so other test files are unaffected).
const clinicId = 'fake-clinic-a';
const own = [{ system: 'clinic', value: clinicId }];
const foreign = [{ system: 'clinic', value: 'fake-clinic-b' }];
const events: string[] = [];
let store: Record<string, any> = {};

const fakeMedplum = {
  async readResource(type: string, id: string) {
    events.push(`read:${type}/${id}`);
    if (type === 'Organization') return { resourceType: type, id };
    const resource = store[`${type}/${id}`];
    if (!resource) throw new OperationOutcomeError(notFound);
    return structuredClone(resource);
  },
  async searchOne(type: string) { return type === 'HealthcareService' ? { resourceType: type, id: 'fake-account-a' } : undefined; },
  async searchResources() { return []; },
  async updateResource(resource: any) { events.push(`write:update:${resource.resourceType}/${resource.id}`); return resource; },
  async deleteResource(type: string, id: string) { events.push(`write:delete:${type}/${id}`); },
} as unknown as MedplumClient;

const realAuth = await import('@/lib/server/medplum-auth');
const realFirebase = await import('@/lib/firebase-admin');
mock.module('@/lib/server/medplum-auth', () => ({
  ...realAuth,
  requireClinicAuth: async () => ({ medplum: fakeMedplum, clinicId }),
  getCurrentProfile: async () => ({ resourceType: 'Practitioner', id: 'fake-practitioner' }),
}));
mock.module('@/lib/firebase-admin', () => ({
  ...realFirebase,
  getAdminStorageBucket: () => ({ file: (path: string) => ({ delete: async () => { events.push(`write:storage-delete:${path}`); } }) }),
}));
afterAll(() => {
  mock.module('@/lib/server/medplum-auth', () => realAuth);
  mock.module('@/lib/firebase-admin', () => realFirebase);
});

const documents = await import('../../app/api/documents/route');
const appointments = await import('../../app/api/appointments/route');
const labOrders = await import('../../app/(routes)/api/labs/order/route');

const req = (method: string, body: unknown) =>
  new NextRequest('http://localhost/api/fake', { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const writes = () => events.filter(e => e.startsWith('write:'));

beforeEach(() => {
  events.length = 0;
  store = {
    'Patient/p-a': { resourceType: 'Patient', id: 'p-a', identifier: own },
    'Patient/p-b': { resourceType: 'Patient', id: 'p-b', identifier: foreign },
    'DocumentReference/doc-a': {
      resourceType: 'DocumentReference', id: 'doc-a', identifier: own, subject: { reference: 'Patient/p-a' },
      extension: [{ url: STORAGE_PATH_EXTENSION_URL, valueString: 'patients/p-a/documents/fake.pdf' }],
      content: [{ attachment: { title: 'Fake', url: 'https://example.invalid/fake.pdf' } }],
    },
    'DocumentReference/doc-b': {
      resourceType: 'DocumentReference', id: 'doc-b', identifier: foreign, subject: { reference: 'Patient/p-b' },
      extension: [{ url: STORAGE_PATH_EXTENSION_URL, valueString: 'patients/p-b/documents/fake.pdf' }],
      content: [{ attachment: { title: 'Fake', url: 'https://example.invalid/fake.pdf' } }],
    },
    // Patient is the caller's own but the document itself is tagged for another clinic.
    'DocumentReference/doc-mistagged': {
      resourceType: 'DocumentReference', id: 'doc-mistagged', identifier: foreign, subject: { reference: 'Patient/p-a' },
      extension: [{ url: STORAGE_PATH_EXTENSION_URL, valueString: 'patients/p-a/documents/mistagged.pdf' }],
    },
    'DocumentReference/doc-nopatient': { resourceType: 'DocumentReference', id: 'doc-nopatient', identifier: own },
    'Appointment/appt-b': { resourceType: 'Appointment', id: 'appt-b', status: 'booked', identifier: foreign, participant: [{ actor: { reference: 'Patient/p-b' }, status: 'accepted' }] },
    'ServiceRequest/sr-b': { resourceType: 'ServiceRequest', id: 'sr-b', status: 'active', identifier: foreign, subject: { reference: 'Patient/p-b' } },
  };
});

describe('DELETE /api/documents ordering (Task 482)', () => {
  test('own document: patient authorization read happens before storage delete, then FHIR delete', async () => {
    const response = await documents.DELETE(req('DELETE', { id: 'doc-a' }));
    expect(response.status).toBe(200);
    const firstWrite = events.findIndex(e => e.startsWith('write:'));
    expect(events.indexOf('read:Patient/p-a')).toBeGreaterThan(-1);
    expect(events.indexOf('read:Patient/p-a')).toBeLessThan(firstWrite);
    expect(writes()).toEqual([
      'write:storage-delete:patients/p-a/documents/fake.pdf',
      'write:delete:DocumentReference/doc-a',
    ]);
  });

  test('foreign document: 404 and neither the storage object nor the FHIR resource is deleted', async () => {
    const response = await documents.DELETE(req('DELETE', { id: 'doc-b' }));
    expect(response.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  test('document tagged for another clinic on an own patient: 404 and no storage or FHIR delete', async () => {
    const response = await documents.DELETE(req('DELETE', { id: 'doc-mistagged' }));
    expect(response.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  test('missing document: 404 and zero writes', async () => {
    const response = await documents.DELETE(req('DELETE', { id: 'doc-zzz' }));
    expect(response.status).toBe(404);
    expect(writes()).toEqual([]);
  });

  test('document without patient reference: 400 and zero writes', async () => {
    const response = await documents.DELETE(req('DELETE', { id: 'doc-nopatient' }));
    expect(response.status).toBe(400);
    expect(writes()).toEqual([]);
  });

  test('missing id: 400 and zero reads or writes', async () => {
    const response = await documents.DELETE(req('DELETE', {}));
    expect(response.status).toBe(400);
    expect(events).toEqual([]);
  });
});

describe('route-level 404 mapping for id-addressed foreign resources (Task 482 / Task 422 rule)', () => {
  test('PATCH /api/documents foreign and missing => 404, zero writes', async () => {
    expect((await documents.PATCH(req('PATCH', { id: 'doc-b', title: 'x' }))).status).toBe(404);
    expect((await documents.PATCH(req('PATCH', { id: 'doc-zzz', title: 'x' }))).status).toBe(404);
    expect(writes()).toEqual([]);
  });

  test('PATCH /api/appointments foreign status and reschedule => 404, zero writes', async () => {
    expect((await appointments.PATCH(req('PATCH', { appointmentId: 'appt-b', status: 'arrived' }))).status).toBe(404);
    expect((await appointments.PATCH(req('PATCH', { appointmentId: 'appt-b', scheduledAt: '2030-01-01T10:00:00.000Z' }))).status).toBe(404);
    expect(writes()).toEqual([]);
  });

  test('DELETE /api/appointments foreign and missing => 404, zero writes', async () => {
    expect((await appointments.DELETE(req('DELETE', { appointmentId: 'appt-b' }))).status).toBe(404);
    expect((await appointments.DELETE(req('DELETE', { appointmentId: 'appt-zzz' }))).status).toBe(404);
    expect(writes()).toEqual([]);
  });

  test('PATCH/DELETE /api/labs/order foreign and missing => 404, zero writes', async () => {
    expect((await labOrders.PATCH(req('PATCH', { serviceRequestId: 'sr-b', priority: 'urgent' }))).status).toBe(404);
    expect((await labOrders.DELETE(req('DELETE', { serviceRequestId: 'sr-b' }))).status).toBe(404);
    expect((await labOrders.DELETE(req('DELETE', { serviceRequestId: 'sr-zzz' }))).status).toBe(404);
    expect(writes()).toEqual([]);
  });
});
