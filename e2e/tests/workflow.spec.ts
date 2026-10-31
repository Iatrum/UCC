import { test, expect, Page } from '@playwright/test';
import { watch, shot, uiLogin, saveJson, known, Issue } from '../lib/app';
import { byPatient, fhir } from '../lib/fhir';
import { RUN, POCT_KEY } from '../lib/env';

// Full patient journey "in and out", one shared browser page, serial.
// Core-flow asserts are hard; known-bug probes are collected and asserted together in the final test.
test.describe.configure({ mode: 'serial' });
let page: Page; let step = 'init';
const issues: Issue[] = []; const bugs: string[] = []; const facts: Record<string, any> = { run: RUN };
const bug = (ok: boolean, msg: string) => { known(ok, msg); if (!ok) bugs.push(msg); };
const name = `E2E Fake ${RUN}`;
const nric = `9203${String(1 + (Number(RUN.slice(-2)) % 28)).padStart(2, '0')}-14-${RUN.slice(-4)}`; // valid YYMMDD
const stubPlan = (p: Page) => p.route('**/api/consultations/plan**', r => r.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ success: true, persistenceAvailable: false, plan: { entries: [], summary: {} } }) }));

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  page = await ctx.newPage(); watch(page, issues, () => step);
});
test.afterAll(async () => { saveJson('workflow-results.json', { facts, bugs, issues }); await page?.context().close(); });
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await shot(page, `FAIL-${step}`); });

test('01 login', async () => {
  step = '01-login'; await uiLogin(page); await shot(page, '01-dashboard');
});

test('02 register patient', async () => {
  step = '02-register';
  await page.goto('/patients/new');
  await page.fill('[name=fullName]', name); await page.fill('[name=nric]', nric); await page.locator('[name=nric]').blur();
  await page.selectOption('select', 'male').catch(() => {});
  await page.fill('[name=email]', `e2e.${RUN}@example.test`); await page.fill('[name=phone]', '0123456789');
  await page.fill('[name=address]', '1 Jalan Ujian, Kuala Lumpur'); await page.fill('[name=postalCode]', '50000');
  await page.fill('[name="emergencyContact.name"]', 'Aminah Fake'); await page.fill('[name="emergencyContact.relationship"]', 'Spouse');
  await page.fill('[name="emergencyContact.phone"]', '0198765432'); await page.fill('[name="medicalHistory.allergies"]', 'Penicillin');
  await shot(page, '02-register-filled');
  await page.getByRole('button', { name: 'Register Patient' }).click();
  await page.waitForURL(/\/patients\/[0-9a-f-]{36}\/check-in/, { timeout: 120_000 });
  facts.patientId = page.url().match(/patients\/([0-9a-f-]{36})/)![1];
  const p: any = await (await fhir()).readResource('Patient', facts.patientId);
  expect(JSON.stringify(p.identifier)).toContain(nric);
  const allergies = await byPatient('AllergyIntolerance', facts.patientId);
  expect(allergies.length).toBeGreaterThan(0);
  bug(!!allergies[0].clinicalStatus, 'AllergyIntolerance created without clinicalStatus');
});

test('03 check-in + triage vitals -> queue', async () => {
  step = '03-checkin';
  await page.fill('#chief-complaint', 'Fever and sore throat x3 days (E2E fake)');
  // BP sys, BP dia, HR, RR, Temp, SpO2, Pain(0-10), Weight, Height
  const vals = ['128', '82', '96', '18', '38.4', '98', '3', '70', '170'];
  const nums = page.locator('input[type=number]');
  for (let i = 0; i < Math.min(vals.length, await nums.count()); i++) await nums.nth(i).fill(vals[i]);
  await shot(page, '03-checkin-filled');
  await page.getByRole('button', { name: /Complete check-in/ }).click();
  await page.waitForURL(/dashboard/, { timeout: 120_000 });
  await expect(page.locator('tr', { hasText: name })).toBeVisible({ timeout: 60_000 });
  await shot(page, '04-dashboard-queue');
  const enc = await byPatient('Encounter', facts.patientId);
  const obs = await byPatient('Observation', facts.patientId);
  facts.triage = { encounters: enc.map(e => e.status), observations: obs.length };
  expect(enc.length).toBeGreaterThan(0); expect(obs.length).toBeGreaterThanOrEqual(9);
});

