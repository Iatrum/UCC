import { test, expect } from '@playwright/test';
import { fhir } from '../lib/fhir';
import { RUN } from '../lib/env';

// Task 500 / Task 358: browser coverage of the real checkout screen. There is NO separate dispense step:
// completing checkout auto-deducts stock for dispensed medications and writes a MedicationDispense audit.
// (API-level idempotency/void/negative-stock cases live in dispense-checkout.spec.ts.) Fake data only.
test.describe.configure({ mode: 'serial' });

const uniq = String(Math.floor(Math.random() * 1e4)).padStart(4, '0');
const medName = `E2E UI Dispense Fake ${RUN}-${uniq}`;
const START = 10; const QTY = 4; const PRICE = 2.5;
let patientId = ''; let medId = ''; let encounterId = ''; let invoiceId = '';

test.beforeAll(async ({ request }) => {
  let r = await request.post('/api/patients', { data: { fullName: `Dispense UI Fake ${RUN}`, nric: `9307${String(10 + Math.floor(Math.random() * 18))}-14-${uniq}`, dateOfBirth: '1993-07-01', gender: 'female', phone: '0100000500' } });
  expect(r.ok(), await r.text()).toBeTruthy(); patientId = (await r.json()).patientId;
  r = await request.post('/api/inventory', { data: { name: medName, category: 'Analgesic', dosageForm: 'Tablet', strengths: [], stock: START, minimumStock: 1, unit: 'tablet', unitPrice: PRICE, expiryDate: '2029-12-31' } });
  expect(r.ok(), await r.text()).toBeTruthy(); medId = (await r.json()).medicationId;
  const m = await fhir();
  const patient: any = await m.readResource('Patient', patientId);
  const clinic = patient.identifier?.find((i: any) => i.system === 'clinic')?.value;
  encounterId = (await m.createResource({ resourceType: 'Encounter', status: 'in-progress', class: { code: 'AMB' },
    subject: { reference: `Patient/${patientId}` }, identifier: [{ system: 'clinic', value: clinic }, { system: 'firebase-patient', value: patientId }],
    ...(patient.meta?.accounts ? { meta: { accounts: patient.meta.accounts } } : {}) } as any)).id!;
  r = await request.post('/api/orders', { data: { consultationId: encounterId, prescriptions: [
    { medication: { name: medName }, frequency: 'od', duration: '3 days', quantity: QTY, price: PRICE, category: 'items' } ] } });
  expect(r.ok(), await r.text()).toBeTruthy();
});

const stockOf = async (request: any) =>
  (await (await request.get('/api/inventory')).json()).medications.find((m: any) => m.id === medId)?.stock;

test('stock is untouched before checkout (no dispense step on the page)', async ({ page, request }) => {
  expect(await stockOf(request)).toBe(START);
  await page.goto(`/orders/checkout/${encounterId}?patientId=${patientId}`);
  await expect(page.getByText('Loading checkout...', { exact: true })).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByText(medName).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /dispense/i })).toHaveCount(0);
  expect(await stockOf(request)).toBe(START); // viewing checkout never deducts
});

test('completing checkout in the browser deducts stock and records one dispense', async ({ page, request }) => {
  await page.goto(`/orders/checkout/${encounterId}?patientId=${patientId}`);
  await expect(page.getByText('Payments', { exact: true })).toBeVisible({ timeout: 120_000 });
  const total = (QTY * PRICE).toFixed(2);
  await page.locator('#paid-amount').fill(total);
  await expect(page.getByRole('button', { name: /Complete visitation/ })).toBeEnabled();
  await page.getByRole('button', { name: /Complete visitation/ }).click();
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await page.waitForURL(/checkout=completed/, { timeout: 120_000 });
  invoiceId = new URL(page.url()).searchParams.get('invoiceId') || '';
  expect(invoiceId).toBeTruthy();
  expect(await stockOf(request)).toBe(START - QTY);
  const d = (await (await request.get(`/api/inventory?dispensesFor=${encounterId}`)).json()).dispenses as any[];
  expect(d).toHaveLength(1);
  expect(d[0].status).toBe('completed'); expect(d[0].quantity).toBe(QTY); expect(d[0].stockAfter).toBe(START - QTY);
});

test('inventory page shows the reduced stock (not flagged negative)', async ({ page }) => {
  await page.goto('/inventory');
  await page.getByRole('tab', { name: 'Items' }).click();
  const cell = page.getByTestId(`stock-cell-${medId}`);
  await expect(cell).toContainText(String(START - QTY), { timeout: 120_000 });
  await expect(cell).not.toContainText('Negative stock');
});

test('reloading the checkout page / retrying the API does not deduct twice', async ({ page, request }) => {
  await page.goto(`/orders/checkout/${encounterId}?patientId=${patientId}`);
  await page.reload();
  const r = await request.post('/api/billing', { data: { consultationId: encounterId, patientId, paymentMethod: 'cash',
    paidAmount: QTY * PRICE, totalAmount: QTY * PRICE,
    items: [{ id: 'prescription-0', name: medName, type: 'Item', quantity: QTY, price: PRICE }] } });
  expect(r.ok(), await r.text()).toBeTruthy();
  expect(await stockOf(request)).toBe(START - QTY);
});

// #279 (Task 458: block RM 0 / no-item checkout) was still OPEN when this spec was written, so there is no
// behaviour to assert yet. Enable once it merges: POST /api/billing with no items / total 0 must be rejected
// (4xx), the checkout button disabled, and stock unchanged.
test.skip('RM 0 / no-item checkout is blocked (needs #279)', async () => {});

test.afterAll(async ({ request }) => {
  if (invoiceId) await request.delete('/api/billing', { data: { invoiceId } });
  if (medId) await request.delete(`/api/inventory?id=${medId}`);
  if (patientId) await request.delete(`/api/patients?patientId=${patientId}`);
});
