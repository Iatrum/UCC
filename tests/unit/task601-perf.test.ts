import { afterAll, describe, expect, mock, test } from 'bun:test';

// Capture the real module first so the mock can be undone (bun mock.module is process-global).
const realTenancy = { ...(await import('../../lib/fhir/clinic-tenancy')) };
mock.module('../../lib/fhir/clinic-tenancy', () => ({ ...realTenancy, assertOrderClinic: async () => {} }));
const { draftScope } = await import('../../lib/fhir/consultation-draft');
const { loadMe } = await import('../../lib/server/medplum-auth');
const { loadComposerCatalogs, shouldLoadComposerCatalogs, emptyComposerCatalogs } = await import('../../lib/orders/composer-catalogs');
const { buildSignedDocumentNote } = await import('../../lib/orders/signed-document-note');
afterAll(() => { mock.module('../../lib/fhir/clinic-tenancy', () => realTenancy); });

function meClient(token: string, profile: any) {
  const gets: string[] = [];
  const medplum: any = {
    getAccessToken: () => token,
    get: async (path: string) => { gets.push(path); return { profile, membership: {} }; },
    getProfileAsync: async () => { throw new Error('getProfileAsync must not issue a second /auth/me'); },
  };
  return { medplum, gets };
}

describe('draftScope reuses the memoised /auth/me (Task 601)', () => {
  test('one /auth/me for requireClinicAuth + draftScope on the same token', async () => {
    const { medplum, gets } = meClient('fake-token-601-a', { resourceType: 'Practitioner', id: 'doc-1' });
    await loadMe(medplum); // what requireClinicAuth's profileFor does first
    const scope = await draftScope(medplum, 'fake-clinic', 'fake-patient', 'consult-note');
    expect(scope.practitioner).toBe('Practitioner/doc-1');
    expect(gets).toEqual(['auth/me']);
  });
  test('non-practitioner profiles are still rejected', async () => {
    const { medplum } = meClient('fake-token-601-b', { resourceType: 'ClientApplication', id: 'app-1' });
    await expect(draftScope(medplum, 'fake-clinic', 'fake-patient', 'consult-note')).rejects.toThrow('Practitioner required');
  });
});

describe('composer catalogs load only for the treatment drawer (Task 601)', () => {
  test('gate: only an open treatment drawer, only once', () => {
    expect(shouldLoadComposerCatalogs('consult', true, false)).toBe(false);
    expect(shouldLoadComposerCatalogs('treatment', false, false)).toBe(false);
    expect(shouldLoadComposerCatalogs('treatment', true, false)).toBe(true);
    expect(shouldLoadComposerCatalogs('treatment', true, true)).toBe(false);
  });
  test('loader maps procedures/medications and keeps only active catalog items', async () => {
    const calls: string[] = [];
    const item = (id: string, active: boolean) => ({ id, type: 'lab', name: id, active }) as any;
    const out = await loadComposerCatalogs({
      getProcedures: async () => { calls.push('procedures'); return [{ id: 'p1', name: 'Dressing', defaultPrice: 12, codingCode: 'X' }]; },
      getMedications: async () => { calls.push('meds'); return [{ id: 'm1', name: 'Paracetamol' }]; },
      getClinicalCatalog: async (type) => { calls.push(type); return [item(`${type}-on`, true), item(`${type}-off`, false)]; },
    });
    expect(calls.sort()).toEqual(['document', 'imaging', 'lab', 'meds', 'procedures']);
    expect(out.procedures).toEqual([{ id: 'p1', label: 'Dressing', price: 12, codingSystem: undefined, codingCode: 'X', codingDisplay: undefined }]);
    expect(out.medications).toEqual([{ id: 'm1', name: 'Paracetamol', unitPrice: 0 }]);
    expect(out.labs.map((i) => i.id)).toEqual(['lab-on']);
    expect(out.imaging.map((i) => i.id)).toEqual(['imaging-on']);
    expect(out.documents.map((i) => i.id)).toEqual(['document-on']);
    expect(emptyComposerCatalogs.labs).toEqual([]);
  });
});

describe('signed document note (moved out of the composer bundle)', () => {
  test('documents serialise their kind; other entries keep the instruction', () => {
    const mc: any = { id: 'e1', catalogRef: 'letter-mc', name: 'MC', instruction: 'rest', meta: { mcDays: '2' } };
    expect(JSON.parse(buildSignedDocumentNote(mc)!)).toMatchObject({ kind: 'mc', mcDays: '2', status: 'completed', instruction: 'rest' });
    expect(buildSignedDocumentNote({ id: 'e2', catalogRef: 'svc-1', name: 'Dressing', instruction: 'daily' } as any)).toBe('daily');
  });
});
