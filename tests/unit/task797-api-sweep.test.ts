import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { OperationOutcomeError, notFound, type MedplumClient } from '@medplum/core';
import { ForbiddenError } from '@/lib/server/route-helpers';
import { STORAGE_PATH_EXTENSION_URL } from '../../lib/fhir/structure-definitions';
import { isPatientDocumentStoragePath } from '../../lib/fhir/document-storage-path';

// Task 797 API sweep regressions. Fake data only; auth, Storage and AI helpers are mocked.
const clinicId = 'fake-clinic-a';
const own = [{ system: 'clinic', value: clinicId }];
const events: string[] = [];
let store: Record<string, any> = {};
let denyClinic = false;
let documentSearchFails = false;
const storageBucket = mock(() => { throw new Error('fake missing bucket'); });

const fakeMedplum = {
  async readResource(type: string, id: string) {
    if (type === 'Organization' && id === 'org-a') return { resourceType: type, id };
    const resource = store[`${type}/${id}`];
    if (!resource) throw new OperationOutcomeError(notFound);
    return structuredClone(resource);
  },
  async searchOne(type: string, params: Record<string, string>) {
    if (type === 'Organization' && params.identifier === `clinic|${clinicId}`) return { resourceType: type, id: 'org-a', identifier: own };
    if (type === 'HealthcareService') return { resourceType: type, id: 'fake-account-a' };
    throw new Error('Unexpected directory query');
  },
  async searchResources(type: string, params: Record<string, string>) {
    if (['AllergyIntolerance', 'Condition', 'MedicationStatement', 'Encounter'].includes(type)) return [];
    if (type !== 'DocumentReference') throw new ForbiddenError('Staff cannot read the admin directory');
    expect(params).toEqual({ subject: 'Patient/p-a', identifier: `clinic|${clinicId}`, _sort: '-date' });
    if (documentSearchFails) throw new Error('fake internal response');
    return ['DocumentReference/doc-own', 'DocumentReference/doc-foreign', 'DocumentReference/doc-other-patient', 'DocumentReference/doc-planted']
      .flatMap((key) => store[key] ? [structuredClone(store[key])] : []);
  },
  async *searchResourcePages(type: string, params: Record<string, string>) {
    if (type === 'PractitionerRole') {
      expect(params.organization).toBe('Organization/org-a');
      const role = (org: string, practitioner: string, active = true) => ({
        organization: { reference: `Organization/${org}` },
        practitioner: { reference: `Practitioner/${practitioner}` },
        active,
      });
      yield [role('org-a', 'pr-1'), role('org-b', 'pr-foreign'), role('org-a', 'pr-disabled-role', false)];
      yield [role('org-a', 'pr-1'), role('org-a', 'pr-2'), role('org-a', 'pr-disabled')];
      return;
    }
    if (type !== 'Practitioner') throw new ForbiddenError('Staff cannot read the admin directory');
    expect(params._id).toBe('pr-1,pr-2,pr-disabled');
    yield [
      { id: 'pr-1', name: [{ text: 'Dr Fake' }], telecom: [{ system: 'email', value: 'fake@ucc.invalid' }] },
      { id: 'pr-foreign', name: [{ text: 'Other clinic practitioner' }] },
    ];
    yield [
      { id: 'pr-2', name: [{ given: ['Another'], family: 'Fake' }] },
      { id: 'pr-disabled', active: false },
    ];
  },
  async createResource(resource: any) { events.push(`write:create:${resource.resourceType}`); return { ...resource, id: 'new-doc' }; },
  async updateResource(resource: any) { events.push(`write:update:${resource.resourceType}/${resource.id}`); return resource; },
  async deleteResource(type: string, id: string) { events.push(`write:delete:${type}/${id}`); },
} as unknown as MedplumClient;

