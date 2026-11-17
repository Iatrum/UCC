import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// Task 354 review: a failed save of item A must not make A disappear when a later save of item B succeeds.
test.use({ trace: 'off' });
test.setTimeout(150_000);
async function fixture(request: APIRequestContext) {
  const suffix = Date.now().toString();
  const created = await request.post('/api/patients', { data: {
    fullName: `Plan354R Fake ${suffix}`, nric: `FAKE-P354R-${suffix}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000',
  } });
  expect(created.status()).toBe(200);
  const { patientId } = await created.json();
  expect((await request.post('/api/consultations', { data: { patientId, chiefComplaint: 'Fake 354R', diagnosis: 'Fake' } })).ok()).toBeTruthy();
  return patientId as string;
}
async function open(page: Page, patientId: string) {
  await page.goto(`/patients/${patientId}`);
  const tab = page.getByRole('tab', { name: 'Treatment', exact: true });
  await expect(async () => {
    await tab.click();
    await expect(page.getByText('Order', { exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}
async function add(page: Page, term: string, re: RegExp) {
  await page.locator('input:visible').last().fill(term);
  await page.locator('button', { hasText: re }).filter({ hasText: 'RM' }).first().click();
}
const status = (page: Page) => page.getByTestId('composer-save-status');

test('failed item A stays visible after a later item B saves; Retry then persists both', async ({ page, request }) => {
  const patientId = await fixture(request);
  let fail = true;
  await page.route('**/api/consultations/plan**', route => {
    if (route.request().method() === 'POST' && fail) return route.fulfill({ status: 500, json: { success: false, error: 'Fake write failure' } });
    return route.continue();
  });
  await open(page, patientId);
  await add(page, 'para', /Paracetamol/);
  await expect(status(page)).toHaveText('Failed to save');
  await expect(page.getByText(/Paracetamol/).first()).toBeVisible();
  fail = false;
  await add(page, 'amox', /Amoxicillin/);
  await expect(page.getByText(/Amoxicillin/).first()).toBeVisible();
  // B's success must neither hide the failure nor drop A from the screen.
  await expect(status(page)).toHaveText('Failed to save');
  await expect(page.getByRole('button', { name: 'Remove Paracetamol', exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(status(page)).toHaveText('Saved (server)');
  await page.reload(); await open(page, patientId);
  await expect(page.getByRole('button', { name: 'Remove Paracetamol', exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Remove Amoxicillin', exact: true })).toHaveCount(1);
});
