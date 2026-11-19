import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

// Task 354: the composer must never show "Saved" when the server rejected the save, and must keep the doctor's item.
test.use({ trace: 'off' });
test.setTimeout(120_000);
async function fixture(request: APIRequestContext) {
  const suffix = Date.now().toString();
  const created = await request.post('/api/patients', { data: {
    fullName: `Plan354 Fake ${suffix}`, nric: `FAKE-P354-${suffix}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000',
  } });
  expect(created.status()).toBe(200);
  const { patientId } = await created.json();
  expect((await request.post('/api/consultations', { data: { patientId, chiefComplaint: 'Fake 354', diagnosis: 'Fake' } })).ok()).toBeTruthy();
  return patientId as string;
}
async function open(page: Page, patientId: string) {
  await page.goto(`/patients/${patientId}`);
  await openTreatment(page);
}
async function openTreatment(page: Page) {
  const tab = page.getByRole('tab', { name: 'Treatment', exact: true });
  await expect(async () => {
    await tab.click();
    await expect(page.getByText('Order', { exact: true })).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}
async function add(page: Page) {
  await page.locator('input:visible').last().fill('para');
  await page.locator('button', { hasText: /Paracetamol/ }).filter({ hasText: 'RM' }).first().click();
}
const status = (page: Page) => page.getByTestId('composer-save-status');

test('Treatment accepts search input while the on-demand inventory catalog is pending', async ({ page, request }) => {
  const patientId = await fixture(request);
  let inventoryRequested = false;
  let releaseInventory!: () => void;
  const inventoryGate = new Promise<void>(resolve => { releaseInventory = resolve; });
  await page.route(/\/api\/inventory(?:\?|$)/, async route => {
    inventoryRequested = true;
    await inventoryGate;
    await route.continue();
  });

  try {
    await page.goto(`/patients/${patientId}`);
    await expect(page.getByRole('tab', { name: 'Treatment', exact: true })).toBeVisible();
    expect(inventoryRequested).toBe(false);
    await openTreatment(page);
    await expect.poll(() => inventoryRequested).toBe(true);

    const search = page.getByRole('textbox', { name: 'Search treatment catalog' });
    await search.pressSequentially('para');
    await expect(search).toHaveValue('para');
    await expect(page.getByText('Loading…', { exact: true })).toBeVisible();

    releaseInventory();
    await expect(page.getByRole('button', { name: /Paracetamol.*RM/ }).first()).toBeVisible();
    await expect(search).toHaveValue('para');
  } finally {
    releaseInventory();
  }
});

test('real plan route (no stub): item is saved, survives reload, status is server-saved', async ({ page, request }) => {
  const patientId = await fixture(request);
  const posts: number[] = [];
  page.on('response', r => { if (r.url().includes('/api/consultations/plan') && r.request().method() === 'POST') posts.push(r.status()); });
  await open(page, patientId);
  await expect(status(page)).toHaveText('Saved (server)');
  await add(page);
  await expect(page.getByText(/1 × RM 0\.50/)).toBeVisible();
  await expect(status(page)).toHaveText('Saved (server)');
  expect(posts).toEqual([200]);
  await page.reload();
  await open(page, patientId);
  await expect(page.getByText(/1 × RM 0\.50/)).toBeVisible();
  await expect(status(page)).toHaveText('Saved (server)');
});

for (const [name, httpStatus, error] of [
  ['Project Id 500', 500, 'Unable to detect a Project Id in the current environment.'],
  ['UNAUTHENTICATED 401', 401, 'UNAUTHENTICATED: invalid authentication credentials'],
] as const) {
  test(`server rejects write (${name}): item kept, status Failed to save, never Saved`, async ({ page, request }) => {
    const patientId = await fixture(request);
    let fail = true;
    await page.route('**/api/consultations/plan**', route => {
      const method = route.request().method();
      if (method === 'GET') return route.continue();
      if (fail) return route.fulfill({ status: httpStatus, json: { success: false, error } });
      return route.continue();
    });
    await open(page, patientId);
    await expect(status(page)).toHaveText('Saved (server)');
    await add(page);
    await expect(status(page)).toHaveText('Failed to save');
    await expect(page.getByText(/1 × RM 0\.50/)).toBeVisible();   // no rollback of the doctor's item
    await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    fail = false;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(status(page)).toHaveText('Saved (server)');
    await expect(page.getByText(/1 × RM 0\.50/)).toBeVisible();
    await page.reload(); await open(page, patientId);
    await expect(page.getByText(/1 × RM 0\.50/)).toBeVisible();
  });
}

test('removing an item whose save failed clears the failure', async ({ page, request }) => {
  const patientId = await fixture(request);
  await page.route('**/api/consultations/plan**', route => {
    const m = route.request().method();
    if (m === 'POST') return route.fulfill({ status: 500, json: { success: false, error: 'Fake write failure' } });
    return route.continue();
  });
  await open(page, patientId);
  await add(page);
  await expect(status(page)).toHaveText('Failed to save');
  await page.getByRole('button', { name: 'Remove Paracetamol', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove Paracetamol', exact: true })).toHaveCount(0);
  await expect(status(page)).toHaveText('Saved (server)');
});
