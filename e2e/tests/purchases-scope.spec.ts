import { test, expect, request as pwRequest } from '@playwright/test';
import { fhir } from '../lib/fhir';
import { RUN } from '../lib/env';
import { createRequire } from 'node:module';
const { INVENTORY_PURCHASING_ENABLED, INVENTORY_PURCHASING_DISABLED_ERROR } = createRequire(import.meta.url)('tsx/cjs') && createRequire(import.meta.url)('../../lib/purchasing.ts');

// Task 500 / Task 383: purchases are clinic-scoped. A clinic user lists only their own clinic's purchase
// orders; an id from another clinic (or a non-PO Basic) is 404 (Task 422 rule 1: resource addressed by id).
// Purchasing writes are feature-flagged off (lib/purchasing.ts): while off, POST/PATCH/DELETE return 403
// before any lookup, so the create/mutate scoping cases assert the disabled contract and, if the flag is
// flipped on later, the clinic-scoped behaviour. Fake data only, fixtures created/removed via dev Medplum.
test.describe.configure({ mode: 'serial' });

const uniq = `${RUN}-${Math.floor(Math.random() * 1e4)}`;
const FOREIGN_CLINIC = `e2e-foreign-clinic-${uniq}`;
let patientId = ''; let ownClinic = '';
const fixtures: string[] = [];
let ownPo = ''; let foreignPo = ''; let nonPo = '';
const created: string[] = [];

const poBasic = (clinic: string, supplier: string) => ({
  resourceType: 'Basic' as const,
  code: { coding: [{ system: 'urn:iatrum:resource-type', code: 'purchase-order' }] },
  identifier: [{ system: 'clinic', value: clinic }],
  extension: [{ url: 'urn:iatrum:purchase-order/data', valueString: JSON.stringify({
    documentType: 'purchaseOrder', supplierId: 'e2e-supplier', supplierName: supplier, status: 'draft', items: [],
    subtotalAmount: 0, totalAmount: 0, amountDue: 0 }) }],
});
const ids = (body: any) => (body.purchaseOrders || []).map((p: any) => p.id);

test.beforeAll(async ({ request }) => {
  // Learn the signed-in user's clinic from a fake patient (same approach as dispense-checkout.spec).
  const r = await request.post('/api/patients', { data: { fullName: `Purchases Scope Fake ${uniq}`,
    nric: `9206${String(10 + Math.floor(Math.random() * 18))}-14-${String(Math.floor(Math.random() * 1e4)).padStart(4, '0')}`,
    dateOfBirth: '1992-06-01', gender: 'male', phone: '0100000383' } });
  expect(r.ok(), await r.text()).toBeTruthy(); patientId = (await r.json()).patientId;
  const m = await fhir();
  const patient: any = await m.readResource('Patient', patientId);
  ownClinic = patient.identifier?.find((i: any) => i.system === 'clinic')?.value;
  expect(ownClinic).toBeTruthy(); expect(ownClinic).not.toBe(FOREIGN_CLINIC);
  const mk = async (b: any) => { const x = await m.createResource(b); fixtures.push(x.id!); return x.id!; };
  ownPo = await mk(poBasic(ownClinic, `E2E Own Supplier ${uniq}`));
  foreignPo = await mk(poBasic(FOREIGN_CLINIC, `E2E Foreign Supplier ${uniq}`));
  // same clinic, but not a purchase order
  nonPo = await mk({ resourceType: 'Basic', code: { coding: [{ system: 'urn:iatrum:resource-type', code: 'not-a-po' }] },
    identifier: [{ system: 'clinic', value: ownClinic }] });
});

test('list shows only this clinic\'s purchase orders', async ({ request }) => {
  const r = await request.get('/api/purchases'); expect(r.status()).toBe(200);
  const got = ids(await r.json());
  expect(got).toContain(ownPo);
  expect(got).not.toContain(foreignPo);
  expect(got).not.toContain(nonPo);
});

test('own id is readable; foreign id and non-PO id are 404', async ({ request }) => {
  const own = await request.get(`/api/purchases?id=${ownPo}`); expect(own.status()).toBe(200);
  expect((await own.json()).purchaseOrder.id).toBe(ownPo);
  for (const id of [foreignPo, nonPo, `e2e-missing-${uniq}`]) {
    const r = await request.get(`/api/purchases?id=${encodeURIComponent(id)}`);
    expect(r.status(), `id ${id}`).toBe(404);
    expect(JSON.stringify(await r.json())).not.toContain(FOREIGN_CLINIC); // no existence/clinic leak
  }
});

test('foreign purchase cannot be modified or deleted; foreign data stays untouched', async ({ request }) => {
  const m = await fhir();
  const before: any = await m.readResource('Basic', foreignPo, { cache: 'no-cache' });
  const patch = await request.patch('/api/purchases', { data: { id: foreignPo, notes: 'tamper' } });
  const del = await request.delete(`/api/purchases?id=${foreignPo}`);
  // Flag off: 403 "disabled" before lookup. Flag on: foreign id addressed by id => 404 (Task 422 rule 1).
  const expected = INVENTORY_PURCHASING_ENABLED ? 404 : 403;
  expect(patch.status()).toBe(expected); expect(del.status()).toBe(expected);
  if (!INVENTORY_PURCHASING_ENABLED) expect(JSON.stringify(await patch.json())).toContain(INVENTORY_PURCHASING_DISABLED_ERROR);
  const after: any = await m.readResource('Basic', foreignPo, { cache: 'no-cache' });
  expect(after.meta.versionId).toBe(before.meta.versionId);
});

test('creating a purchase stamps this clinic (or is disabled while the feature flag is off)', async ({ request }) => {
  const supplierName = `E2E Created Supplier ${uniq}`;
  const r = await request.post('/api/purchases', { data: { supplierId: 'e2e-supplier', supplierName, items: [] } });
  if (!INVENTORY_PURCHASING_ENABLED) {
    expect(r.status()).toBe(403);
    expect((await r.json()).error).toBe(INVENTORY_PURCHASING_DISABLED_ERROR);
    const list = (await (await request.get('/api/purchases')).json()).purchaseOrders;
    expect(list.some((p: any) => p.supplierName === supplierName)).toBe(false);
    return;
  }
  expect(r.status()).toBe(200);
  const id = (await r.json()).id as string; created.push(id);
  const m = await fhir();
  const basic: any = await m.readResource('Basic', id, { cache: 'no-cache' });
  expect(basic.identifier.find((i: any) => i.system === 'clinic')?.value).toBe(ownClinic);
  const got = ids(await (await request.get('/api/purchases')).json());
  expect(got).toContain(id); expect(got).not.toContain(foreignPo);
});

test('unauthenticated callers get 401 and no purchase data', async () => {
  const anon = await pwRequest.newContext({ baseURL: process.env.UCC_BASE_URL || 'http://localhost:3210', storageState: { cookies: [], origins: [] } });
  for (const url of ['/api/purchases', `/api/purchases?id=${ownPo}`]) {
    const r = await anon.get(url); expect([401, 403]).toContain(r.status());
    expect(await r.text()).not.toContain(`E2E Own Supplier ${uniq}`);
  }
  await anon.dispose();
});

test.afterAll(async ({ request }) => {
  const m = await fhir();
  for (const id of [...fixtures, ...created]) await m.deleteResource('Basic', id).catch(() => undefined);
  if (patientId) await request.delete(`/api/patients?patientId=${patientId}`);
});
