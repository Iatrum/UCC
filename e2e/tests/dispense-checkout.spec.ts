import { test, expect } from '@playwright/test';
import { fhir } from '../lib/fhir';
import { RUN } from '../lib/env';

// Task 358: stock is auto-deducted at checkout (no dispense step), idempotent, reversible on void,
// allowed to go negative and flagged in the existing inventory view. Fake data only.
test.describe.configure({ mode: 'serial' });

const uniq = String(Math.floor(Math.random() * 1e4)).padStart(4, '0');
const medName = `E2E Dispense Fake ${RUN}-${uniq}`;
let patientId = ''; let medId = ''; let encounterId = ''; let invoiceId = '';

const stockOf = async (request: any) =>
  (await (await request.get('/api/inventory')).json()).medications.find((m: any) => m.id === medId)?.stock;
let api: any;
const dispenses = async () =>
  (await (await api.get(`/api/inventory?dispensesFor=${encounterId}`)).json()).dispenses as any[];
const checkout = (request: any, qty: number) => request.post('/api/billing', { data: {
  consultationId: encounterId, patientId, paymentMethod: 'cash', paidAmount: qty * 2, totalAmount: qty * 2,
  items: [
    { id: 'prescription-0', name: medName, type: 'Item', quantity: qty, price: 2 },
    { id: 'procedure-0', name: 'Consultation fee', type: 'Service', quantity: 0 + 1, price: 0 },
  ],
} });

test.beforeAll(async ({ request }) => {
  let r = await request.post('/api/patients', { data: { fullName: `Dispense Fake ${RUN}`, nric: `9105${String(10 + Math.floor(Math.random() * 18))}-14-${uniq}`, dateOfBirth: '1991-05-01', gender: 'female', phone: '0100000358' } });
  expect(r.ok(), await r.text()).toBeTruthy(); patientId = (await r.json()).patientId;
  r = await request.post('/api/inventory', { data: { name: medName, category: 'Analgesic', dosageForm: 'Tablet', strengths: [], stock: 3, minimumStock: 5, unit: 'tablet', unitPrice: 2, expiryDate: '2029-12-31' } });
  expect(r.ok()).toBeTruthy(); medId = (await r.json()).medicationId;
  const m = await fhir();
  const patient: any = await m.readResource('Patient', patientId);
  const clinic = patient.identifier?.find((i: any) => i.system === 'clinic')?.value;
  encounterId = (await m.createResource({ resourceType: 'Encounter', status: 'in-progress', class: { code: 'AMB' },
    subject: { reference: `Patient/${patientId}` }, identifier: [{ system: 'clinic', value: clinic }],
    ...(patient.meta?.accounts ? { meta: { accounts: patient.meta.accounts } } : {}) } as any)).id!;
});

test('checkout auto-deducts, goes negative without blocking, and is idempotent', async ({ request }) => {
  api = request;
  let r = await checkout(request, 5); expect(r.ok()).toBeTruthy();
  const body = await r.json(); invoiceId = body.invoiceId;
  expect(body.stockNegative).toContain(medName);
  expect(await stockOf(request)).toBe(-2);
  const d = await dispenses(); expect(d).toHaveLength(1);
  expect(d[0].status).toBe('completed'); expect(d[0].quantity).toBe(5); expect(d[0].stockAfter).toBe(-2);
  // retry + re-checkout with identical items must not deduct twice
  expect((await checkout(request, 5)).ok()).toBeTruthy(); expect((await checkout(request, 5)).ok()).toBeTruthy();
  expect(await stockOf(request)).toBe(-2); expect(await dispenses()).toHaveLength(1);
});

test('inventory view flags negative stock', async ({ page }) => {
  await page.goto('/inventory');
  await page.getByRole('tab', { name: 'Items' }).click();
  await expect(page.getByTestId(`stock-cell-${medId}`)).toContainText('Negative stock', { timeout: 120_000 });
});

test('void restores stock once; re-checkout deducts once more', async ({ request }) => {
  api = request;
  for (let i = 0; i < 2; i++) {
    const r = await request.patch('/api/billing', { data: { invoiceId, action: 'void' } }); expect(r.ok()).toBeTruthy();
  }
  expect(await stockOf(request)).toBe(3);
  expect((await dispenses())[0].status).toBe('cancelled');
  expect((await checkout(request, 2)).ok()).toBeTruthy();
  expect(await stockOf(request)).toBe(1);
  expect(await dispenses()).toHaveLength(1);
});

test('concurrent checkouts of the same visit deduct exactly once', async ({ request }) => {
  api = request;
  await request.patch('/api/billing', { data: { invoiceId, action: 'void' } });
  const before = await stockOf(request);
  const rs = await Promise.all([checkout(request, 2), checkout(request, 2), checkout(request, 2)]);
  rs.forEach((r) => expect(r.ok()).toBeTruthy());
  expect(await stockOf(request)).toBe(before - 2);
  expect(await dispenses()).toHaveLength(1);
});

test.afterAll(async ({ request }) => {
  if (invoiceId) await request.delete('/api/billing', { data: { invoiceId } });
  if (medId) await request.delete(`/api/inventory?id=${medId}`);
  if (patientId) await request.delete(`/api/patients?patientId=${patientId}`);
});
