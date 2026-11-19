import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { OperationOutcomeError, notFound, type MedplumClient } from '@medplum/core';

// Task 696: GET /api/documents and GET /api/referrals (?patientId) only need the clinic-checked patient to
// exist; they must not run the 4 medical-history searches. Real services, fake Medplum, fake data.
const clinicId = 'fake-clinic-a';
const store: Record<string, any> = {
  'Patient/p-own': { resourceType: 'Patient', id: 'p-own', identifier: [{ system: 'clinic', value: clinicId }], name: [{ text: 'Fake Own' }] },
  'Patient/p-foreign': { resourceType: 'Patient', id: 'p-foreign', identifier: [{ system: 'clinic', value: 'fake-clinic-b' }], name: [{ text: 'Fake Foreign' }] },
};
const searches: string[] = [];
const fakeMedplum = {
  async readResource(type: string, id: string) {
    if (type === 'Organization') return { resourceType: type, id };
    const r = store[`${type}/${id}`];
    if (!r) throw new OperationOutcomeError(notFound);
    return structuredClone(r);
  },
  async searchOne(type: string) { return type === 'HealthcareService' ? { resourceType: type, id: 'fake-account-a' } : undefined; },
  async searchResources(type: string) { searches.push(type); return []; },
} as unknown as MedplumClient;

const realAuth = await import('@/lib/server/medplum-auth');
mock.module('@/lib/server/medplum-auth', () => ({ ...realAuth, requireClinicAuth: async () => ({ medplum: fakeMedplum, clinicId }) }));
afterAll(() => { mock.module('@/lib/server/medplum-auth', () => realAuth); });

const documents = await import('../../app/api/documents/route');
const referrals = await import('../../app/api/referrals/route');
const HISTORY = ['AllergyIntolerance', 'Condition', 'MedicationStatement', 'Encounter'];
const get = (path: string, id: string) => new NextRequest(`http://localhost${path}?patientId=${id}`);

beforeEach(() => { searches.length = 0; });

describe('list GETs skip medical-history searches (Task 696)', () => {
  test('documents GET returns 200 for own patient without history searches', async () => {
    const res = await documents.GET(get('/api/documents', 'p-own'));
    expect(res.status).toBe(200);
    for (const t of HISTORY) expect(searches).not.toContain(t);
  });
  test('referrals GET returns 200 for own patient without history searches', async () => {
    const res = await referrals.GET(get('/api/referrals', 'p-own'));
    expect(res.status).toBe(200);
    for (const t of HISTORY) expect(searches).not.toContain(t);
  });
  test('clinic isolation unchanged: other clinic patient is 404 and nothing is listed', async () => {
    expect((await documents.GET(get('/api/documents', 'p-foreign'))).status).toBe(404);
    expect((await referrals.GET(get('/api/referrals', 'p-foreign'))).status).toBe(404);
    expect(searches).toEqual([]);
  });
});
