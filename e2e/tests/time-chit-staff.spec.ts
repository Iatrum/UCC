import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { MedplumClient } from '@medplum/core';
import { fhir } from '../lib/fhir';
import { BASE, MEDPLUM, MEDPLUM_ADMIN } from '../lib/env';

const require = createRequire(import.meta.url);
const { normalizeEnabledModuleIds } = require('../../lib/module-settings.ts');

test.use({ trace: 'off' });
test.setTimeout(240_000);

test('staff can issue, reopen and print a Time Chit without a module toggle', async ({ page, request, playwright }) => {
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
  const m = await fhir();
  const patientResource = await m.readResource('Patient', patientId);
  const clinicId = patientResource.identifier?.find(i => i.system === 'clinic')?.value!;
  expect(['demo', 'clinicb', 'clinicc', 'clinicd']).toContain(clinicId);
  // The letterhead is the same /api/organization record MC and referrals print (practice-level, not per-clinic).
  const orgRes = await request.get('/api/organization');
  expect(orgRes.status()).toBe(200);
  const letterhead: string = (await orgRes.json()).organization?.name;
  expect(letterhead).toBeTruthy();
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
  // It appears in this patient's documents list as a single Time Chit entry.
  await expect(page.getByRole('button', { name: /^Time Chit/ })).toHaveCount(1);
  await page.getByRole('button', { name: /^Time Chit/ }).click();
  const preview = page.frameLocator('iframe[title="Document preview"]');
  // The print iframe is off-screen (aria-hidden), so there we assert exactly-one presence instead of visibility.
  const checkSheet = async (sheet: ReturnType<typeof page.frameLocator>, shown: boolean) => {
    await (shown ? expect(sheet.getByText('TIME CHIT / SURAT MASA')).toBeVisible() : expect(sheet.getByText('TIME CHIT / SURAT MASA')).toHaveCount(1));
    await (shown ? expect(sheet.getByText(fullName, { exact: true })).toBeVisible() : expect(sheet.getByText(fullName, { exact: true })).toHaveCount(1));
    await (shown ? expect(sheet.getByText(`FAKE-TCS-${suffix}`, { exact: true })).toBeVisible() : expect(sheet.getByText(`FAKE-TCS-${suffix}`, { exact: true })).toHaveCount(1));
    await expect(sheet.locator('.clinic-name')).toHaveText(letterhead);
    await expect(sheet.locator('.cert-para')).toContainText(/19 Nov 2026\s+from\s+09:00\s+to\s+10:30\s+\(1\.5 hours\)/);
    await (shown ? expect(sheet.getByText('Dr Fake Attendance', { exact: true })).toBeVisible() : expect(sheet.getByText('Dr Fake Attendance', { exact: true })).toHaveCount(1));
    await (shown ? expect(sheet.getByText('not a Medical Certificate')).toBeVisible() : expect(sheet.getByText('not a Medical Certificate')).toHaveCount(1));
  };
  await checkSheet(preview, true);

  await page.getByRole('button', { name: 'Print / Save PDF' }).click();
  const print = page.frameLocator('iframe[aria-hidden="true"]');
  await expect(print.getByText('TIME CHIT / SURAT MASA')).toHaveCount(1);
  await checkSheet(print, false);

  // A user from a different clinic cannot read the chit (app API and raw FHIR). Fake user, removed afterwards.
  const foreignName = `tcs-foreign-${suffix}`;
  let foreignOrg: any, foreignAccount: any, foreignContext: any, staff: MedplumClient | undefined, practitionerId: string | undefined;
  try {
    foreignOrg = await m.createResource({ resourceType: 'Organization', name: 'Time Chit Staff Fake foreign clinic', identifier: [{ system: 'clinic', value: foreignName }] });
    foreignAccount = await m.createResource({ resourceType: 'HealthcareService', active: true, identifier: [{ system: 'clinic', value: foreignName }], providedBy: { reference: `Organization/${foreignOrg.id}` } });
    const admin = await playwright.request.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
    expect((await admin.post('/api/auth/login', { data: MEDPLUM_ADMIN })).status()).toBe(200);
    const email = `${foreignName}@example.invalid`, password = `Fake-only-${randomUUID()}!`;
    expect((await admin.post('/api/admin/users/invite', { data: { firstName: 'Fake', lastName: 'Foreign Staff', email, password, sendEmail: false, clinicId: foreignOrg.id } })).status()).toBe(200);
    await admin.dispose();
    practitionerId = (await m.searchOne('Practitioner', { telecom: email }))?.id;
    foreignContext = await playwright.request.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
    expect((await foreignContext.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
    expect([403, 404]).toContain((await foreignContext.get(`/api/consultations?id=${consultationId}`)).status());
    expect([403, 404]).toContain((await foreignContext.get(`/api/orders?consultationId=${consultationId}&patientId=${patientId}`)).status());
    staff = new MedplumClient({ baseUrl: MEDPLUM, fetch: globalThis.fetch.bind(globalThis) });
    const login = await staff.startLogin({ email, password });
    await staff.processCode(login.code!);
    const chit = (await m.searchResources('Procedure', { encounter: `Encounter/${consultationId}` }, { cache: 'no-cache' }))
      .find(p => JSON.parse(p.note?.[0]?.text || '{}').kind === 'time-chit')!;
    expect(chit).toBeTruthy();
    const headers = { Authorization: `Bearer ${staff.getAccessToken()}` };
    expect([403, 404]).toContain((await fetch(`${MEDPLUM}fhir/R4/Procedure/${chit.id}`, { headers })).status);
    const search = await fetch(`${MEDPLUM}fhir/R4/Procedure?_id=${chit.id}`, { headers });
    expect([200, 403]).toContain(search.status);
    if (search.ok) expect((await search.json()).entry || []).toHaveLength(0);
  } finally {
    await foreignContext?.dispose();
    await staff?.signOut();
    if (practitionerId) {
      for (const membership of await m.searchResources('ProjectMembership', { profile: `Practitioner/${practitionerId}` })) await m.deleteResource('ProjectMembership', membership.id!);
      for (const role of await m.searchResources('PractitionerRole', { practitioner: `Practitioner/${practitionerId}` })) await m.deleteResource('PractitionerRole', role.id!);
      await m.deleteResource('Practitioner', practitionerId);
    }
    if (foreignAccount) await m.deleteResource('HealthcareService', foreignAccount.id);
    if (foreignOrg) await m.deleteResource('Organization', foreignOrg.id);
  }
});
