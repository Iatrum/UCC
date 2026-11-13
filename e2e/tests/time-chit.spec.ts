import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { MedplumClient } from '@medplum/core';
import { fhir } from '../lib/fhir';
import { BASE, MEDPLUM, MEDPLUM_ADMIN, EVIDENCE } from '../lib/env';

// Fake records on local Medplum only; credential-bearing requests are never traced.
test.use({ trace: 'off' });
const moduleUrl = 'https://ucc.emr/organization-enabled-module-ids';
const defaults = ['appointments', 'inventory', 'analytics', 'follow-up'];
const details = { kind: 'time-chit', tcDate: '2026-11-14', tcTimeIn: '09:00', tcTimeOut: '10:30', tcHours: '999', tcDoctorName: 'Dr Fake Attendance', title: 'TIME CHIT', status: 'completed' };
const line = (patch = {}) => ({ name: 'TIME CHIT', procedureId: 'letter-time-chit', category: 'documents', price: 7, quantity: 1, notes: JSON.stringify({ ...details, ...patch }) });
async function openTreatment(page: Page, patientId: string) {
  // Exercise existing local draft fallback; clinical writes still hit local Medplum.
  await page.route('**/api/consultations/plan**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, persistenceAvailable: false, plan: { entries: [], summary: {} } }) }));
  await page.goto(`/patients/${patientId}`);
  await page.getByRole('tab', { name: 'Treatment', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search treatment catalog' })).toBeVisible();
}
async function search(page: Page, text: string) { await page.getByRole('textbox', { name: 'Search treatment catalog' }).fill(text); }

test('Time Chit toggle, composer, checkout, historical print, validation and clinic scope', async ({ page, request, playwright }) => {
  expect(BASE).toBe('http://localhost:3214');
  expect(MEDPLUM.replace(/\/$/, '')).toBe('http://localhost:8113');
  const m = await fhir(), suffix = randomUUID().slice(0, 8);
  const created = await request.post('/api/patients', { data: { fullName: `Time Chit Fake ${suffix}`, nric: `FAKE-TC-${suffix}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000' } });
  expect(created.status()).toBe(200);
  const { patientId } = await created.json();
  const patient = await m.readResource('Patient', patientId);
  const clinicId = patient.identifier?.find(i => i.system === 'clinic')?.value!;
  expect(['demo', 'clinicb', 'clinicc', 'clinicd']).toContain(clinicId);
  const org = (await m.searchOne('Organization', { identifier: `clinic|${clinicId}` }, { cache: 'no-cache' }))!;
  const original = org.extension?.find(e => e.url === moduleUrl);
  const toggle = async (enabled: boolean) => {
    const latest = await m.readResource('Organization', org.id!, { cache: 'no-cache' });
    const ids = (original?.valueString ? JSON.parse(original.valueString) : defaults).filter((id: string) => id !== 'time-chit');
    await m.updateResource({ ...latest, extension: [...(latest.extension || []).filter(e => e.url !== moduleUrl), { url: moduleUrl, valueString: JSON.stringify(enabled ? [...ids, 'time-chit'] : ids) }] });
  };
  let foreignOrg: any, foreignAccount: any, foreignContext: any, staff: MedplumClient | undefined, practitionerId: string | undefined;
  try {
    await toggle(false);
    const consultationResponse = await request.post('/api/consultations', { data: { patientId, chiefComplaint: 'Fake attendance visit', diagnosis: 'Fake test attendance' } });
    expect(consultationResponse.status()).toBe(200);
    const { consultationId } = await consultationResponse.json();
    await openTreatment(page, patientId);
    await search(page, 'time chit');
    await expect(page.getByRole('button', { name: /TIME CHIT.*RM/i })).toHaveCount(0);
    await expect(page.getByText(/No matches/)).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/time-chit-toggle-off.png`, fullPage: true });
    expect((await request.post('/api/consultations', { data: { patientId, chiefComplaint: 'Fake', diagnosis: 'Fake', procedures: [line()], clinicId: 'spoofed' } })).status()).toBe(403);
    expect((await request.post('/api/orders', { data: { consultationId, procedures: [line()], clinicId: 'spoofed' } })).status()).toBe(403);
    expect((await request.patch('/api/consultations', { data: { consultationId, procedures: [line()] } })).status()).toBe(403);
    for (const enabled of [false, true]) {
      await toggle(enabled); await openTreatment(page, patientId);
      for (const [query, title] of [['medical', /MEDICAL CERTIFICATE/], ['referral', /REFERRAL LETTER/]] as const) {
        await search(page, query);
        await page.getByRole('button', { name: title }).filter({ hasText: 'RM' }).first().click();
        await page.getByText(title).last().click();
        const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
        if (query === 'medical') await dialog.getByPlaceholder('Dr. ...').fill('Dr Fake MC');
        else await dialog.locator('textarea').fill('Fake referral content');
        await dialog.getByRole('button', { name: 'Complete document' }).click();
        await expect(dialog).toHaveCount(0);
      }
    }
    await search(page, 'time chit');
    await page.getByRole('button', { name: /TIME CHIT.*RM/i }).click();
    await page.getByText('TIME CHIT', { exact: true }).last().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Attendance date').fill(details.tcDate);
    await dialog.getByLabel('Time in', { exact: true }).fill('11:00');
    await dialog.getByLabel('Time out', { exact: true }).fill('10:30');
    await dialog.getByLabel("Doctor's name").fill(details.tcDoctorName);
    await dialog.getByRole('button', { name: 'Complete document' }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Time in', { exact: true }).fill('09:00');
    await expect(dialog.getByText('Duration: 1.5 hour(s)')).toBeVisible();
    await expect(page.frameLocator('iframe[title="Time Chit preview"]').getByText('TIME CHIT / SURAT MASA')).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/time-chit-composer-preview.png`, fullPage: true });
    await dialog.getByRole('button', { name: 'Complete document' }).click();
    const signResponse = page.waitForResponse(r => r.url().endsWith('/api/orders') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign', exact: true }).click();
    expect((await signResponse).status()).toBe(200);
    const saved = await request.get(`/api/consultations?id=${consultationId}`);
    expect(saved.status()).toBe(200);
    const savedProcedures = (await saved.json()).consultation.procedures;
    const timeChit = savedProcedures.find((p: any) => JSON.parse(p.notes || '{}').kind === 'time-chit');
    expect(JSON.parse(timeChit.notes)).toMatchObject({ ...details, tcHours: '1.5' });
    expect((await request.patch('/api/consultations', { data: { consultationId, procedures: savedProcedures.map((p: any) => p === timeChit ? { ...p, price: 7 } : p) } })).status()).toBe(200);
    await page.goto(`/orders/checkout/${consultationId}?patientId=${patientId}`); await page.getByRole('tab', { name: 'Documents', exact: true }).click();
    await expect(page.getByText('TIME CHIT', { exact: true })).toBeVisible();
    await expect(page.getByText(/7\.00/).first()).toBeVisible();
    await page.getByRole('button', { name: /Preview/i }).last().click();
    await expect(page.getByRole('button', { name: 'Print document' })).toBeVisible();
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Print document' }).click();
    const pdfPopup = await popupPromise;
    await expect.poll(() => pdfPopup.url()).toMatch(/^blob:/);
    await page.screenshot({ path: `${EVIDENCE}/time-chit-checkout-pdf.png`, fullPage: true });
    await pdfPopup.close();
    const resources = await m.searchResources('Procedure', { encounter: `Encounter/${consultationId}` }, { cache: 'no-cache' });
    const resource = resources.find(p => JSON.parse(p.note?.[0]?.text || '{}').kind === 'time-chit')!;
    expect(resource.identifier?.some(i => i.system === 'clinic' && i.value === clinicId)).toBe(true);
    const extended: any = await m.readResource('Procedure', resource.id!, { cache: 'no-cache', headers: { 'X-Medplum': 'extended' } });
    const account = await m.searchOne('HealthcareService', { identifier: `clinic|${clinicId}` });
    expect(extended.meta?.accounts?.map((a: any) => a.reference)).toContain(`HealthcareService/${account!.id}`);
    for (const invalid of [{ tcTimeOut: '08:00' }, { tcDate: '2026-02-30' }, { tcDoctorName: '' }, { tcTimeIn: '25:00' }]) {
      expect((await request.patch('/api/consultations', { data: { consultationId, procedures: [line(invalid)] } })).status()).toBe(409);
      expect((await m.readResource('Procedure', resource.id!)).id).toBe(resource.id);
    }
    await toggle(false);
    for (const procedures of [[line()], []]) {
      expect((await request.patch('/api/consultations', { data: { consultationId, procedures } })).status()).toBe(403);
      expect((await request.patch('/api/orders', { data: { consultationId, procedures } })).status()).toBe(403);
    }
    expect((await request.delete('/api/consultations', { data: { consultationId } })).status()).toBe(403);
    await page.goto(`/patients/${patientId}`); await page.getByRole('tab', { name: 'Documents', exact: true }).click();
    await page.getByRole('button', { name: /^Time Chit/ }).click();
    const preview = page.frameLocator('iframe[title="Document preview"]');
    await expect(preview.getByText('TIME CHIT / SURAT MASA')).toBeVisible();
    await expect(preview.getByText(/not a Medical Certificate/)).toBeVisible();
    await expect(preview.getByText('Dr Fake Attendance')).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/time-chit-historical-print.png`, fullPage: true });
    const printPromise = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Print / Save PDF' }).click();
    const print = await printPromise; await expect(print.getByText('TIME CHIT / SURAT MASA')).toBeVisible(); await print.close();
    await toggle(true);
    expect((await request.patch('/api/consultations', { data: { consultationId, procedures: [line()] } })).status()).toBe(200);

    foreignOrg = await m.createResource({ resourceType: 'Organization', name: 'Time Chit Fake foreign clinic', identifier: [{ system: 'clinic', value: `tc-${suffix}` }] });
    foreignAccount = await m.createResource({ resourceType: 'HealthcareService', active: true, identifier: [{ system: 'clinic', value: `tc-${suffix}` }], providedBy: { reference: `Organization/${foreignOrg.id}` } });
    const admin = await playwright.request.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
    expect((await admin.post('/api/auth/login', { data: MEDPLUM_ADMIN })).status()).toBe(200);
    const email = `time-chit-${suffix}@example.invalid`, password = `Fake-only-${randomUUID()}!`;
    expect((await admin.post('/api/admin/users/invite', { data: { firstName: 'Fake', lastName: 'Time Chit', email, password, sendEmail: false, clinicId: foreignOrg.id } })).status()).toBe(200);
    const adminBrowser = await page.context().browser()!.newContext({ storageState: await admin.storageState() });
    const adminPage = await adminBrowser.newPage();
    try {
      await adminPage.goto(`/admin/clinics/${org.id}`);
      const moduleSwitch = adminPage.getByRole('switch', { name: 'Toggle Time Chit (Surat Masa)' });
      await expect(moduleSwitch).toBeChecked();
      await moduleSwitch.uncheck();
      const save = adminPage.waitForResponse(r => r.url().includes(`/api/admin/clinics/${org.id}`) && r.request().method() === 'PATCH');
      await adminPage.getByRole('button', { name: 'Save Module Settings' }).click();
      expect((await save).status()).toBe(200);
      await adminPage.reload(); await expect(moduleSwitch).not.toBeChecked();
      await adminPage.screenshot({ path: `${EVIDENCE}/time-chit-admin-toggle.png`, fullPage: true });
      // A new clinic without a module-settings extension also starts off.
      await adminPage.goto(`/admin/clinics/${foreignOrg.id}`);
      await expect(adminPage.getByRole('switch', { name: 'Toggle Time Chit (Surat Masa)' })).not.toBeChecked();
    } finally { await adminBrowser.close(); }
    await admin.dispose(); practitionerId = (await m.searchOne('Practitioner', { telecom: email }))?.id;
    foreignContext = await playwright.request.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
    expect((await foreignContext.post('/api/auth/login', { data: { email, password } })).status()).toBe(200);
    expect([403, 404]).toContain((await foreignContext.get(`/api/consultations?id=${consultationId}`)).status());
    expect([403, 404]).toContain((await foreignContext.get(`/api/orders?consultationId=${consultationId}&patientId=${patientId}`)).status());
    staff = new MedplumClient({ baseUrl: MEDPLUM, fetch: globalThis.fetch.bind(globalThis) });
    const login = await staff.startLogin({ email, password }); await staff.processCode(login.code!);
    const current = await m.searchResources('Procedure', { encounter: `Encounter/${consultationId}` }, { cache: 'no-cache' });
    const chit = current.find(p => JSON.parse(p.note?.[0]?.text || '{}').kind === 'time-chit')!;
    const rawRead = await fetch(`${MEDPLUM}fhir/R4/Procedure/${chit.id}`, { headers: { Authorization: `Bearer ${staff.getAccessToken()}` } });
    expect([403, 404]).toContain(rawRead.status);
    const rawSearch = await fetch(`${MEDPLUM}fhir/R4/Procedure?_id=${chit.id}`, { headers: { Authorization: `Bearer ${staff.getAccessToken()}` } });
    expect([200, 403]).toContain(rawSearch.status);
    if (rawSearch.ok) expect((await rawSearch.json()).entry || []).toHaveLength(0);
  } finally {
    await foreignContext?.dispose(); await staff?.signOut();
    if (practitionerId) {
      for (const membership of await m.searchResources('ProjectMembership', { profile: `Practitioner/${practitionerId}` })) await m.deleteResource('ProjectMembership', membership.id!);
      for (const role of await m.searchResources('PractitionerRole', { practitioner: `Practitioner/${practitionerId}` })) await m.deleteResource('PractitionerRole', role.id!);
      await m.deleteResource('Practitioner', practitionerId);
    }
    if (foreignAccount) await m.deleteResource('HealthcareService', foreignAccount.id);
    if (foreignOrg) await m.deleteResource('Organization', foreignOrg.id);
    const latest = await m.readResource('Organization', org.id!, { cache: 'no-cache' });
    await m.updateResource({ ...latest, extension: [...(latest.extension || []).filter(e => e.url !== moduleUrl), ...(original ? [original] : [])] });
  }
});
