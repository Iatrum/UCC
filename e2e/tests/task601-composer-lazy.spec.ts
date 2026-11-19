import { test, expect, type APIRequestContext } from '@playwright/test';

// Task 601: composer catalogs load only when the Treatment drawer opens; ordering + lazy tabs still work.
test.use({ trace: 'off' });
test.setTimeout(120_000);
const CATALOG = /\/api\/(procedures|catalogs|inventory)\b/;
async function fixture(request: APIRequestContext) {
  const suffix = Date.now().toString();
  const created = await request.post('/api/patients', { data: {
    fullName: `Lazy601 Fake ${suffix}`, nric: `FAKE-P601-${suffix}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000',
  } });
  expect(created.status()).toBe(200);
  const { patientId } = await created.json();
  expect((await request.post('/api/consultations', { data: { patientId, chiefComplaint: 'Fake 601', diagnosis: 'Fake' } })).ok()).toBeTruthy();
  return patientId as string;
}

test('catalogs wait for the composer; ordering signs; lazy tabs render', async ({ page, request }) => {
  const patientId = await fixture(request);
  const catalogCalls: string[] = []; const orders: number[] = [];
  page.on('request', r => { if (CATALOG.test(r.url())) catalogCalls.push(new URL(r.url()).pathname + new URL(r.url()).search); });
  page.on('response', r => { if (/\/api\/orders$/.test(r.url()) && r.request().method() === 'POST') orders.push(r.status()); });

  await page.goto(`/patients/${patientId}`);
  await expect(page.getByRole('tab', { name: 'Treatment', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  expect(catalogCalls).toEqual([]);

  await page.getByRole('tab', { name: 'Treatment', exact: true }).click();
  await expect(page.getByText('Order', { exact: true })).toBeVisible();
  await page.locator('input:visible').last().fill('para');
  await page.locator('button', { hasText: /Paracetamol/ }).filter({ hasText: 'RM' }).first().click();
  await expect(page.getByText(/1 × RM 0\.50/)).toBeVisible();
  expect(catalogCalls.filter(c => c.startsWith('/api/procedures'))).toHaveLength(1);
  expect(catalogCalls.filter(c => c.startsWith('/api/inventory'))).toHaveLength(1);
  expect(catalogCalls.filter(c => c.startsWith('/api/catalogs')).sort()).toEqual(
    ['/api/catalogs?type=document', '/api/catalogs?type=imaging', '/api/catalogs?type=lab']);

  await expect(page.getByTestId('composer-save-status')).toHaveText('Saved (server)');
  await page.getByRole('button', { name: 'Sign', exact: true }).last().click();
  await expect.poll(() => orders, { timeout: 30_000 }).toEqual([200]);

  for (const tab of [/Lab/i, /Document/i]) {
    const t = page.getByRole('tab', { name: tab }).first();
    if (await t.count()) { await t.click(); await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 30_000 }); }
  }
});
