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
  await expect(page.getByRole('tabpanel').getByText('Failed to fetch consultations', { exact: true })).toBeVisible();
  await expect(empty).toHaveCount(0);
  await page.screenshot({ path: process.env.UCC_SHOT_DIR ? `${process.env.UCC_SHOT_DIR}/billing-error.png` : undefined });
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('link', { name: 'Fake Billable Patient' }).first()).toBeVisible();
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
  await expect(page.getByRole('tabpanel').getByText('Failed to fetch appointments', { exact: true })).toBeVisible();
  await expect(page.getByText(/No upcoming appointments yet/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Fake Appt Patient')).toBeVisible();
});

// Task 452 (UX audit High #2): keep the previous queue while refetching; no error on interrupted fetch.
const fakeQueue = (name: string) => json({ patients: [{ id: 'fake-pat-q', fullName: name, queueStatus: 'waiting', queueNumber: 1 }] });

test('dashboard queue keeps previous list while refetching', async ({ page }) => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/api/queue', async (route) => {
    calls += 1;
    if (calls === 1) return route.fulfill(fakeQueue('Fake Queue Patient'));
    await gate;
    return route.fulfill(fakeQueue('Fake Queue Patient'));
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Refresh queue' }).click();
  await expect(page.getByText('Fake Queue Patient')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh queue' }).click();
  await expect.poll(() => calls).toBeGreaterThan(1);
  await expect(page.getByText('Fake Queue Patient')).toBeVisible();
  await expect(page.getByText('Loading queue...')).toHaveCount(0);
  release();
  await expect(page.getByText('Fake Queue Patient')).toBeVisible();
});

test('dashboard queue keeps list and shows banner when a refetch fails', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/queue', (route) => {
    calls += 1;
    return calls === 1 ? route.fulfill(fakeQueue('Fake Queue Patient')) : route.fulfill(json({ error: 'boom' }, 500));
  });
  await page.goto('/dashboard');
  await page.getByRole('button', { name: 'Refresh queue' }).click();
  await expect(page.getByText('Fake Queue Patient')).toBeVisible();
  await page.getByRole('button', { name: 'Refresh queue' }).click();
  await expect(page.getByText('Queue could not be refreshed')).toBeVisible();
  await expect(page.getByText('Fake Queue Patient')).toBeVisible();
});

test('navigating away mid-fetch does not surface an error', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // Hold the queue request until the client-side navigation has committed, so the abort can only land on an unmounted dashboard
  // (a fixed delay raced the dev server's cold page compile).
  let release!: () => void;
  const navigated = new Promise<void>((r) => { release = r; });
  await page.route('**/api/queue', async (route) => { await navigated; await route.abort('failed').catch(() => {}); });
  await page.goto('/dashboard');
  await Promise.all([
    page.waitForRequest('**/api/queue'),
    page.getByRole('button', { name: 'Refresh queue' }).click(),
  ]);
  await page.getByRole('link', { name: /inventory/i }).first().click(); // client-side navigation away (the sidebar has no 'Patients' link on this page)
  await page.waitForURL(/\/inventory/, { timeout: 60_000 });
  release();
  await page.waitForTimeout(2000);
  expect(errors.filter((e) => /Error loading (queue|appointments|consultations)/.test(e))).toHaveLength(0);
});
