import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import path from 'node:path';
const shots = '/workspace/ai-logs/task-u1b-draft/screenshots';
test.use({ trace: 'off' });
test.setTimeout(120000);
async function fixture(request: APIRequestContext) {
  const suffix = Date.now();
  const r = await request.post('/api/patients', { data: {
    fullName: `Draft Retention Fake ${suffix}`, nric: `FAKE-DRAFT-${suffix}`,
    dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000',
  } });
  expect(r.status()).toBe(200);
  return (await r.json()).patientId as string;
}
async function consult(page: Page, patientId: string) {
  await page.goto(`/patients/${patientId}`);
  await page.getByRole('tab', { name: 'Consult', exact: true }).click();
  await expect(page.getByTestId('consult-save-status')).toHaveText('Draft saved (server) — unsigned');
}
async function treatment(page: Page) {
  await page.getByRole('tab', { name: 'Treatment', exact: true }).click();
  await expect(page.getByTestId('composer-save-status')).toHaveText('Saved (server)');
}
async function diagnose(page: Page) {
  await page.locator('button', { hasText: 'Select or search diagnosis' }).click();
  await page.keyboard.type('Fake retained diagnosis');
  await page.getByRole('option').first().click();
}
test('server note survives reload; signing clears note; treatment survives reload and sign clears it', async ({ page, request }) => {
  const patientId = await fixture(request);
  await consult(page, patientId);
  await page.locator('[contenteditable=true]').first().fill('Fake durable unsigned clinical note');
  await diagnose(page);
  await expect(page.getByTestId('consult-save-status')).toHaveText('Draft saved (server) — unsigned');
  await page.getByTestId('consult-save-status').locator('..').screenshot({ path: path.join(shots, 'after-note-saved.png') });
  await page.reload();
  await page.getByRole('tab', { name: 'Consult', exact: true }).click();
  await expect(page.locator('[contenteditable=true]').first()).toContainText('Fake durable unsigned clinical note');
  await expect(page.locator('button', { hasText: 'Fake retained diagnosis' })).toBeVisible();
  await page.locator('[contenteditable=true]').first().screenshot({ path: path.join(shots, 'after-reload-retained.png') });
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(page.getByTestId('composer-save-status')).toHaveText('Saved (server)');
  const note = await (await request.get(`/api/consultations/draft?patientId=${patientId}`)).json();
  expect(note.draft).toEqual({ clinicalNotes: '', diagnosis: '' });
  await page.locator('input:visible').last().fill('para');
  await page.locator('button', { hasText: /Paracetamol/ }).filter({ hasText: 'RM' }).first().click();
  await expect(page.getByTestId('composer-save-status')).toHaveText('Saved (server)');
  await page.reload(); await treatment(page);
  await expect(page.getByRole('button', { name: 'Remove Paracetamol', exact: true })).toBeVisible();
  await page.getByTestId('composer-save-status').locator('../..').screenshot({ path: path.join(shots, 'after-treatment-retained.png') });
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(page.getByText('Treatment Signed', { exact: true })).toBeVisible();
  await page.reload(); await treatment(page);
  await expect(page.getByRole('button', { name: 'Remove Paracetamol', exact: true })).toHaveCount(0);
});

test('other clinic cannot read or overwrite notes and plans; forged owner is ignored; stale versions rejected', async ({ request }) => {
  const patientId = await fixture(request);
  const read = await (await request.get(`/api/consultations/draft?patientId=${patientId}`)).json();
  const body = { patientId, clinicalNotes: 'Fake private clinic draft', diagnosis: 'Fake', version: read.version };
  expect((await request.post('/api/consultations/draft', { data: body })).ok()).toBeTruthy();
  expect((await request.post('/api/consultations/draft', { data: { ...body, clinicalNotes: 'Stale fake' } })).status()).toBe(409);
  const scoped = await request.storageState();
  const cookies = scoped.cookies.map(c => c.name === 'medplum-clinic' ? { ...c, value: 'other-clinic-fake' } : c);
  const { request: pwRequest } = await import('@playwright/test');
  const foreign = await pwRequest.newContext({ baseURL: 'http://localhost:3210', storageState: { cookies, origins: [] } });
  for (const endpoint of [
    `/api/consultations/draft?patientId=${patientId}`,
    `/api/consultations/plan?patientId=${patientId}&draftId=forged`,
  ]) expect([403, 404]).toContain((await foreign.get(endpoint)).status());
  expect([403, 404]).toContain((await foreign.post('/api/consultations/draft', { data: body })).status());
  const own = await (await request.get(`/api/consultations/draft?patientId=${patientId}&practitioner=forged&clinicId=forged`)).json();
  expect(own.draft.clinicalNotes).toBe(body.clinicalNotes);
  await foreign.dispose();
});

test('failed note save retains text, guards navigation/unload, and Retry persists it', async ({ page, request }) => {
  const patientId = await fixture(request);
  await consult(page, patientId);
  await page.route('**/api/consultations/draft', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { error: 'Fake draft outage' } }) : route.continue());
  await page.locator('[contenteditable=true]').first().fill('Fake text preserved through outage');
  await expect(page.getByTestId('consult-save-status')).toContainText('Failed to save draft');
  let prompts = 0;
  page.on('dialog', dialog => { prompts++; void dialog.dismiss(); });
  await page.locator('a[href="/patients"]').first().click();
  expect(prompts).toBe(1); expect(page.url()).toContain(patientId);
  await page.reload({ timeout: 2000 }).catch(() => {});
  expect(prompts).toBe(2);
  await expect(page.locator('[contenteditable=true]').first()).toContainText('Fake text preserved through outage');
  await page.unroute('**/api/consultations/draft');
  await page.getByRole('button', { name: 'Retry draft save' }).click();
  await expect(page.getByTestId('consult-save-status')).toHaveText('Draft saved (server) — unsigned');
  await page.reload();
  await page.getByRole('tab', { name: 'Consult', exact: true }).click();
  await expect(page.locator('[contenteditable=true]').first()).toContainText('Fake text preserved through outage');
});

test('a signed note with failed cleanup cannot be signed twice; cleanup retry clears it', async ({ page, request }) => {
  const patientId = await fixture(request);
  await consult(page, patientId);
  await page.locator('[contenteditable=true]').first().fill('Fake note with interrupted cleanup');
  await diagnose(page);
  await expect(page.getByTestId('consult-save-status')).toHaveText('Draft saved (server) — unsigned');
  let signs = 0;
  page.on('request', r => { if (new URL(r.url()).pathname === '/api/consultations' && r.method() === 'POST') signs++; });
  await page.route('**/api/consultations/draft', route => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 503, json: { error: 'Fake cleanup outage' } }) : route.continue());
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(page.getByTestId('composer-save-status')).toBeVisible();
  await page.getByRole('tab', { name: 'Consult', exact: true }).click();
  await expect(page.getByTestId('consult-save-status')).toHaveText('Consult signed — saved draft cleanup failed');
  await expect(page.getByRole('button', { name: 'Sign', exact: true })).toBeDisabled();
  await page.unroute('**/api/consultations/draft');
  await page.getByRole('button', { name: 'Retry draft cleanup' }).click();
  await expect(page.getByTestId('consult-save-status')).toHaveText('Draft saved (server) — unsigned');
  expect(signs).toBe(1);
  const result = await (await request.get(`/api/consultations/draft?patientId=${patientId}`)).json();
  expect(result.draft).toEqual({ clinicalNotes: '', diagnosis: '' });
});
