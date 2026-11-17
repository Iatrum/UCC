import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
// Fake data only. The results API is mocked so failed / empty / known states are deterministic.
test.use({ trace: 'off' });
test.setTimeout(120_000);

async function fixture(request: APIRequestContext) {
  const suffix = Date.now();
  const r = await request.post('/api/patients', { data: {
    fullName: `Lab State Fake ${suffix}`, nric: `FAKE-LABSTATE-${suffix}`,
    dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000',
  } });
  expect(r.status()).toBe(200);
  return (await r.json()).patientId as string;
}

const report = (patientId: string) => ({
  id: 'fake-report-1', patientId, status: 'final', orderedAt: '2026-01-01T00:00:00Z', issuedAt: '2026-01-01T01:00:00Z',
  results: [{ testCode: '14743-9', testName: 'Glucose (capillary)', value: 7.1, unit: 'mmol/L', status: 'final', interpretation: 'high' }],
});
const ok = (reports: unknown[] = []) => ({ success: true, poctEnabled: true, pacsEnabled: false, reports, pending: [], xrayPending: [] });

type Mode = 'ok-empty' | 'ok-report' | '500' | '403' | 'abort' | 'malformed';
async function mockResults(page: Page, patientId: string, initial: Mode) {
  const state = { mode: initial, reads: 0 };
  // Keep the lease/socket transport out of these tests.
  await page.route('**/api/labs/subscription', (route) => route.fulfill({ status: 503, json: { error: 'Unavailable' } }));
  await page.route('**/api/labs/results?**', async (route) => {
    state.reads++;
    switch (state.mode) {
      case 'ok-empty': return route.fulfill({ json: ok() });
      case 'ok-report': return route.fulfill({ json: ok([report(patientId)]) });
      case '500': return route.fulfill({ status: 500, json: { error: 'Boom' } });
      case '403': return route.fulfill({ status: 403, json: { error: 'Forbidden' } });
      case 'malformed': return route.fulfill({ status: 200, json: { success: true } });
      default: return route.abort('failed');
    }
  });
  return state;
}
const goto = (page: Page, id: string) => page.goto(`/patients/${id}/labs-imaging`);
const emptyText = (page: Page) => page.getByText('No lab results available', { exact: true });

test('failed first load shows an error with Retry, never "No lab results available"; Retry recovers to a true empty state', async ({ page, request }) => {
  const id = await fixture(request);
  for (const mode of ['500', 'abort', 'malformed'] as const) {
    const state = await mockResults(page, id, mode);
    await goto(page, id);
    await expect(page.getByTestId('lab-load-error')).toBeVisible();
    await expect(page.getByText('Could not load lab results', { exact: true })).toBeVisible();
    await expect(emptyText(page)).toHaveCount(0);
    await expect(page.getByText('Laboratory Report')).toHaveCount(0);
    state.mode = 'ok-empty';
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(emptyText(page)).toBeVisible();
    await expect(page.getByTestId('lab-load-error')).toHaveCount(0);
    await expect(page.getByTestId('lab-last-updated')).toContainText('Last updated');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  }
});

test('a true empty result still reads as empty, with a freshness timestamp and a working Refresh', async ({ page, request }) => {
  const id = await fixture(request);
  const state = await mockResults(page, id, 'ok-empty');
  await goto(page, id);
  await expect(emptyText(page)).toBeVisible();
  await expect(page.getByTestId('lab-last-updated')).toContainText('Last updated');
  await expect(page.getByTestId('lab-load-error')).toHaveCount(0);
  const before = state.reads;
  state.mode = 'ok-report';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('7.1 mmol/L', { exact: true })).toBeVisible();
  expect(state.reads).toBeGreaterThan(before);
});

test('known reports are retained across a failed refresh with a stale banner and unchanged timestamp; Refresh recovers', async ({ page, request }) => {
  const id = await fixture(request);
  const state = await mockResults(page, id, 'ok-report');
  await goto(page, id);
  await expect(page.getByText('7.1 mmol/L', { exact: true })).toBeVisible();
  const stamp = await page.getByTestId('lab-last-updated').innerText();
  await page.waitForTimeout(1100);
  state.mode = '500';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByTestId('lab-stale-banner')).toBeVisible();
  await expect(page.getByText('7.1 mmol/L', { exact: true })).toBeVisible();
  await expect(emptyText(page)).toHaveCount(0);
  await expect(page.getByTestId('lab-last-updated')).toHaveText(stamp);
  state.mode = 'abort';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByTestId('lab-stale-banner')).toBeVisible();
  await expect(page.getByText('7.1 mmol/L', { exact: true })).toBeVisible();
  state.mode = 'ok-report';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByTestId('lab-stale-banner')).toHaveCount(0);
  await expect(page.getByTestId('lab-last-updated')).not.toHaveText(stamp);
  await expect(page.getByText('7.1 mmol/L', { exact: true })).toBeVisible();
});

test('401/403 clears known results and shows access denied (not empty); Retry recovers', async ({ page, request }) => {
  const id = await fixture(request);
  const state = await mockResults(page, id, 'ok-report');
  await goto(page, id);
  await expect(page.getByText('7.1 mmol/L', { exact: true })).toBeVisible();
  state.mode = '403';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByText('Access denied', { exact: true })).toBeVisible();
  await expect(page.getByText('7.1 mmol/L', { exact: true })).toHaveCount(0);
  await expect(emptyText(page)).toHaveCount(0);
  state.mode = 'ok-report';
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('7.1 mmol/L', { exact: true })).toBeVisible();
});

test('lab results never render in the consultation composer', async ({ page, request }) => {
  const id = await fixture(request);
  await mockResults(page, id, 'ok-report');
  await page.goto(`/patients/${id}`);
  await page.getByRole('tab', { name: 'Consult', exact: true }).click();
  await expect(page.getByText('7.1 mmol/L')).toHaveCount(0);
  await expect(page.getByTestId('lab-last-updated')).toHaveCount(0);
});

// Task 476 (UX #14): subscription 503 -> quiet "Live updates off" hint next to the timestamp; results unaffected.
test('subscription unavailable shows a quiet "Live updates off - press Refresh" hint', async ({ page, request }) => {
  const id = await fixture(request);
  await mockResults(page, id, 'ok-empty'); // mock already answers /api/labs/subscription with 503
  await goto(page, id);
  await expect(emptyText(page)).toBeVisible();
  await expect(page.getByTestId('lab-live-off')).toContainText('Live updates off');
  await expect(page.getByTestId('lab-live-off')).toContainText('Refresh');
  await expect(page.getByTestId('lab-load-error')).toHaveCount(0);
});
