import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { test, expect } from '@playwright/test';
import { loginClinicContext } from '../lib/clinic-login';

test.use({ trace: 'off', screenshot: 'off', storageState: { cookies: [], origins: [] } });

function credentials(demo: boolean) {
  if (demo) {
    for (const file of [
      new URL('../.secrets/demo-login.env', import.meta.url),
      '/home/dev/ai-runner/ucc/secrets/demo-login.env',
    ]) {
      try {
        const { DEMO_CLINIC_EMAIL: email, DEMO_CLINIC_PASSWORD: password } = parseEnv(readFileSync(file, 'utf8'));
        if (email && password) return { email, password };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  }
  try {
    return {
      email: process.env.UCC_USER || (demo ? '' : 'doctor@ucc.local'),
      password: process.env.UCC_PASSWORD || readFileSync(new URL('../.secrets/pw', import.meta.url), 'utf8').trim(),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}

test('fake clinic visit from registration through checkout, re-check-in and uploaded files', async ({ page, baseURL }) => {
  const target = new URL(baseURL || '');
  const demo = target.origin === 'https://demo.drhidayat.com';
  if (!demo && !(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname))) {
    throw new Error('This QA regression is restricted to the loopback dev app and the clinic demo.');
  }
  const login = credentials(demo);
  test.skip(!login?.email || !login.password, 'Clinic login credentials unavailable');
  await page.context().route('**/*', (route) => {
    const url = new URL(route.request().url());
    return url.origin === target.origin ? route.continue() : route.abort();
  });
  const session = await loginClinicContext(page.request, login!);
  expect(session.status(), 'Clinic login HTTP status').toBe(200);

  const suffix = Date.now().toString().slice(-9);
  const name = `E2E Fake 1008 ${suffix}`;
  const nric = `9203${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}-14-${suffix.slice(-4)}`;
  const chiefComplaint = 'QA fake check-in complaint - sore throat';
  const serviceName = `E2E Fake Service 1008 ${suffix}`;
  const toast = (text: string) => expect(page.locator('[data-sonner-toast]').getByText(text, { exact: true })).toBeVisible();
  const queueRow = page.getByRole('row').filter({ hasText: name });
  const subscriptionFailures: number[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/api/labs/subscription' && response.status() >= 500) subscriptionFailures.push(response.status());
  });
  let patientId = '';
  let appointmentId = '';
  let procedureId = '';
  let labId = '';
  let queued = false;

  try {
    await test.step('register and verify the allergy', async () => {
      await page.goto('/patients/new');
      await page.locator('[name=fullName]').fill(name);
      await page.locator('[name=nric]').fill(nric);
      await page.locator('[name=nric]').blur();
      await page.getByRole('combobox').filter({ hasText: /Select gender|Male|Female/ }).click();
      await page.getByRole('option', { name: 'Male', exact: true }).click();
      await page.locator('[name=phone]').fill('0100001008');
      await page.locator('[name=address]').fill('1008 Jalan Ujian, Kuala Lumpur');
      await page.locator('[name="medicalHistory.allergies"]').fill('Penicillin');
      const saved = page.waitForResponse((r) => /^\/api\/patients(?:\/intake-pilot)?$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Register Patient' }).click();
      const response = await saved;
      expect(response.status()).toBe(200);
      patientId = (await response.json()).patientId;
      await toast('Patient registered');
      await page.waitForURL(`**/patients/${patientId}/check-in`);
      await page.goto(`/patients/${patientId}`);
      await expect(page.getByText('Penicillin', { exact: true }).first()).toBeVisible();
    });

    await test.step('book a fake appointment through the clinic staff picker', async () => {
      await page.goto('/appointments/new');
      await page.getByRole('combobox').filter({ hasText: 'Search patient' }).click();
      await page.getByPlaceholder('Search patient...').fill(name);
      await page.getByRole('option', { name: new RegExp(name) }).click();
      await page.getByRole('combobox').filter({ hasText: 'Select clinician' }).click();
      await page.getByRole('option').first().click();
      const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
      await page.locator('input[type=date]').fill(tomorrow);
      await page.getByRole('button', { name: 'Check slots' }).click();
      await page.getByRole('button', { name: /^\d{2}:\d{2}$/ }).first().click();
      const booked = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/scheduling/manual-book' && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Create appointment' }).click();
      const response = await booked;
      expect(response.ok()).toBe(true);
      appointmentId = (await response.json()).appointmentId;
      await page.waitForURL(/\/appointments\/(?!new)[A-Za-z0-9.-]+$/);
    });

    const fixture = await page.request.post('/api/procedures', {
      data: { name: serviceName, category: 'QA', defaultPrice: 5 },
    });
    expect(fixture.ok(), 'Create fake billable service').toBe(true);
    const procedure = await fixture.json();
    procedureId = procedure.procedureId || procedure.id;

    let firstNumber = '';
    let consultationId = '';
    await test.step('check in and sign a consultation with distinct clinical notes', async () => {
      await page.goto(`/patients/${patientId}/check-in`);
      await page.locator('#chief-complaint').fill(chiefComplaint);
      queued = true;
      await page.getByRole('button', { name: /Complete check-in/ }).click();
      await toast('Check-in complete');
      await page.waitForURL('**/dashboard');
      await expect(queueRow).toBeVisible();
      firstNumber = (await queueRow.getByRole('cell').first().innerText()).trim();
      await queueRow.getByRole('button').last().click();
      await page.getByRole('menuitem', { name: /Start Consultation/i }).click();
      await page.waitForURL(`**/patients/${patientId}`);
      await page.getByRole('button', { name: 'Start consult' }).click();
      await page.locator('[contenteditable=true]').first().fill('S: Synthetic clinical note. O: Examination normal.');
      await page.getByRole('combobox').filter({ hasText: 'Select or search diagnosis' }).click();
      await page.getByPlaceholder('Search diagnosis, ICD-10, or SNOMED...').fill('QA fake diagnosis');
      await page.getByRole('option', { name: /Use custom diagnosis/i }).click();
      const signed = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/consultations' && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Sign', exact: true }).click();
      const response = await signed;
      expect(response.status()).toBe(200);
      consultationId = (await response.json()).consultationId;
      await toast('Consult signed');
    });

    await test.step('sign one treatment line with quantity two and place a lab order', async () => {
      const search = page.getByPlaceholder('Search medicines, services, documents...');
      const pick = page.getByRole('button', { name: `${serviceName} Service RM 5.00`, exact: true });
      await search.fill(serviceName);
      await pick.click();
      await search.fill(serviceName);
      await pick.click();
      await expect(page.getByText(/2 × RM 5\.00/)).toHaveCount(1);
      const ordered = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/orders' && r.request().method() === 'POST');
      await page.getByRole('button', { name: 'Sign', exact: true }).click();
      expect((await ordered).ok()).toBe(true);

      const catalog = await page.request.get('/api/catalogs?type=lab');
      expect(catalog.ok()).toBe(true);
      if (!(await catalog.json()).items?.some((item: { active: boolean }) => item.active)) {
        const lab = await page.request.post('/api/catalogs', {
          data: { type: 'lab', name: `Fake Lab 1008 ${suffix}`, code: '58410-2', system: 'http://loinc.org', defaultPrice: 5 },
        });
        expect(lab.ok(), 'Create temporary lab fixture for an empty catalog').toBe(true);
        labId = (await lab.json()).id;
      }
      await page.goto(`/patients/${patientId}/labs-imaging`);
      await expect(page.getByText('Select laboratory tests and specify the order priority.')).toBeVisible();
      await page.getByRole('checkbox').first().click();
      await page.getByRole('button', { name: /Place Order/ }).click();
      await toast('Lab order placed successfully');
      expect(subscriptionFailures).toEqual([]);
    });

    await test.step('complete the visit and assign a fresh queue number on re-check-in', async () => {
      await page.goto(`/orders/checkout/${consultationId}?patientId=${patientId}`);
      await page.locator('#paid-amount').fill('10');
      await page.getByRole('button', { name: /Complete visitation/ }).click();
      await page.getByRole('button', { name: 'Complete', exact: true }).click();
      await toast('Visitation completed');
      queued = false;
      // The orders page removes the transient checkout query after showing its receipt.
      await page.waitForURL((url) => url.pathname === '/orders');
      await page.goto('/dashboard');
      await expect(page.getByRole('tab', { name: "Today's Queue" })).toBeVisible();
      const queue = await page.request.get('/api/queue');
      expect(queue.ok()).toBe(true);
      expect((await queue.json()).patients.some((patient: { id: string }) => patient.id === patientId)).toBe(false);
      await expect(queueRow).toHaveCount(0);
      await page.goto(`/patients/${patientId}/check-in`);
      await page.locator('#chief-complaint').fill('QA fake second visit');
      await page.getByRole('button', { name: /Complete check-in/ }).click();
      queued = true;
      await page.waitForURL('**/dashboard');
      await expect(queueRow).toBeVisible();
      await expect(queueRow.getByRole('cell').first()).not.toHaveText(firstNumber);
    });

    await test.step('show the original complaint and load the uploaded files list', async () => {
      await page.goto(`/patients/${patientId}`);
      await page.getByRole('tab', { name: 'Consultation History' }).click();
      await expect(page.getByRole('cell', { name: chiefComplaint, exact: true })).toBeVisible();
      const documents = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/documents' && r.request().method() === 'GET');
      await page.getByRole('tab', { name: 'Documents' }).click();
      expect((await documents).status()).toBe(200);
    });
  } finally {
    if (queued && patientId) await page.request.delete('/api/queue', { data: { patientId } }).catch(() => {});
    if (appointmentId) await page.request.delete('/api/appointments', { data: { appointmentId } }).catch(() => {});
    if (procedureId) await page.request.delete(`/api/procedures?id=${procedureId}`).catch(() => {});
    if (labId) await page.request.delete(`/api/catalogs?id=${labId}`).catch(() => {});
    if (patientId) await page.request.delete(`/api/patients?patientId=${patientId}`).catch(() => {});
  }
});