test('04 start consultation from queue, notes + diagnosis, Sign', async () => {
  step = '04-consult';
  await page.locator('tr', { hasText: name }).locator('button').last().click();
  await page.getByRole('menuitem', { name: /Start Consultation/i }).click();
  await page.waitForURL(new RegExp(facts.patientId), { timeout: 120_000 });
  await page.getByRole('button', { name: 'Start consult' }).click();
  await page.locator('[contenteditable=true]').first().click();
  await page.keyboard.type('S: Fever, sore throat 3/7. O: T 38.4, tonsils inflamed. A: Acute pharyngitis. P: symptomatic, MC 2 days. (E2E fake)');
  await page.locator('button', { hasText: 'Select or search diagnosis' }).click();
  await page.keyboard.type('pharyng');
  await page.locator('[role=option]', { hasText: 'J02.9' }).first().dispatchEvent('click');
  await expect(page.locator('button', { hasText: 'Acute pharyngitis' })).toBeVisible();
  await shot(page, '05-consult-filled');
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await expect(page.getByText('Order', { exact: true })).toBeVisible({ timeout: 90_000 }); // treatment composer opens
  await shot(page, '06-consult-signed-composer');
  const cond = await byPatient('Condition', facts.patientId);
  expect(cond.map(c => c.code?.text || c.code?.coding?.[0]?.display).join()).toContain('pharyngitis');
});

async function pick(q: string, re: RegExp) {
  const s = page.locator('input:visible').last();
  await s.fill(q);
  const btn = page.locator('button', { hasText: re }).filter({ hasText: 'RM' }).first();
  const n = await btn.count(); if (n) await btn.click(); await page.waitForTimeout(1200); return n;
}

test('05 composer without Firebase (real autosave path)', async () => {
  step = '05-composer-real';
  const resp = page.waitForResponse(r => r.url().includes('/api/consultations/plan') && r.request().method() === 'POST', { timeout: 60_000 }).catch(() => null);
  await pick('para', /Paracetamol/);
  const pr = await resp; facts.planPostStatus = pr?.status();
  await page.waitForTimeout(3000);
  const kept = await page.getByText(/1 × RM 0\.50/).count() > 0;
  await shot(page, '07-composer-item-rolled-back');
  facts.composerKeepsItemWithoutFirebase = kept;
  bug(kept, 'Composer rolls back every added item when /api/consultations/plan (Firestore) fails; treatment cannot be signed without Firebase, while UI says "All changes autosaved"');
});

test('06 composer (plan API stubbed as persistence-unavailable): meds, services, labs, imaging, MC, referral -> Sign', async () => {
  step = '06-composer';
  await stubPlan(page);
  await page.reload(); await page.getByRole('tab', { name: 'Treatment' }).click();
  await page.waitForTimeout(3000); await page.keyboard.press('Escape');
  const found: Record<string, number> = {};
  for (const [q, re] of [['para', /Paracetamol/], ['consult', /Consultation/], ['full blood', /Full Blood/], ['chest', /Chest X-ray/],
    ['dressing', /Wound dressing/], ['medical', /medical certificate/i], ['referral', /referral letter/i]] as const) found[q] = await pick(q, re);
  found['ultrasound(US modality)'] = await page.locator('input:visible').last().fill('ultrasound').then(() => page.waitForTimeout(1200)).then(() => page.locator('button', { hasText: /Ultrasound/ }).count());
  await page.locator('input:visible').last().fill('');
  facts.composerSearch = found;
  bug(found['ultrasound(US modality)'] > 0, 'Imaging catalog items with modality other than DX (US/CT/MRI) are hidden from the composer');
  // MC detail
  const mc = page.locator('text=MEDICAL CERTIFICATE (MC)').last();
  if (await mc.count()) { await mc.click(); await page.waitForTimeout(2000);
    const dlg = page.locator('[role=dialog][data-state=open]');
    if (await dlg.count()) { await shot(page, '08-mc-dialog'); await dlg.locator('input').first().fill('2');
      const dn = dlg.getByPlaceholder('Dr. ...'); if (await dn.count()) await dn.fill('Dr Fake Doctor');
      await dlg.getByRole('button').filter({ hasText: /Complete|Save|Done/ }).last().click().catch(() => {}); } }
  const ref = page.locator('text=REFERRAL LETTER').last();
  if (await ref.count()) { await ref.click(); await page.waitForTimeout(2000);
    const dlg = page.locator('[role=dialog][data-state=open]');
    if (await dlg.count()) { await dlg.locator('input').first().fill('ENT Clinic, Hospital Fake'); await shot(page, '09-referral-dialog');
      await dlg.getByRole('button').filter({ hasText: /Complete|Save|Done/ }).last().click().catch(() => {}); } }
  await shot(page, '10-composer-filled');
  await expect(page.getByText('Paracetamol').last()).toBeVisible();
  facts.composerTotal = await page.getByText(/Current order total/).innerText().catch(() => '');
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  await page.waitForTimeout(15000); await shot(page, '11-treatment-signed');
  const pid = facts.patientId;
  const [mr, sr, proc, docs, enc] = await Promise.all(['MedicationRequest', 'ServiceRequest', 'Procedure', 'DocumentReference', 'Encounter'].map(t => byPatient(t, pid)));
  facts.afterTreatment = { MedicationRequest: mr.length, ServiceRequest: sr.map((s: any) => s.code?.text), Procedure: proc.map((p: any) => `${p.code?.text}:${p.status}`), DocumentReference: docs.length, Encounter: enc.map((e: any) => e.status) };
  facts.labSR = sr.find((s: any) => /blood/i.test(s.code?.text || ''))?.id;
  expect(mr.length).toBeGreaterThan(0); expect(sr.length).toBeGreaterThanOrEqual(2);
  bug(!proc.some((p: any) => /^(Lab|Imaging):/.test(p.code?.text || '') && p.status === 'completed'), 'Lab/imaging orders are also written as Procedure status=completed at Sign (before being performed)');
  bug(docs.length > 0, 'MC / referral signed in composer do not create a DocumentReference (only a Procedure line)');
  bug(!mr.some((m: any) => !m.dosageInstruction?.length), 'MedicationRequest saved without dosage/frequency when none entered (no validation)');
});

