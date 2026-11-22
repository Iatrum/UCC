import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { BASE, MEDPLUM } from '../lib/env';

const require = createRequire(import.meta.url);
const { normalizeEnabledModuleIds } = require('../../lib/module-settings.ts');

test.use({ trace: 'off' });
test.setTimeout(240_000);

test('staff can issue, reopen and print a Time Chit without a module toggle', async ({ page, request }) => {
  expect(BASE).toMatch(/^http:\/\/(?:localhost|127\.0\.0\.1):[1-9]\d{3,4}$/);
  expect(MEDPLUM.replace(/\/$/, '')).toMatch(/^http:\/\/(?:localhost|127\.0\.0\.1):8113$/);

  const me = await request.get('/api/auth/me');
  expect(me.status()).toBe(200);
  const { authenticated, isAdmin, summary } = await me.json();
  expect(authenticated).toBe(true);
  expect(isAdmin).toBe(false);
  expect(summary.role).toBe('practitioner');

  const session = await request.get('/api/auth/medplum-session');
  expect(session.status()).toBe(200);
  expect(['demo', 'clinicb', 'clinicc', 'clinicd']).toContain((await session.json()).clinicId);
  expect(normalizeEnabledModuleIds(['appointments', 'time-chit'])).toEqual(['appointments']);

  const suffix = randomUUID().slice(0, 8);
  const fullName = `Time Chit Staff Fake ${suffix}`;
  const patient = await request.post('/api/patients', {
    data: { fullName, nric: `FAKE-TCS-${suffix}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000' },
  });
  expect(patient.status()).toBe(200);
  const { patientId } = await patient.json();
  const consultation = await request.post('/api/consultations', {
    data: { patientId, chiefComplaint: 'Fake attendance visit', diagnosis: 'Fake attendance' },
  });
  expect(consultation.status()).toBe(200);
  const { consultationId } = await consultation.json();

  await page.goto(`/patients/${patientId}`);
  await page.getByRole('tab', { name: 'Treatment', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search treatment catalog' }).fill('time chit');
  await page.getByRole('button', { name: /TIME CHIT.*RM/i }).click();
  await page.getByText('TIME CHIT', { exact: true }).click();

  const editor = page.getByRole('dialog');
  await editor.getByLabel('Attendance date').fill('2026-11-19');
  await editor.getByLabel('Time in', { exact: true }).fill('09:00');
  await editor.getByLabel('Time out', { exact: true }).fill('10:30');
  await editor.getByLabel("Doctor's name").fill('Dr Fake Attendance');
  await expect(editor.getByText('Duration: 1.5 hour(s)')).toBeVisible();
  await editor.getByRole('button', { name: 'Complete document' }).click();

  const [signed] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/orders' && response.request().method() === 'POST'),
    page.getByRole('button', { name: 'Sign', exact: true }).click(),
  ]);
  expect(signed.status()).toBe(200);
  await expect(page.getByText('Treatment Signed', { exact: true })).toBeVisible();

  const saved = await request.get(`/api/consultations?id=${consultationId}`);
  expect(saved.status()).toBe(200);
  const { procedures } = (await saved.json()).consultation as { procedures: { notes?: string }[] };
  const chits = procedures.map(procedure => JSON.parse(procedure.notes || '{}')).filter(document => document.kind === 'time-chit');
  expect(chits).toHaveLength(1);
  expect(chits[0]).toMatchObject({ status: 'completed', tcTimeIn: '09:00', tcTimeOut: '10:30', tcHours: '1.5' });

  await page.reload();
  await page.getByRole('tab', { name: 'Documents', exact: true }).click();
  await page.getByRole('button', { name: /^Time Chit/ }).click();
  const preview = page.frameLocator('iframe[title="Document preview"]');
  await expect(preview.getByText('TIME CHIT / SURAT MASA')).toBeVisible();
  await expect(preview.getByText(fullName, { exact: true })).toBeVisible();
  await expect(preview.getByText('Dr Fake Attendance', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Print / Save PDF' }).click();
  const print = page.frameLocator('iframe[aria-hidden="true"]');
  await expect(print.getByText('TIME CHIT / SURAT MASA')).toHaveCount(1);
  await expect(print.getByText(fullName, { exact: true })).toHaveCount(1);
});
