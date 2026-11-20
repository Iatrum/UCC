import { test, expect } from '@playwright/test';
import { fhir } from '../lib/fhir';
import { uiLogin } from '../lib/app';

// Task 703: registration + check-in UI, queue invalid-status 400, clinic-scoped duplicate lookup. Fake data only.
test.use({ trace: 'off' });
const rnd = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0');
const day = () => String(1 + Math.floor(Math.random() * 28)).padStart(2, '0');
const mkNric = () => `9406${day()}-14-${rnd()}`;
const tag = `T703-${Date.now().toString(36)}`;
const created: string[] = [];
let legacy = '', legacy3 = '';
const payload = (nric: string, fullName: string) => ({ fullName, nric, dateOfBirth: '1994-06-15', gender: 'male', phone: '0123456789', address: '1 Jalan Ujian', email: `${tag}@example.test` });

test.afterAll(async () => { const m = await fhir(); for (const id of created) await m.deleteResource('Patient', id).catch(() => {}); });

test('registration + check-in UI, queue 400s, scoped dedupe', async ({ page }) => {
  await uiLogin(page);
  const nric = mkNric(); const name = `Fake ${tag}`;
  await page.goto('/patients/new');
  await expect(async () => { await page.fill('[name=fullName]', name); await page.fill('[name=nric]', nric); await expect(page.locator('[name=nric]')).toHaveValue(nric); }).toPass({ timeout: 30_000 });
  await page.locator('[name=nric]').blur();
  await page.selectOption('select', 'male').catch(() => {});
  await page.fill('[name=email]', `${tag}@example.test`); await page.fill('[name=phone]', '0123456789');
  await page.fill('[name=address]', '1 Jalan Ujian'); await page.fill('[name=postalCode]', '50000');
  await page.fill('[name="emergencyContact.name"]', 'Fake Kin'); await page.fill('[name="emergencyContact.relationship"]', 'Spouse'); await page.fill('[name="emergencyContact.phone"]', '0198765432');
  await page.getByRole('button', { name: 'Register Patient' }).click();
  await page.waitForURL(/\/patients\/[0-9a-f-]{36}\/check-in/, { timeout: 120_000 });
  const pid = page.url().match(/patients\/([0-9a-f-]{36})/)![1]; created.push(pid);
  await page.fill('#chief-complaint', 'Fake complaint');
  const nums = page.locator('input[type=number]'); const vals = ['120', '80', '80', '16', '37', '98', '2', '70', '170'];
  for (let i = 0; i < Math.min(vals.length, await nums.count()); i++) await nums.nth(i).fill(vals[i]);
  await page.getByRole('button', { name: /Complete check-in/ }).click();
  await page.waitForURL(/dashboard/, { timeout: 120_000 });
  await expect(page.locator('tr', { hasText: name })).toBeVisible({ timeout: 60_000 });

  const call = async (method: string, url: string, body: unknown) => page.evaluate(async ([m, u, b]) => {
    const r = await fetch(u as string, { method: m as string, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b), credentials: 'include' });
    return { status: r.status, text: await r.text() };
  }, [method, url, body]);
  const api = { patch: async (u: string, o: any) => { const r = await call('PATCH', u, o.data); return { status: () => r.status, text: async () => r.text, json: async () => JSON.parse(r.text) }; },
    post: async (u: string, o: any) => { const r = await call('POST', u, o.data); return { status: () => r.status, text: async () => r.text, json: async () => JSON.parse(r.text) }; } };
  // queue PATCH: invalid statuses -> 400, valid -> 200
  for (const bad of ['bogus', 42, {}, 'ARRIVED']) {
    const r = await api.patch('/api/queue', { data: { patientId: pid, status: bad } });
    expect(r.status(), `status=${JSON.stringify(bad)} ${await r.text()}`).toBe(400);
  }
  expect((await api.patch('/api/queue', { data: { patientId: pid, status: 'waiting' } })).status()).toBe(200);
  expect((await api.patch('/api/queue', { data: { patientId: pid, status: null } })).status()).toBe(200);

  // duplicate lookup
  const m = await fhir();
  const p: any = await m.readResource('Patient', pid);
  const clinic = p.identifier.find((i: any) => i.system === 'clinic').value as string;
  const dup = async (n: string) => (await api.post('/api/patients', { data: payload(n, `Fake dup ${tag}`) })).status();
  expect(await dup(nric)).toBe(409); // same clinic, tagged
  // foreign clinic patient with same NRIC (nric and ic systems) must NOT block, and must not be read
  const foreign = mkNric();
  const f1: any = await m.createResource({ resourceType: 'Patient', name: [{ text: `Fake foreign ${tag}` }], identifier: [{ system: 'nric', value: foreign }, { system: 'clinic', value: `other-${tag}` }], managingOrganization: { reference: `Organization/other-${tag}` } });
  created.push(f1.id);
  const r1 = await api.post('/api/patients', { data: payload(foreign, `Fake reg ${tag}`) });
  expect(r1.status(), await r1.text()).toBeLessThan(300); created.push((await r1.json()).patientId ?? (await r1.json()).id ?? '');
  // legacy (no clinic tag) owned by reference whose id equals the clinic id (matchesClinic ownership)
  const l1: any = await m.createResource({ resourceType: 'Patient', name: [{ text: `Fake legacy ${tag}` }], identifier: [{ system: 'ic', value: legacy = mkNric() }], managingOrganization: { reference: `Organization/${clinic}` } });
  created.push(l1.id);
  expect(await dup(legacy)).toBe(409);
  // legacy patient owned by the OTHER org must not dedupe
  const l3: any = await m.createResource({ resourceType: 'Patient', name: [{ text: `Fake legacy3 ${tag}` }], identifier: [{ system: 'ic', value: legacy3 = mkNric() }], managingOrganization: { reference: `Organization/other-${tag}` } });
  created.push(l3.id);
  expect(await dup(legacy3)).toBeLessThan(300);
});