test('07 lab result ingest -> Labs & Imaging tab', async ({ request }) => {
  step = '07-lab-results';
  expect(facts.labSR, 'FBC ServiceRequest id').toBeTruthy();
  const r = await request.post('/api/labs/receive', { headers: { 'x-api-key': POCT_KEY }, data: { serviceRequestId: facts.labSR, conclusion: 'Mild leukocytosis (FAKE)',
    results: [{ testCode: '718-7', testName: 'Haemoglobin', value: 13.9, unit: 'g/dL', referenceRange: '13-17' },
              { testCode: '6690-2', testName: 'White cell count', value: 12.4, unit: '10*9/L', referenceRange: '4-11', interpretation: 'high' }] } });
  facts.labReceiveNoStatus = `${r.status()} ${(await r.text()).slice(0, 200)}`;
  bug(r.ok(), '/api/labs/receive returns 500 when result.status is omitted (route validation does not require/default it)');
  const r2 = await request.post('/api/labs/receive', { headers: { 'x-api-key': POCT_KEY }, data: { serviceRequestId: facts.labSR, conclusion: 'Mild leukocytosis (FAKE)',
    results: [{ testCode: '718-7', testName: 'Haemoglobin', value: 13.9, unit: 'g/dL', referenceRange: '13-17', status: 'final', interpretation: 'normal' },
              { testCode: '6690-2', testName: 'White cell count', value: 12.4, unit: '10*9/L', referenceRange: '4-11', status: 'final', interpretation: 'high' }] } });
  facts.labReceive = `${r2.status()} ${(await r2.text()).slice(0, 200)}`;
  expect(r2.ok(), facts.labReceive).toBeTruthy();
  const dr = await byPatient('DiagnosticReport', facts.patientId);
  facts.diagnosticReports = dr.map((d: any) => `${d.code?.text}:${d.status}:${d.result?.length}`);
  expect(dr.length).toBeGreaterThan(0);
  await page.unroute('**/api/consultations/plan**').catch(() => {});
  await page.goto(`/patients/${facts.patientId}`);
  await page.getByRole('tab', { name: 'Labs & Imaging' }).click(); await page.waitForTimeout(5000);
  await shot(page, '12-patient-labs-tab');
  const txt = await page.locator('main').first().innerText();
  facts.labsTabShowsResult = /Haemoglobin|White cell|Full Blood/i.test(txt);
  expect(facts.labsTabShowsResult, 'Lab result visible in patient Labs & Imaging tab').toBeTruthy();
  await page.goto(`/patients/${facts.patientId}/labs-imaging`); await shot(page, '13-labs-imaging-page');
});

