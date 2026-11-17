import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { imagingOrderEntryMode, resolveImagingOrderEntryMode } from '../../lib/imaging/order-entry';

// Fake data only. Task 517: behaviour tests (no source-string matching).
test('X-ray module on: only the Treatment panel orders (accession); off: generic form stays', () => {
  expect(imagingOrderEntryMode(true)).toBe('treatment-panel-only');
  expect(imagingOrderEntryMode(false)).toBe('generic-form');
});

test('labs-imaging mode resolution fails closed when the module lookup errors', async () => {
  expect(await resolveImagingOrderEntryMode(async () => true)).toBe('treatment-panel-only');
  expect(await resolveImagingOrderEntryMode(async () => false)).toBe('generic-form');
  expect(await resolveImagingOrderEntryMode(async () => { throw new Error('medplum down'); })).toBe('treatment-panel-only');
  expect(await resolveImagingOrderEntryMode(() => { throw new Error('sync throw'); })).toBe('treatment-panel-only');
});

let pacsEnabled = true;
let lookupFails = false;
let intercept = true; // outside this file the mock delegates to the real service (bun mocks can leak)
const createCalls: any[] = [];
// Fake only the Medplum admin client so the REAL module-registry lookups can be exercised (Task 518).
const admin = await import('@/lib/server/medplum-admin');
let medplumMode: 'fail' | 'pacs-on' | 'no-org' = 'fail';
mock.module('@/lib/server/medplum-admin', () => ({
  ...admin,
  getAdminMedplum: async () => {
    if (!intercept) return (admin as any).getAdminMedplum();
    return {
      searchResources: async () => {
        if (medplumMode === 'fail') throw new Error('medplum down');
        if (medplumMode === 'no-org') return [];
        return [{ resourceType: 'Organization', extension: [{
          url: 'https://ucc.emr/organization-enabled-module-ids', valueString: JSON.stringify(['pacs']) }] }];
      },
    };
  },
}));
const registry = await import('@/lib/module-registry');
const realLenient = registry.isModuleEnabledForClinic;
const realStrict = registry.isModuleEnabledForClinicStrict;
const auth = await import('@/lib/server/medplum-auth');
const svc = await import('@/lib/fhir/imaging-service');
const realCreateImagingOrder = svc.createImagingOrder;
mock.module('@/lib/module-registry', () => ({
  ...registry,
  isModuleEnabledForClinicStrict: async () => { if (lookupFails) throw new Error('lookup failed'); return pacsEnabled; },
}));
mock.module('@/lib/server/medplum-auth', () => ({
  ...auth,
  requireClinicAuth: async () => ({ medplum: {}, clinicId: 'clinic-a' }),
  getCurrentProfile: async () => ({ resourceType: 'Practitioner', id: 'prac-1' }),
}));
mock.module('@/lib/fhir/imaging-service', () => ({
  ...svc,
  createImagingOrder: async (order: any, ...rest: any[]) => {
    if (!intercept) return (realCreateImagingOrder as any)(order, ...rest);
    createCalls.push(order); return 'sr-1';
  },
}));
const { POST } = await import('../../app/(routes)/api/imaging/order/route');

const post = (body: unknown) => POST(new NextRequest('http://localhost/api/imaging/order', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));
const base = { patientId: 'p-1', procedures: ['XR-CHEST'], clinicalIndication: 'Fake cough' };

beforeEach(() => { pacsEnabled = true; lookupFails = false; createCalls.length = 0; });
afterAll(() => {
  intercept = false;
  mock.module('@/lib/server/medplum-admin', () => admin);
  mock.module('@/lib/module-registry', () => registry);
  mock.module('@/lib/server/medplum-auth', () => auth);
  mock.module('@/lib/fhir/imaging-service', () => svc);
});

test('POST /api/imaging/order: module on + standalone order without xray/encounter is rejected (409), nothing created', async () => {
  const res = await post(base);
  expect(res.status).toBe(409);
  expect((await res.json()).error).toContain('Treatment panel');
  expect(createCalls).toHaveLength(0);
});

test('POST /api/imaging/order: module on + xray order reaches the order service (accession assigned there)', async () => {
  const xray = { code: 'x', deviceId: 'dev-1', entryId: 'e-1' };
  const res = await post({ ...base, encounterId: 'enc-1', xray });
  expect(res.status).toBe(200);
  expect(createCalls).toHaveLength(1);
  expect(createCalls[0].xray).toEqual(xray);
  expect(createCalls[0].orderedBy).toBe('Practitioner/prac-1');
});

test('POST /api/imaging/order: module on + composer generic imaging (encounter-linked) is unchanged', async () => {
  expect((await post({ ...base, encounterId: 'enc-1' })).status).toBe(200);
  expect(createCalls).toHaveLength(1);
});

test('POST /api/imaging/order: module off keeps the generic standalone order working', async () => {
  pacsEnabled = false;
  expect((await post(base)).status).toBe(200);
  expect(createCalls).toHaveLength(1);
});

test('POST /api/imaging/order: module lookup error fails closed for standalone orders', async () => {
  lookupFails = true;
  const res = await post(base);
  expect(res.status).toBeGreaterThanOrEqual(500);
  expect(createCalls).toHaveLength(0);
});

test('real lookups: lenient swallows a Medplum failure as "pacs off"; strict throws (so the guard fails closed)', async () => {
  medplumMode = 'fail';
  expect(await realLenient('pacs', 'clinic-a')).toBe(false);
  await expect(realStrict('pacs', 'clinic-a')).rejects.toThrow('medplum down');
});

test('real strict lookup: returns the saved setting; missing org = defaults (pacs off)', async () => {
  medplumMode = 'pacs-on';
  expect(await realStrict('pacs', 'clinic-a')).toBe(true);
  expect(await realStrict('poct', 'clinic-a')).toBe(false);
  medplumMode = 'no-org';
  expect(await realStrict('pacs', 'clinic-a')).toBe(false);
  expect(await realStrict('inventory', 'clinic-a')).toBe(true);
});
