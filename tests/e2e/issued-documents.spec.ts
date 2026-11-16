import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

// This fixture is deliberately limited to the isolated local fake-data environment.
const passwordFile = process.env.UCC_TEST_PASSWORD_FILE || '/home/dev/iatrum-ucc/e2e/.secrets/pw';

test('Sign issues immutable MC and referral documents, supports retries and patient-page reprint', async ({ page, request }) => {
  const login = await request.post('/api/auth/login', { data: { email: process.env.UCC_TEST_USER || 'doctor@ucc.local', password: readFileSync(passwordFile, 'utf8').trim() } });
  expect(login.status()).toBe(200);
  const state = await request.storageState();
  if (process.env.UCC_TEST_CLINIC) state.cookies.push({ name: 'medplum-clinic', value: process.env.UCC_TEST_CLINIC, domain: '127.0.0.1', path: '/', expires: -1, httpOnly: false, secure: false, sameSite: 'Lax' });
  // Admin fixture explicitly chooses a fake clinic; never changes shared staff policies.
  await page.context().addCookies(state.cookies);
  const api = page.request;
  const run = Date.now();
  const patientResponse = await api.post('/api/patients', { data: {
    fullName: `FAKE Documents ${run}`, nric: `FAKE358B-${run}`, dateOfBirth: '1990-01-01', gender: 'male', phoneNumber: '0100000000',
  } });
  expect(patientResponse.status()).toBe(200);
  const { patientId } = await patientResponse.json();
  const consult = await api.post('/api/consultations', { data: { patientId, chiefComplaint: 'Fake clinical summary and findings', diagnosis: 'Fake diagnosis', notes: 'Fake treatment given' } });
  expect(consult.status()).toBe(200);
  const { consultationId } = await consult.json();
  const procedures = [
    { name: 'Medical Certificate', procedureId: 'letter-mc', category: 'documents', notes: JSON.stringify({ kind: 'mc', entryId: `mc-${run}`, status: 'draft', mcDays: '2', mcStartDate: '2026-12-31', mcDiagnosis: '' }) },
    { name: 'Referral Letter', procedureId: 'letter-referral', category: 'documents', notes: JSON.stringify({ kind: 'referral', entryId: `ref-${run}`, status: 'draft', referralTo: 'Fake Cardiology Department', referralDiagnosis: 'Fake reason', referralContent: 'Summary: fake\nFindings: fake\nTreatment given: fake <script>alert(1)</script>' }) },
  ];
  const invalid = [procedures[0], { ...procedures[1], notes: JSON.stringify({ kind: 'referral', entryId: 'invalid', status: 'draft', referralTo: '', referralContent: '' }) }];
  expect((await api.post('/api/orders', { data: { consultationId, procedures: invalid } })).status()).toBe(400);
  expect((await (await api.get(`/api/issued-documents?patientId=${patientId}`)).json()).documents).toHaveLength(0);
  // Ordinary edits save drafts; only the treatment Sign endpoint issues them.
  expect((await api.patch('/api/orders', { data: { consultationId, procedures } })).status()).toBe(200);
  expect((await (await api.get(`/api/issued-documents?patientId=${patientId}`)).json()).documents).toHaveLength(0);
  // Remove the saved draft to exercise the add-and-sign path used by the composer.
  expect((await api.patch('/api/orders', { data: { consultationId, procedures: [] } })).status()).toBe(200);
  const signed = await api.post('/api/orders', { data: { consultationId, procedures } });
  expect(signed.status()).toBe(200);
  const docs = (await (await api.get(`/api/issued-documents?patientId=${patientId}`)).json()).documents;
  expect(docs).toHaveLength(2);
  expect(docs.every((d: any) => d.status === 'final' && d.encounter === `Encounter/${consultationId}`)).toBe(true);
  const mc = docs.find((d: any) => d.title === 'Medical Certificate');
  const original = await (await api.get(`/api/issued-documents?id=${mc.id}`)).text();
  if (process.env.UCC_TEST_CLINIC) {
    const scopeCookie = { name: 'medplum-clinic', domain: '127.0.0.1', path: '/' };
    await page.context().addCookies([{ ...scopeCookie, value: 'clinicb' }]);
    expect((await api.get(`/api/issued-documents?patientId=${patientId}`)).status()).toBe(404);
    expect((await api.get(`/api/issued-documents?id=${mc.id}`)).status()).toBe(404);
    expect((await api.post('/api/orders', { data: { consultationId, procedures } })).status()).toBe(404);
    await page.context().addCookies([{ ...scopeCookie, value: process.env.UCC_TEST_CLINIC }]);
  }
  expect(original).toContain(`FAKE Documents ${run}`); expect(original).toContain(`FAKE358B-${run}`);
  expect(original).toContain('2027-01-01'); expect(original).not.toContain('<strong>Diagnosis');
  const referral = docs.find((d: any) => d.title === 'Referral Letter');
  const letter = await (await api.get(`/api/issued-documents?id=${referral.id}`)).text();
  expect(letter).toContain('Fake Cardiology Department'); expect(letter).toContain('Treatment given: fake &lt;script&gt;');
  expect((await api.post('/api/orders', { data: { consultationId, procedures } })).status()).toBe(200);
  expect((await (await api.get(`/api/issued-documents?patientId=${patientId}`)).json()).documents).toHaveLength(2);
  expect((await api.delete('/api/documents', { data: { id: mc.id } })).status()).toBe(403);
  expect((await api.patch('/api/documents', { data: { id: mc.id, title: 'Changed' } })).status()).toBe(403);
  expect((await api.patch('/api/patients', { data: { patientId, fullName: `FAKE Changed ${run}` } })).status()).toBe(200);
  expect(await (await api.get(`/api/issued-documents?id=${mc.id}`)).text()).toBe(original);
  const hydrated = page.waitForResponse(r => r.url().includes('/api/auth/me') && r.status() === 200);
  await page.goto(`/patients/${patientId}`, { timeout: 120_000 });
  await hydrated;
  await page.getByRole('tab', { name: 'Documents', exact: true }).click();
  await expect(page.getByRole('button', { name: 'View / reprint' })).toHaveCount(2, { timeout: 30_000 });
  await page.getByRole('button', { name: 'View / reprint' }).first().click();
  await expect(page.frameLocator('iframe[title="Issued document"]').locator('body')).toContainText(`FAKE Documents ${run}`);
  await expect(page.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
  // Assert the print button calls the stored document frame's print function.
  await page.locator('iframe[title="Issued document"]').evaluate((frame: HTMLIFrameElement) => { frame.contentWindow!.print = () => { frame.setAttribute('data-printed', 'yes'); }; });
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.locator('iframe[title="Issued document"]')).toHaveAttribute('data-printed', 'yes');
});

test('issued document routes require authentication', async ({ request }) => {
  expect((await request.get('/api/issued-documents?patientId=fake')).status()).toBe(401);
});
