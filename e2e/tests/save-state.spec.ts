import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import path from 'node:path';

const shots = path.resolve(import.meta.dirname, '../../.ai/ux-shots/u1b-save-state');
test.use({ trace: 'off' });
test.setTimeout(120_000);
const saved = (entries: any[] = []) => ({ success: true, persistenceAvailable: true, plan: { entries } });
const unavailable = { success: false, persistenceAvailable: false };
function latch() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
async function fixture(request: APIRequestContext) {
  const suffix = Date.now().toString();
  const created = await request.post('/api/patients', { data: {
    fullName: `Save Status Fake ${suffix}`, nric: `FAKE-SAVE-${suffix}`,
    dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000',
  } });
  expect(created.ok()).toBeTruthy();
  const { patientId } = await created.json();
  const consult = await request.post('/api/consultations', { data: {
    patientId, chiefComplaint: 'Fake save status test', diagnosis: 'Fake test diagnosis',
  } });
  expect(consult.ok()).toBeTruthy();
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
async function add(page: Page) {
  await page.locator('input:visible').last().fill('para');
  await page.locator('button', { hasText: /Paracetamol/ }).filter({ hasText: 'RM' }).first().click();
}
const status = (page: Page) => page.getByTestId('composer-save-status');
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(shots, name), fullPage: true });

test('hydration waits for GET; late hydration keeps a new item; POST and DELETE show Saving', async ({ page, request }) => {
  const patientId = await fixture(request);
  const get = latch(), getStarted = latch(), post = latch(), postStarted = latch(), del = latch(), delStarted = latch();
  let entries: any[] = [];
  await page.route('**/api/consultations/plan**', async route => {
    const method = route.request().method();
    if (method === 'GET') {
      getStarted.resolve(); await get.promise;
      await route.fulfill({ json: saved() });
    } else if (method === 'POST') {
      postStarted.resolve(); await post.promise;
      const entry = route.request().postDataJSON().entry;
      entries = [{ ...entry, lineTotal: entry.quantity * entry.unitPrice, createdAt: new Date().toISOString() }];
      await route.fulfill({ json: saved(entries) });
    } else {
      delStarted.resolve(); await del.promise;
      entries = [];
      await route.fulfill({ json: saved() });
    }
  });
  await open(page, patientId);
  await getStarted.promise;
  await expect(status(page)).toHaveText('Checking saved draft…');
  await expect(status(page)).toHaveAttribute('aria-live', 'polite');
  const initialHeight = await status(page).locator('..').evaluate(el => (el as HTMLElement).offsetHeight);
  await shot(page, 'after-checking.png');
  await add(page);
  await postStarted.promise;
  // Even an in-flight write must not hide unresolved hydration.
  await expect(status(page)).toHaveText('Checking saved draft…');
  get.resolve();
  await expect(status(page)).toHaveText('Saving…');
  await expect(page.getByText(/1 × RM 0\.50/)).toBeVisible();
  await shot(page, 'after-saving.png');
  post.resolve();
  await expect(status(page)).toHaveText('Saved (server)');
  await shot(page, 'after-saved.png');
  expect(await status(page).locator('..').evaluate(el => (el as HTMLElement).offsetHeight)).toBe(initialHeight);
  await page.getByRole('button', { name: 'Remove Paracetamol', exact: true }).click();
  await delStarted.promise;
  await expect(status(page)).toHaveText('Saving…');
  del.resolve();
  await expect(status(page)).toHaveText('Saved (server)');
});

test('GET 503 is local-only and retains items after parent rerenders', async ({ page, request }) => {
  const patientId = await fixture(request);
  let gets = 0, writes = 0;
  await page.route('**/api/consultations/plan**', route => {
    if (route.request().method() === 'GET') gets++; else writes++;
    return route.fulfill({ status: 503, json: unavailable });
  });
  await open(page, patientId);
  await expect(status(page)).toContainText('Saved on this device only');
  await expect(status(page)).toContainText('lost on reload');
  const hydratedGets = gets; // React Strict Mode may perform an ignored mount request.
  await add(page);
  await expect(page.getByText(/1 × RM 0\.50/)).toBeVisible();
  await expect(status(page)).not.toHaveText('Saved (server)');
  await shot(page, 'after-local-only.png');
  expect(writes).toBe(0);
  expect(gets).toBe(hydratedGets);
});

test('POST 503 switches to local-only without rolling back the item', async ({ page, request }) => {
  const patientId = await fixture(request);
  await page.route('**/api/consultations/plan**', route => route.fulfill(
    route.request().method() === 'GET' ? { json: saved() } : { status: 503, json: unavailable }
  ));
  await open(page, patientId);
  await expect(status(page)).toHaveText('Saved (server)');
  await add(page);
  await expect(status(page)).toContainText('Saved on this device only');
  await expect(page.getByText(/1 × RM 0\.50/)).toBeVisible();
});

