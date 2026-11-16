import { describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

// Run separately: route module mocks intentionally have process-wide scope.
// Every record and credential here is synthetic. No environment file is loaded.
const writes: any[] = [];
const queries: any[] = [];
let clinicId: string | undefined = 'clinic-a';
let authenticated = true;
let patientId = 'p-a';
let docs: any[] = [];
const store: Record<string, any> = {
  'Patient/p-a': { resourceType: 'Patient', id: 'p-a', identifier: [{ system: 'clinic', value: 'clinic-a' }] },
  'Patient/p-b': { resourceType: 'Patient', id: 'p-b', identifier: [{ system: 'clinic', value: 'clinic-b' }] },
  'Encounter/enc-a': { resourceType: 'Encounter', id: 'enc-a', subject: { reference: 'Patient/p-a' }, identifier: [{ system: 'clinic', value: 'clinic-a' }] },
};
const client: any = {
  getProfile: () => ({ id: 'fake-doctor' }),
  readResource: async (type: string, id: string) => {
    if (type === 'Organization') {
      if (id === 'unknown') throw new Error('not found');
      return { resourceType: type, id };
    }
    return store[`${type}/${id}`];
  },
  searchOne: async (type: string) => type === 'HealthcareService' ? { id: 'account-a' } : undefined,
  searchResources: async (type: string, query: any) => { queries.push({ type, query }); return []; },
  createResource: async (resource: any) => {
    const saved = { ...resource, id: `fake-${writes.length + 1}` };
    writes.push(saved); store[`${saved.resourceType}/${saved.id}`] = saved; return saved;
  },
};
mock.module('@/lib/server/medplum-admin', () => ({ getAdminMedplum: async () => client }));
mock.module('@/lib/server/medplum-auth', () => ({
  getAdminMedplum: async () => client,
  requireClinicAuth: async () => { if (!authenticated) throw new Error('unauthorized'); return { medplum: client, clinicId }; },
}));
mock.module('@/lib/fhir/consultation-service', () => ({ getConsultationFromMedplum: async () => ({ id: 'enc-a', patientId, diagnosis: 'Fake diagnosis', prescriptions: [], procedures: [], date: new Date('2030-01-01') }) }));
mock.module('@/lib/fhir/patient-service', () => ({ getPatientFromMedplum: async () => ({ fullName: 'Fake' }) }));
mock.module('@/lib/server/logging', () => ({ writeServerAuditLog: async () => {} }));
mock.module('@/lib/firebase-admin', () => ({ adminDb: {
  collection: () => ({ where: (...args: any[]) => {
    queries.push({ firebase: args });
    return { get: async () => ({ forEach: (cb: any) => docs.forEach(data => cb({ id: 'fake-source', data: () => data })) }) };
  } }),
} }));
const { POST: graphExport } = await import('../../app/(routes)/api/fhir/export/route');
const { POST: bulkExport } = await import('../../app/api/export-to-medplum/route');
const request = (body: any, token = 'fake-review-secret') => new NextRequest('http://localhost/api/fake', {
  method: 'POST', headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body),
});
const reset = () => { writes.length = 0; queries.length = 0; docs = []; clinicId = 'clinic-a'; patientId = 'p-a'; authenticated = true; };

describe('Task 351 export route boundary', () => {
  it('graph route rejects absent auth/context and mismatched visit before writes', async () => {
    reset(); authenticated = false;
    expect((await graphExport(request({ consultationId: 'enc-a' }))).status).toBe(401);
    authenticated = true; clinicId = undefined;
    expect((await graphExport(request({ consultationId: 'enc-a' }))).status).toBe(400);
    clinicId = 'clinic-a'; patientId = 'p-b';
    expect((await graphExport(request({ consultationId: 'enc-a' }))).status).toBe(404);
    expect(writes).toHaveLength(0);
  });
  it('graph route reuses Patient and writes tagged graph through acting client', async () => {
    reset();
    expect((await graphExport(request({ consultationId: 'enc-a' }))).status).toBe(200);
    expect(writes.map(r => r.resourceType)).toEqual(['Encounter', 'Condition']);
    expect(writes.every(r => r.subject.reference === 'Patient/p-a')).toBe(true);
    expect(writes.every(r => r.identifier.some((i: any) => i.system === 'clinic' && i.value === 'clinic-a'))).toBe(true);
  });
  it('bulk route fails closed and scopes Firebase and Medplum reads', async () => {
    reset();
    const previous = process.env.MEDPLUM_BULK_EXPORT_SECRET;
    try {
      process.env.MEDPLUM_BULK_EXPORT_SECRET = 'fake-review-secret';
      expect((await bulkExport(request({ action: 'export_all', clinicId: 'clinic-a' }, 'wrong'))).status).toBe(401);
      expect((await bulkExport(request({ action: 'export_all' }))).status).toBe(400);
      expect((await bulkExport(request({ action: 'export_all', clinicId: 'unknown' }))).status).toBe(404);
      expect(writes).toHaveLength(0); expect(queries).toHaveLength(0);
      docs = [{ patientName: 'Fake Person', patientIc: '000000-00-0000', consultationDate: '2030-01-01', diagnosis: 'Fake' }];
      expect((await bulkExport(request({ action: 'export_all', clinicId: 'clinic-a' }))).status).toBe(200);
      expect(queries[0]).toEqual({ firebase: ['clinicId', '==', 'clinic-a'] });
      expect(queries[1]).toEqual({ type: 'Patient', query: { identifier: '000000-00-0000', _compartment: 'HealthcareService/account-a' } });
      expect(writes.map(r => r.resourceType)).toEqual(['Patient', 'Encounter', 'Condition']);
      expect(writes.every(r => r.meta.accounts[0].reference === 'HealthcareService/account-a')).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.MEDPLUM_BULK_EXPORT_SECRET;
      else process.env.MEDPLUM_BULK_EXPORT_SECRET = previous;
    }
  });
});
