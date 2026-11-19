import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fhir } from '../lib/fhir';
import { BASE, MEDPLUM, MEDPLUM_ADMIN, EVIDENCE } from '../lib/env';

// Task 657 (PILOT-READINESS A7): Time Chit walked once as a NON-admin staff user on dev with fake data.
// The user is invited into the demo clinic by the Medplum admin, then everything else runs as that staff user.
test.use({ trace: 'off', storageState: { cookies: [], origins: [] } });

// Medplum rate-limits auth per IP (shared dev instance): honour Retry-After instead of failing.
async function login(ctx: import('@playwright/test').APIRequestContext, data: { email: string; password: string }) {
  for (let i = 0; i < 4; i++) {
    const r = await ctx.post('/api/auth/login', { data });
    if (r.status() !== 429) return r.status();
    const wait = Number(r.headers()['retry-after']);
    await new Promise(res => setTimeout(res, (Number.isFinite(wait) && wait > 0 ? Math.min(600, wait + 1) : 65) * 1000));
  }
  return 429;
}

const DATE = '2026-11-14', IN = '09:15', OUT = '11:45';
async function openTreatment(page: Page, patientId: string) {
  await page.route('**/api/consultations/plan**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, persistenceAvailable: false, plan: { entries: [], summary: {} } }) }));
  await page.goto(`/patients/${patientId}`);
  await page.getByRole('tab', { name: 'Treatment', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Search treatment catalog' })).toBeVisible();
}

test('Time Chit staff walk: issue, preview/print content, signed lock (non-admin)', async ({ browser, playwright }) => {
  expect(BASE).toMatch(/^http:\/\/(?:localhost|127\.0\.0\.1):[1-9]\d{3,4}$/);
  expect(MEDPLUM.replace(/\/$/, '')).toMatch(/^http:\/\/(?:localhost|127\.0\.0\.1):8113$/);
  const m = await fhir(), suffix = randomUUID().slice(0, 8);
  const email = `tc-staff-${suffix}@example.invalid`, password = `Fake-only-${randomUUID()}!`;
  const fullName = `Chit Walk ${suffix}`, nric = `FAKE-TW-${suffix}`;
  let practitionerId: string | undefined, catalogId: string | undefined;
  const anon = { cookies: [], origins: [] };
  const staff = await playwright.request.newContext({ baseURL: BASE, storageState: anon });
  const adminCtx = await playwright.request.newContext({ baseURL: BASE, storageState: anon });
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    // Look up the clinic the dev app serves (LOCAL_AUTH_CLINIC_ID) via a throwaway admin login, then invite a plain staff user into it.
    expect(await login(adminCtx, MEDPLUM_ADMIN)).toBe(200);
    const clinicId = process.env.UCC_CLINIC_ID || 'demo';
    const org = (await m.searchOne('Organization', { identifier: `clinic|${clinicId}` }, { cache: 'no-cache' }))!;
    expect(org?.id).toBeTruthy();
    // The letterhead comes from GET /api/organization (the clinic's parent company; falls back to the clinic org itself).
    // On the shared dev data the demo clinic is partOf another org, so that is what the print must show (see .ai/research/task-657.md).
    const parentId = org.partOf?.reference?.replace('Organization/', '');
    const clinicName = (parentId ? (await m.readResource('Organization', parentId, { cache: 'no-cache' })).name : org.name)!;
    expect(clinicName).toBeTruthy();
    expect((await adminCtx.post('/api/admin/users/invite', { data: { firstName: 'Fake', lastName: 'Staff', email, password, sendEmail: false, clinicId: org.id } })).status()).toBe(200);
    practitionerId = (await m.searchOne('Practitioner', { telecom: email }))?.id;
    expect(await login(staff, { email, password })).toBe(200);
    // Non-admin: the staff session must not be able to use admin APIs.
    expect([401, 403]).toContain((await staff.post('/api/admin/users/invite', { data: { firstName: 'X', lastName: 'Y', email: `x-${suffix}@example.invalid`, password: 'Fake-only-x1!', sendEmail: false, clinicId: org.id } })).status());

    const created = await staff.post('/api/patients', { data: { fullName, nric, dateOfBirth: '1991-02-03', gender: 'female', phone: '0100000000' } });
    expect(created.status()).toBe(200);
    const { patientId } = await created.json();
    const consultationResponse = await staff.post('/api/consultations', { data: { patientId, chiefComplaint: 'Fake attendance visit', diagnosis: 'Fake test attendance' } });
    expect(consultationResponse.status()).toBe(200);
    const { consultationId } = await consultationResponse.json();
    // Time Chit shares the MC template; its catalog row is the 'letter-time-chit' document item.
    const catalog = await staff.post('/api/catalogs', { data: { type: 'document', name: `Time Chit Walk ${suffix}`, code: 'letter-time-chit', defaultPrice: 5 } });
    expect(catalog.status()).toBe(200); catalogId = (await catalog.json()).id;

    context = await browser.newContext({ storageState: await staff.storageState() });
    const page = await context.newPage();
    await openTreatment(page, patientId);
    await page.getByRole('textbox', { name: 'Search treatment catalog' }).fill('time chit');
    await page.getByRole('button', { name: /TIME CHIT.*RM/i }).click();
    await page.getByText('TIME CHIT', { exact: true }).last().click();
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
    await dialog.getByLabel('Attendance date').fill(DATE);
    await dialog.getByLabel('Time in', { exact: true }).fill(IN);
    await dialog.getByLabel('Time out', { exact: true }).fill(OUT);
    await dialog.getByLabel("Doctor's name").fill('Dr Fake Walk');
    await expect(dialog.getByText('Duration: 2.5 hour(s)')).toBeVisible();
    // Composer preview (same template as MC).
    const composer = page.frameLocator('iframe[title="Time Chit preview"]');
    await expect(composer.getByText('TIME CHIT / SURAT MASA')).toBeVisible();
    await expect(composer.getByText(fullName).first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Complete document' }).click();
    const sign = page.waitForResponse(r => r.url().endsWith('/api/orders') && r.request().method() === 'POST', { timeout: 120_000 });
    await page.getByRole('button', { name: 'Sign', exact: true }).click();
    expect((await sign).status()).toBe(200);
    await expect(page.getByText('Treatment Signed', { exact: true })).toBeVisible();

    // Visit's Documents tab: preview shows the right patient, clinic and date/time range.
    await page.goto(`/patients/${patientId}`); await page.getByRole('tab', { name: 'Documents', exact: true }).click();
    await page.getByRole('button', { name: /^Time Chit/ }).click();
    const preview = page.frameLocator('iframe[title="Document preview"]');
    await expect(preview.getByText('TIME CHIT / SURAT MASA')).toBeVisible();
    await expect(preview.getByText(fullName).first()).toBeVisible();
    await expect(preview.getByText(clinicName).first()).toBeVisible();
    await expect(preview.getByText('14 Nov 2026').first()).toBeVisible();
    await expect(preview.getByText(IN).first()).toBeVisible();
    await expect(preview.getByText(OUT).first()).toBeVisible();
    await expect(preview.getByText(/not a Medical Certificate/)).toBeVisible();
    // Another patient's name must not appear (guards against template/patient mixups).
    await expect(preview.getByText('Ahmad bin Abdullah')).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE}/time-chit-staff-preview.png`, fullPage: true });
    const frameHtml = await preview.locator('body').innerText();
    expect(frameHtml).toContain(nric);
    await page.getByRole('button', { name: 'Print / Save PDF' }).click();
    await expect(page.locator('iframe[aria-hidden="true"]')).toHaveCount(1);

    // Stored note + clinic identifier.
    const saved = await staff.get(`/api/consultations?id=${consultationId}`);
    expect(saved.status()).toBe(200);
    const procedures = (await saved.json()).consultation.procedures;
    const chit = procedures.find((p: any) => JSON.parse(p.notes || '{}').kind === 'time-chit');
    expect(JSON.parse(chit.notes)).toMatchObject({ tcDate: DATE, tcTimeIn: IN, tcTimeOut: OUT, tcHours: '2.5', tcDoctorName: 'Dr Fake Walk' });
    const rows = await m.searchResources('Procedure', { encounter: `Encounter/${consultationId}` }, { cache: 'no-cache' });
    const row = rows.find(p => JSON.parse(p.note?.[0]?.text || '{}').kind === 'time-chit')!;
    expect(row.identifier?.some(i => i.system === 'clinic' && i.value === clinicId)).toBe(true);

    // Signed Time Chit is locked: resend unchanged is fine, any edit is a 409 and nothing changes.
    expect((await staff.patch('/api/consultations', { data: { consultationId, procedures } })).status()).toBe(200);
    const edited = { ...chit, notes: JSON.stringify({ ...JSON.parse(chit.notes), tcTimeOut: '12:30' }) };
    const edit = await staff.patch('/api/consultations', { data: { consultationId, procedures: [edited] } });
    expect(edit.status()).toBe(409);
    expect(JSON.stringify(await edit.json())).toMatch(/signed/i);
    expect((await staff.patch('/api/consultations', { data: { consultationId, procedures: [] } })).status()).toBe(409);
    const after = (await m.searchResources('Procedure', { encounter: `Encounter/${consultationId}` }, { cache: 'no-cache' }))
      .filter(p => JSON.parse(p.note?.[0]?.text || '{}').kind === 'time-chit');
    expect(after).toHaveLength(1);
    expect(JSON.parse(after[0].note![0].text!)).toMatchObject({ tcTimeOut: OUT, tcHours: '2.5' });
  } finally {
    await context?.close();
    if (catalogId) await staff.delete(`/api/catalogs?id=${catalogId}&type=document`);
    await staff.dispose(); await adminCtx.dispose();
    if (practitionerId) {
      for (const mm of await m.searchResources('ProjectMembership', { profile: `Practitioner/${practitionerId}` })) await m.deleteResource('ProjectMembership', mm.id!);
      for (const r of await m.searchResources('PractitionerRole', { practitioner: `Practitioner/${practitionerId}` })) await m.deleteResource('PractitionerRole', r.id!);
      await m.deleteResource('Practitioner', practitionerId);
    }
  }
});