test('generic GET failure offers Retry, checks again and only then confirms server state', async ({ page, request }) => {
  const patientId = await fixture(request);
  let gets = 0;
  let failing = true;
  const retry = latch(), retryStarted = latch();
  await page.route('**/api/consultations/plan**', async route => {
    gets++;
    if (failing) await route.fulfill({ status: 500, json: { success: false } });
    else {
      retryStarted.resolve(); await retry.promise;
      await route.fulfill({ json: saved() });
    }
  });
  await open(page, patientId);
  await expect(status(page)).toHaveText('Failed to save');
  await shot(page, 'after-load-failed.png');
  const failedGets = gets;
  failing = false;
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await retryStarted.promise;
  await expect(status(page)).toHaveText('Checking saved draft…');
  retry.resolve();
  await expect(status(page)).toHaveText('Saved (server)');
  expect(gets).toBeGreaterThan(failedGets);
});

test('failed POST and DELETE replay the same operation with Retry', async ({ page, request }) => {
  const patientId = await fixture(request);
  let posts = 0, deletes = 0;
  let firstEntry: any;
  let entries: any[] = [];
  await page.route('**/api/consultations/plan**', async route => {
    const method = route.request().method();
    if (method === 'GET') return route.fulfill({ json: saved(entries) });
    if (method === 'POST') {
      posts++;
      const entry = route.request().postDataJSON().entry;
      if (posts === 1) {
        firstEntry = entry;
        return route.fulfill({ status: 500, json: { success: false, error: 'Fake write failure' } });
      }
      expect(entry).toEqual(firstEntry);
      entries = [{ ...entry, lineTotal: 0.5, createdAt: new Date().toISOString() }];
    } else {
      deletes++;
      expect(route.request().postDataJSON().entryId).toBe(firstEntry.id);
      if (deletes === 1) return route.fulfill({ status: 500, json: { success: false, error: 'Fake delete failure' } });
      entries = [];
    }
    return route.fulfill({ json: saved(entries) });
  });
  await open(page, patientId);
  await expect(status(page)).toHaveText('Saved (server)');
  await add(page);
  await expect(status(page)).toHaveText('Failed to save');
  await shot(page, 'after-write-failed.png');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(status(page)).toHaveText('Saved (server)');
  await expect(page.getByText(/1 × RM 0\.50/)).toBeVisible();
  await shot(page, 'after-retry-saved.png');
  await page.getByRole('button', { name: 'Remove Paracetamol', exact: true }).click();
  await expect(status(page)).toHaveText('Failed to save');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(status(page)).toHaveText('Saved (server)');
  await expect(page.getByRole('button', { name: 'Remove Paracetamol', exact: true })).toHaveCount(0);
  expect(posts).toBe(2); expect(deletes).toBe(2);
});

test('unsigned consult note is honest; failure preserves text and Retry resubmits', async ({ page, request }) => {
  const patientId = await fixture(request);
  const save = latch(), saveStarted = latch();
  let posts = 0;
  await page.route('**/api/consultations', async route => {
    posts++;
    expect(route.request().postDataJSON().chiefComplaint).toContain('Fake note kept for retry');
    if (posts === 1) return route.fulfill({ status: 500, json: { success: false, error: 'Fake note failure' } });
    saveStarted.resolve(); await save.promise;
    // Fulfil locally: no signed clinical write is needed to test UI feedback.
    return route.fulfill({ json: { success: true, consultationId: crypto.randomUUID() } });
  });
  await page.route('**/api/consultations/plan**', route => route.fulfill({ json: saved() }));
  await page.goto(`/patients/${patientId}`);
  await page.getByRole('tab', { name: 'Consult', exact: true }).click();
  const noteStatus = page.getByTestId('consult-save-status');
  await expect(noteStatus).toContainText('Not saved — sign to save');
  await page.locator('[contenteditable=true]').first().fill('Fake note kept for retry');
  await page.locator('button', { hasText: 'Select or search diagnosis' }).click();
  await page.keyboard.type('Fake save diagnosis');
  await page.getByRole('option').first().click();
  await shot(page, 'after-note-unsigned.png');
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(noteStatus).toHaveText('Failed to save');
  await expect(page.locator('[contenteditable=true]').first()).toContainText('Fake note kept for retry');
  await shot(page, 'after-note-failed.png');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await saveStarted.promise;
  await expect(noteStatus).toHaveText('Saving…');
  await shot(page, 'after-note-saving.png');
  save.resolve();
  await expect(status(page)).toHaveText('Saved (server)');
  expect(posts).toBe(2);
});
