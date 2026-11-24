import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { OperationOutcomeError, notFound, type MedplumClient } from '@medplum/core';
import { STORAGE_PATH_EXTENSION_URL } from '../../lib/fhir/structure-definitions';
import { isPatientDocumentStoragePath } from '../../lib/fhir/document-storage-path';

// Task 797 API sweep regressions. Fake data only; auth, Storage and AI helpers are mocked.
const clinicId = 'fake-clinic-a';
const own = [{ system: 'clinic', value: clinicId }];
const events: string[] = [];
let store: Record<string, any> = {};

const fakeMedplum = {
  async readResource(type: string, id: string) {
    if (type === 'Organization') return { resourceType: type, id };
    const resource = store[`${type}/${id}`];
    if (!resource) throw new OperationOutcomeError(notFound);
    return structuredClone(resource);
  },
  async searchOne(type: string) { return type === 'HealthcareService' ? { resourceType: type, id: 'fake-account-a' } : undefined; },
  async searchResources() { return []; },
  async createResource(resource: any) { events.push(`write:create:${resource.resourceType}`); return { ...resource, id: 'new-doc' }; },
  async updateResource(resource: any) { events.push(`write:update:${resource.resourceType}/${resource.id}`); return resource; },
  async deleteResource(type: string, id: string) { events.push(`write:delete:${type}/${id}`); },
} as unknown as MedplumClient;

const realAuth = await import('@/lib/server/medplum-auth');
const realFirebase = await import('@/lib/firebase-admin');
const realAdmin = await import('@/lib/fhir/admin-service');
const realReferral = await import('@/lib/workflows/referral-letter');
mock.module('@/lib/server/medplum-auth', () => ({
  ...realAuth,
  requireClinicAuth: async () => ({ medplum: fakeMedplum, clinicId }),
  getMedplumForRequest: async () => fakeMedplum,
  getCurrentProfile: async () => ({ resourceType: 'Practitioner', id: 'fake-practitioner' }),
}));
mock.module('@/lib/firebase-admin', () => ({
  ...realFirebase,
  getAdminStorageBucket: () => ({ file: (path: string) => ({ delete: async () => { events.push(`write:storage-delete:${path}`); } }) }),
}));
mock.module('@/lib/fhir/admin-service', () => ({
  ...realAdmin,
  getPractitionersFromMedplum: async () => [
    { id: 'pr-1', name: 'Dr Fake', email: 'fake@ucc.invalid', organizations: [{ id: 'o-b', name: 'Other clinic' }], active: true },
  ],
}));
mock.module('@/lib/workflows/referral-letter', () => ({
  ...realReferral,
  generateReferralLetter: async () => { throw new Error('upstream https://provider.invalid/v1 key sk-fake-123 rejected'); },
}));
afterAll(() => {
  mock.module('@/lib/server/medplum-auth', () => realAuth);
  mock.module('@/lib/firebase-admin', () => realFirebase);
  mock.module('@/lib/fhir/admin-service', () => realAdmin);
  mock.module('@/lib/workflows/referral-letter', () => realReferral);
});

const documents = await import('../../app/api/documents/route');
const practitioners = await import('../../app/api/practitioners/route');
const referralLetter = await import('../../app/(routes)/api/referral-letter/route');

const req = (method: string, body: unknown, url = 'http://localhost/api/fake') =>
  new NextRequest(url, { method, body: method === 'GET' ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const writes = () => events.filter((e) => e.startsWith('write:'));

beforeEach(() => {
  events.length = 0;
  store = {
    'Patient/p-a': { resourceType: 'Patient', id: 'p-a', identifier: own },
    'DocumentReference/doc-planted': {
      resourceType: 'DocumentReference', id: 'doc-planted', identifier: own, subject: { reference: 'Patient/p-a' },
      extension: [{ url: STORAGE_PATH_EXTENSION_URL, valueString: 'patients/p-OTHER-CLINIC/documents/secret.pdf' }],
      content: [{ attachment: { title: 'Planted', url: 'https://example.invalid/x.pdf' } }],
    },
  };
});

describe('isPatientDocumentStoragePath', () => {
  test('accepts only a file in the patient own documents folder', () => {
    expect(isPatientDocumentStoragePath('p-a', 'patients/p-a/documents/1-uuid-file.pdf')).toBe(true);
    expect(isPatientDocumentStoragePath('p-a', 'patients/p-b/documents/file.pdf')).toBe(false);
    expect(isPatientDocumentStoragePath('p-a', 'branding/logo-1.png')).toBe(false);
    expect(isPatientDocumentStoragePath('p-a', 'patients/p-a/documents/../../p-b/documents/x.pdf')).toBe(false);
    expect(isPatientDocumentStoragePath('p-a', 'patients/p-a/documents/sub/x.pdf')).toBe(false);
    expect(isPatientDocumentStoragePath('p-a', 'patients/p-a/documents/..')).toBe(false);
    expect(isPatientDocumentStoragePath('p-a', 42)).toBe(false);
  });
});

describe('/api/documents storagePath (Task 797)', () => {
  test('JSON POST naming another patient/clinic file is refused with 400 and nothing is written', async () => {
    const res = await documents.POST(req('POST', {
      patientId: 'p-a', title: 'x', url: 'https://example.invalid/x.pdf', contentType: 'application/pdf',
      storagePath: 'patients/p-OTHER-CLINIC/documents/secret.pdf',
    }));
    expect(res.status).toBe(400);
    expect(writes()).toEqual([]);
  });

  test('JSON POST with the patient own folder path still works', async () => {
    const res = await documents.POST(req('POST', {
      patientId: 'p-a', title: 'x', url: 'https://example.invalid/x.pdf', contentType: 'application/pdf',
      storagePath: 'patients/p-a/documents/1-uuid-x.pdf',
    }));
    expect(res.status).toBe(200);
  });

  test('DELETE of a record that already carries a foreign path removes the record but never the Storage object', async () => {
    const res = await documents.DELETE(req('DELETE', { id: 'doc-planted' }));
    expect(res.status).toBe(200);
    expect(writes()).toEqual(['write:delete:DocumentReference/doc-planted']);
  });
});

describe('/api/practitioners (Task 797)', () => {
  test('returns only id and name, no e-mail or other-clinic memberships', async () => {
    const res = await practitioners.GET(req('GET', undefined, 'http://localhost/api/practitioners'));
    const body = await res.json();
    expect(body.practitioners).toEqual([{ id: 'pr-1', name: 'Dr Fake' }]);
  });
});

describe('/api/referral-letter error handling (Task 797)', () => {
  test('provider error text is not echoed to the client', async () => {
    const res = await referralLetter.POST(req('POST', { text: 'fake summary' }));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('provider.invalid');
    expect(text).not.toContain('sk-fake');
  });
});