const realAuth = await import('@/lib/server/medplum-auth');
const realFirebase = await import('@/lib/firebase-admin');
const realReferral = await import('@/lib/workflows/referral-letter');
mock.module('@/lib/server/medplum-auth', () => ({
  ...realAuth,
  requireClinicAuth: async () => {
    if (denyClinic) throw new ForbiddenError('Other fake clinic');
    return { medplum: fakeMedplum, clinicId };
  },
  getMedplumForRequest: async () => fakeMedplum,
  getCurrentProfile: async () => ({ resourceType: 'Practitioner', id: 'fake-practitioner' }),
}));
mock.module('@/lib/firebase-admin', () => ({
  ...realFirebase,
  getAdminStorageBucket: storageBucket,
}));
mock.module('@/lib/workflows/referral-letter', () => ({
  ...realReferral,
  generateReferralLetter: async () => { throw new Error('upstream https://provider.invalid/v1 key sk-fake-123 rejected'); },
}));
afterAll(() => {
  mock.module('@/lib/server/medplum-auth', () => realAuth);
  mock.module('@/lib/firebase-admin', () => realFirebase);
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
  denyClinic = false;
  documentSearchFails = false;
  storageBucket.mockClear();
  store = {
    'Patient/p-a': { resourceType: 'Patient', id: 'p-a', identifier: own },
    'Patient/p-b': { resourceType: 'Patient', id: 'p-b', identifier: [{ system: 'clinic', value: 'fake-clinic-b' }] },
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

  test('multipart POST with an unavailable bucket returns 503 without writing metadata', async () => {
    const form = new FormData();
    form.set('patientId', 'p-a');
    form.append('files', new File(['fake PDF'], 'fake.pdf', { type: 'application/pdf' }));
    const res = await documents.POST(new NextRequest('http://localhost/api/documents', { method: 'POST', body: form }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'File uploads are temporarily unavailable.' });
    expect(storageBucket).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([]);
  });

  test('DELETE of a record that already carries a foreign path removes the record but never the Storage object', async () => {
    const res = await documents.DELETE(req('DELETE', { id: 'doc-planted' }));
    expect(res.status).toBe(200);
    expect(writes()).toEqual(['write:delete:DocumentReference/doc-planted']);
  });
});

describe('/api/documents GET', () => {
  const list = (patientId = 'p-a') => documents.GET(req('GET', undefined, `http://localhost/api/documents?patientId=${patientId}`));

  test('the route loads even when Firebase Admin would throw during initialization', () => {
    const child = Bun.spawnSync([
      process.execPath, '--no-env-file', '-e',
      'await import("./app/api/documents/route")',
    ], {
      cwd: new URL('../..', import.meta.url).pathname,
      env: {
        PATH: process.env.PATH,
        FIREBASE_PROJECT_ID: 'fake-project',
        FIREBASE_CLIENT_EMAIL: 'fake@ucc.invalid',
        FIREBASE_PRIVATE_KEY: 'fake malformed key',
      },
    });
    expect(child.exitCode).toBe(0);
  });

  test('returns only the requested patient’s clinic documents when Firebase Storage is unavailable', async () => {
    const doc = (id: string, patientId: string, clinic: string) => ({
      resourceType: 'DocumentReference', id, identifier: [{ system: 'clinic', value: clinic }],
      subject: { reference: `Patient/${patientId}` },
      content: [{ attachment: { title: id, url: `https://example.invalid/${id}.pdf` } }],
    });
    store['DocumentReference/doc-own'] = doc('doc-own', 'p-a', clinicId);
    store['DocumentReference/doc-foreign'] = doc('doc-foreign', 'p-a', 'fake-clinic-b');
    store['DocumentReference/doc-other-patient'] = doc('doc-other-patient', 'p-b', clinicId);

    const res = await list();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true, documents: [{ id: 'doc-own', title: 'doc-own', url: 'https://example.invalid/doc-own.pdf' }],
    });
    expect(storageBucket).not.toHaveBeenCalled();
  });

  test('returns an empty list for no uploads and 404 for another clinic’s patient', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, documents: [] });
    expect((await list('p-b')).status).toBe(404);
    expect((await list('p-a,Patient/p-b')).status).toBe(404);
    expect(storageBucket).not.toHaveBeenCalled();
  });

  test('metadata search failure returns a retryable error without upstream details', async () => {
    documentSearchFails = true;
    const res = await list();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Uploaded files are temporarily unavailable. Please try again.' });
  });
});

describe('/api/practitioners', () => {
  const list = () => practitioners.GET(req('GET', undefined, 'http://localhost/api/practitioners'));

  test('clinic staff can list active practitioners from their own clinic by id and name', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, practitioners: [
      { id: 'pr-1', name: 'Dr Fake' }, { id: 'pr-2', name: 'Another Fake' },
    ] });
  });

  test('staff cannot list practitioners for an unassigned clinic', async () => {
    denyClinic = true;
    expect((await list()).status).toBe(403);
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
