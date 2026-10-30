import { test, expect } from '@playwright/test';
import { saveJson } from '../lib/app';
import { fhir } from '../lib/fhir';
import { RUN } from '../lib/env';

// API CRUD + Medplum persistence checks. Fake data only. Independent tests (failures don't cascade).
const log: Record<string, unknown> = {};
test.afterEach(() => saveJson(`api-results.json`, log));
const anonCtx = (pw: any, baseURL?: string) => pw.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });

test('auth: unauthenticated API access is rejected', async ({ playwright, baseURL }) => {
  const anon = await anonCtx(playwright, baseURL);
  expect((await anon.get('/api/patients')).status()).toBe(401);
  await anon.dispose();
});

test('patients: create / read / search / update / duplicate NRIC / archive', async ({ request }) => {
  const nric = `9001${RUN.slice(-2)}-14-${RUN.slice(-4)}`;
  let r = await request.post('/api/patients', { data: { fullName: `API Fake ${RUN}`, nric, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000' } });
  expect(r.ok()).toBeTruthy(); const { patientId } = await r.json(); log.patientId = patientId;
  const m = await fhir();
  expect(JSON.stringify((await m.readResource('Patient', patientId)).name)).toContain('API');
  r = await request.get(`/api/patients?search=${encodeURIComponent(`API Fake ${RUN}`)}`); expect(r.ok()).toBeTruthy();
  r = await request.patch('/api/patients', { data: { patientId, phone: '0111111111' } }); expect(r.ok()).toBeTruthy();
  expect(JSON.stringify((await m.readResource('Patient', patientId) as any).telecom)).toContain('0111111111');
  r = await request.post('/api/patients', { data: { fullName: 'Dup', nric, dateOfBirth: '1990-01-01', gender: 'female' } });
  log.duplicateNricStatus = r.status(); expect(r.ok(), 'duplicate NRIC must be rejected').toBeFalsy();
  r = await request.delete(`/api/patients?patientId=${patientId}`); expect(r.ok()).toBeTruthy();
  expect((await m.readResource('Patient', patientId) as any).active).toBe(false);
});

test('inventory: validation returns 4xx not 500', async ({ request }) => {
  const r = await request.post('/api/inventory', { data: { name: `Fakeprofen ${RUN}` } });
  log.inventoryMissingStrengths = r.status();
  expect(r.status(), 'POST /api/inventory without strengths crashes (.map of undefined)').toBeLessThan(500);
});

test('inventory: create / update stock / delete', async ({ request }) => {
  let r = await request.post('/api/inventory', { data: { name: `Fakeprofen ${RUN}`, category: 'Test', dosageForm: 'Tablet', strengths: ['10mg'], stock: 100, minimumStock: 10, unit: 'tab', unitPrice: 1, expiryDate: '2029-01-01' } });
  expect(r.ok()).toBeTruthy(); const { medicationId } = await r.json();
  expect((await (await fhir()).readResource('Medication', medicationId)).id).toBe(medicationId);
  expect((await request.patch('/api/inventory', { data: { medicationId, stock: 42 } })).ok()).toBeTruthy();
  const list = await (await request.get('/api/inventory')).json();
  expect(list.medications.find((x: any) => x.id === medicationId)?.stock).toBe(42);
  expect((await request.delete(`/api/inventory?id=${medicationId}`)).ok()).toBeTruthy();
});

for (const type of ['lab', 'imaging', 'document', 'diagnosis']) {
  test(`catalogs: ${type} create / update / delete`, async ({ request }) => {
    let r = await request.post('/api/catalogs', { data: { type, name: `Fake ${type} ${RUN}`, defaultPrice: 5, modality: type === 'imaging' ? 'DX' : undefined } });
    expect(r.ok()).toBeTruthy(); const { id } = await r.json();
    expect((await request.patch('/api/catalogs', { data: { id, type, defaultPrice: 7 } })).ok()).toBeTruthy();
    const got = (await (await request.get(`/api/catalogs?type=${type}`)).json()).items.find((x: any) => x.id === id);
    expect(got?.defaultPrice).toBe(7);
    expect((await request.delete(`/api/catalogs?id=${id}&type=${type}`)).ok()).toBeTruthy();
  });
}

test('procedures: create / update / delete', async ({ request }) => {
  let r = await request.post('/api/procedures', { data: { name: `Fake proc ${RUN}`, defaultPrice: 30 } });
  expect(r.ok()).toBeTruthy(); const { procedureId } = await r.json();
  const got = (await (await request.get('/api/procedures')).json()).procedures.find((x: any) => x.id === procedureId);
  log.procedurePrice = got?.defaultPrice; expect(got?.defaultPrice).toBe(30);
  expect((await request.patch('/api/procedures', { data: { procedureId, defaultPrice: 35 } })).ok()).toBeTruthy();
  expect((await request.delete(`/api/procedures?id=${procedureId}`)).ok()).toBeTruthy();
});

test('insurers CRUD (suppliers recorded if feature-flagged off)', async ({ request }) => {
  const s = await request.post('/api/suppliers', { data: { name: `Fake ${RUN}` } }); log.suppliersPost = `${s.status()} ${(await s.text()).slice(0, 120)}`;
  let r = await request.post('/api/settings/insurers', { data: { name: `Fake insurer ${RUN}`, value: `FAKEINS${RUN}` } });
  expect(r.ok()).toBeTruthy(); const j = await r.json(); const id = j.id || j.insurer?.id; expect(id).toBeTruthy();
  expect((await request.patch('/api/settings/insurers', { data: { id, name: `Fake insurer ${RUN} upd`, value: `FAKEINS${RUN}` } })).ok()).toBeTruthy();
  expect((await request.delete(`/api/settings/insurers?id=${id}`)).ok()).toBeTruthy();
});

test('security: /api/labs/receive requires auth or API key', async ({ playwright, baseURL }) => {
  const anon = await anonCtx(playwright, baseURL);
  const r = await anon.post('/api/labs/receive', { data: { serviceRequestId: 'does-not-exist', results: [{ testCode: 'x', testName: 'x', value: 1 }] } });
  log.labsReceiveAnonStatus = r.status();
  expect([401, 403], `anonymous POST was processed (status ${r.status()})`).toContain(r.status());
  await anon.dispose();
});

test('read endpoints respond without 5xx (smoke)', async ({ request }) => {
  const out: Record<string, number> = {};
  for (const u of ['queue', 'orders/billable', 'catalogs', 'inventory', 'diagnoses', 'procedures', 'tasks', 'follow-up', 'practitioners', 'appointments', 'settings/insurers', 'health/deep', 'document-templates?type=mc', 'document-templates?type=referral'])
    out[u] = (await request.get('/api/' + u)).status();
  log.smoke = out; expect(Object.values(out).every(s => s < 500), JSON.stringify(out)).toBeTruthy();
});
