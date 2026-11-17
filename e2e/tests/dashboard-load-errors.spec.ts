import { test, expect } from '@playwright/test';

// Task 430: dashboard Billing/Appointments must show loading -> error + Retry -> list,
// never the empty text while loading or after a failure. Responses are mocked (fake data only).
test.use({ trace: 'off' });
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('dashboard Billing tab: loading, error, Retry, list', async ({ page }) => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/api/orders/billable', async (route) => {
    calls += 1;
    if (calls === 1) { await gate; return route.fulfill(json({ error: 'boom' }, 500)); }
    return route.fulfill(json({ consultations: [{ id: 'fake-enc-1', patientId: 'fake-pat-1', patientFullName: 'Fake Billable Patient', date: '2026-11-10T09:00:00Z', queueStatus: 'meds_and_bills' }] }));
  });
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Billing' }).click();
  const empty = page.getByText('No billable consultations found');
  await expect(page.getByText('Loading billable consultations...')).toBeVisible();
  await expect(empty).toHaveCount(0);
  release();
  await expect(page.getByText('Failed to load billable consultations.')).toBeVisible();
  await expect(empty).toHaveCount(0);
  await page.screenshot({ path: process.env.UCC_SHOT_DIR ? `${process.env.UCC_SHOT_DIR}/billing-error.png` : undefined });
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('link', { name: 'Fake Billable Patient' })).toBeVisible();
  await expect(empty).toHaveCount(0);
});

test('dashboard Appointments tab: error then Retry', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/appointments', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    calls += 1;
    if (calls === 1) return route.fulfill(json({ error: 'boom' }, 500));
    return route.fulfill(json({ appointments: [{ id: 'fake-appt-1', patientId: 'fake-pat-1', patientName: 'Fake Appt Patient', clinician: 'Dr Fake', status: 'booked', scheduledAt: new Date(Date.now() + 86_400_000).toISOString() }] }));
  });
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Appointments' }).click();
  await expect(page.getByText('Failed to load appointments.')).toBeVisible();
  await expect(page.getByText(/No upcoming appointments yet/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Fake Appt Patient')).toBeVisible();
});