test('08 documents tab (MC / referral generation & print)', async () => {
  step = '08-documents';
  await page.goto(`/patients/${facts.patientId}`);
  await page.getByRole('tab', { name: 'Documents' }).click(); await page.waitForTimeout(4000);
  await shot(page, '14-documents-tab');
  const txt = await page.locator('main').first().innerText();
  facts.documentsTab = txt.split('Documents').pop()?.slice(0, 600);
});

test('09 billing checkout -> payment -> complete visitation', async () => {
  step = '09-checkout';
  await page.goto('/orders');
  await page.getByRole('link', { name }).click();
  await page.waitForURL(/orders\/checkout\//, { timeout: 120_000 });
  await page.waitForTimeout(6000); await shot(page, '15-checkout');
  const body = await page.locator('main').last().innerText(); facts.checkoutText = body.slice(0, 1500);
  const totalMatch = body.match(/Total[^\d]*RM\s*([\d.,]+)/i); facts.checkoutTotal = totalMatch?.[1];
  const paid = page.locator('#paid-amount');
  await paid.fill((totalMatch?.[1] || '0').replace(/,/g, ''));
  const preview = page.getByRole('button', { name: /Preview bill/ });
  if (await preview.isEnabled()) { await preview.click(); await page.waitForTimeout(2000); await shot(page, '16-bill-preview'); await page.keyboard.press('Escape'); }
  await page.getByRole('button', { name: /Complete visitation/ }).click();
  await page.getByRole('button', { name: 'Complete', exact: true }).click();
  await page.waitForURL(/checkout=completed/, { timeout: 120_000 });
  await shot(page, '17-checkout-completed');
  const m = await fhir();
  const inv = await m.searchResources('Invoice', { subject: `Patient/${facts.patientId}` }, { cache: 'no-cache' });
  facts.invoices = inv.map((i: any) => `${i.status}:${i.totalGross?.value ?? i.totalNet?.value}`);
  expect(inv.length).toBeGreaterThan(0);
  const pay = await m.searchResources('PaymentReconciliation' as any, { _count: '50', _sort: '-_lastUpdated' }, { cache: 'no-cache' }).catch(() => []);
  facts.payments = pay.length;
  const stock = await (await page.request.get('/api/inventory')).json();
  facts.paracetamolStockAfter = stock.medications?.find((x: any) => x.name === 'Paracetamol')?.stock;
  bug(facts.paracetamolStockAfter < 500, 'Dispensing/checkout does not decrement inventory stock (no MedicationDispense flow)');
  const q = await (await page.request.get('/api/queue')).json();
  facts.queueAfter = q.patients?.find((p: any) => p.id === facts.patientId)?.queueStatus ?? 'removed';
});

test('10 page smoke: reports, settings, POCT, PACS, admin', async () => {
  const routes = ['/dashboard', '/patients', '/appointments', '/orders', '/analytics', '/records', '/tasks', '/follow-up', '/inventory',
    '/poct', '/poct/new', '/pacs', '/settings', '/settings/catalogs', '/settings/documents', '/settings/check-in', '/settings/follow-up', '/admin'];
  const res: Record<string, string> = {};
  for (const r of routes) {
    step = 'smoke' + r; const before = issues.length;
    const t = Date.now(); let navs = 0; const onNav = () => navs++; page.on('framenavigated', onNav);
    await page.goto(r, { timeout: 90_000 }).catch(async () => { await page.waitForTimeout(5000); await page.goto(r, { timeout: 90_000 }).catch(e => (res[r] = 'GOTO ' + e.message.slice(0, 60))); });
    await page.waitForTimeout(3000); page.off('framenavigated', onNav);
    if (navs > 6) { res[r] = `REDIRECT-LOOP navs=${navs}`; bugs.push(`${r} redirect loop for logged-in non-admin (${navs} navigations in ~3s)`); }
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    res[r] ??= `${new URL(page.url()).pathname} ${Date.now() - t}ms errs=${issues.slice(before).filter(i => i.kind !== 'console' || !/401/.test(i.text)).length}`;
    await shot(page, 'smoke-' + (r.replace(/\//g, '_').slice(1) || 'root'));
  }
  facts.smoke = res;
  for (const [k, v] of Object.entries(res)) if (v.startsWith('GOTO')) bugs.push(`${k} failed to load: ${v.slice(0, 80)}`);
});

test('11 known-bug probes summary (expected to fail on the baseline)', async () => {
  step = '11-summary';
  for (const b of bugs.slice()) expect.soft(false, b).toBeTruthy();
});
