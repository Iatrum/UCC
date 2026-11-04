import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import type { Device, Organization } from '@medplum/fhirtypes';
import type { MedplumClient } from '@medplum/core';
import { fhir, byPatient } from '../lib/fhir';
import { randomUUID } from 'node:crypto';

const typeSystem = 'https://ucc.emr/poct/analyser-type';
const propertySystem = 'https://ucc.emr/poct/device-property';
const tagSystem = 'https://ucc.emr/poct';
// Mirrors lib/module-settings.ts: the POCT feature toggle gate, same mechanism as every other module.
const moduleExtensionUrl = 'https://ucc.emr/organization-enabled-module-ids';
const defaultBranchEnabledModuleIds = ['appointments', 'inventory', 'analytics', 'follow-up'];

// Sets the "poct" module on/off for the clinic's Organization (same toggle an admin flips in /admin/clinics).
// Returns a restore function so the test clinic's module config is left exactly as found.
async function setPoctModuleEnabled(m: MedplumClient, clinicId: string, enabled: boolean) {
  const org = await m.searchOne('Organization', { identifier: `clinic|${clinicId}` });
  if (!org?.id) throw new Error(`Organization for clinic ${clinicId} not found`);
  const existingExtension = org.extension?.find((ext) => ext.url === moduleExtensionUrl);
  const currentIds: string[] = existingExtension?.valueString
    ? JSON.parse(existingExtension.valueString)
    : [...defaultBranchEnabledModuleIds];
  if (currentIds.includes('poct') === enabled) return async () => {};

  const nextIds = enabled ? [...currentIds, 'poct'] : currentIds.filter((id) => id !== 'poct');
  const otherExtensions = org.extension?.filter((ext) => ext.url !== moduleExtensionUrl) ?? [];
  await m.updateResource<Organization>({
    ...org,
    extension: [...otherExtensions, { url: moduleExtensionUrl, valueString: JSON.stringify(nextIds) }],
  });

  return async () => {
    const latest = await m.readResource('Organization', org.id!);
    await m.updateResource<Organization>({
      ...latest,
      extension: [
        ...(latest.extension?.filter((ext) => ext.url !== moduleExtensionUrl) ?? []),
        ...(existingExtension ? [existingExtension] : []),
      ],
    });
  };
}

async function fixture(request: APIRequestContext, page: Page, online: boolean) {
  const m = await fhir();
  const suffix = randomUUID().slice(0, 8);
  const created = await request.post('/api/patients', { data: { fullName: `POCT Fake ${suffix}`, nric: `FAKE-POCT-${suffix}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000' } });
  expect(created.ok()).toBeTruthy();
  const { patientId } = await created.json();
  const patient = await m.readResource('Patient', patientId);
  const clinicId = patient.identifier?.find((id) => id.system === 'clinic')?.value;
  expect(['demo', 'clinicb', 'clinicc', 'clinicd']).toContain(clinicId);
  const restorePoctModule = await setPoctModuleEnabled(m, clinicId!, true);
  const consult = await request.post('/api/consultations', { data: { patientId, chiefComplaint: 'Fake POCT test visit', diagnosis: 'Fake test', procedures: [], prescriptions: [] } });
  expect(consult.ok()).toBeTruthy();
  const { consultationId } = await consult.json();
  const device = await m.createResource<Device>({ resourceType: 'Device', status: 'active',
    identifier: [{ system: 'clinic', value: clinicId }],
    meta: { tag: [{ system: tagSystem, code: 'simulated' }] },
    deviceName: [{ name: `Fake POCT ${suffix}`, type: 'user-friendly-name' }],
    type: { coding: [{ system: typeSystem, code: 'glucose' }] },
    property: [{ type: { coding: [{ system: propertySystem, code: 'last-heartbeat' }] },
      valueCode: [{ text: new Date(Date.now() - (online ? 0 : 300_000)).toISOString() }] }],
  });
  await page.route('**/api/consultations/plan**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, persistenceAvailable: false, plan: { entries: [], summary: {} } }) }));
  await page.goto(`/patients/${patientId}`);
  await page.getByRole('tab', { name: 'Treatment', exact: true }).click();
  await expect(page.getByRole('region', { name: 'POCT', exact: true })).toBeVisible();
  return { m, patientId, patientName: `POCT Fake ${suffix}`, consultationId, clinicId, device, restorePoctModule };
}

test('POCT offline analyser cannot be added; auth, clinic and server guard fail closed', async ({ request, page, playwright, baseURL }) => {
  const f = await fixture(request, page, false);
  const foreign = await f.m.createResource<Device>({ ...f.device, id: undefined, meta: { tag: [{ system: tagSystem, code: 'simulated' }] },
    identifier: [{ system: 'clinic', value: f.clinicId === 'demo' ? 'clinicb' : 'demo' }] });
  try {
    const anon = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try { expect((await anon.get('/api/poct/analysers')).status()).toBe(401); } finally { await anon.dispose(); }
    const list = await (await request.get('/api/poct/analysers')).json();
    expect(list.analysers.some((a: any) => a.id === foreign.id)).toBe(false);
    expect(list.analysers.find((a: any) => a.id === f.device.id)?.online).toBe(false);
    await expect(page.getByRole('button', { name: 'Add POCT Glucose (capillary)', exact: true })).toBeDisabled();
    for (const analyserId of [f.device.id, foreign.id]) {
      const result = await request.post('/api/labs/order', { data: { patientId: f.patientId, encounterId: f.consultationId,
        tests: [{ code: '14743-9', display: 'Glucose' }], poct: { code: '14743-9', analyserId, entryId: randomUUID() } } });
      expect(result.status()).toBe(409);
    }
    expect((await byPatient('ServiceRequest', f.patientId)).length).toBe(0);
  } finally {
    await f.m.deleteResource('Device', foreign.id!);
    await f.m.deleteResource('Device', f.device.id!);
    await f.restorePoctModule();
  }
});

test('POCT online + Sign creates active Device ServiceRequest, preserves bill and no completed Procedure', async ({ request, page }) => {
  const f = await fixture(request, page, true);
  try {
    // Refresh the fake heartbeat after page compilation, just as the future bridge will.
    const beat = async (active: boolean) => f.m.updateResource({ ...f.device, status: active ? 'active' as const : 'inactive' as const,
      property: [{ type: { coding: [{ system: propertySystem, code: 'last-heartbeat' }] }, valueCode: [{ text: new Date().toISOString() }] }] });
    await beat(true);
    await expect(page.getByRole('button', { name: 'Add POCT Glucose (capillary)', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Add POCT Glucose (capillary)', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove Glucose (capillary)', exact: true })).toBeVisible();
    await beat(false);
    const blocked = page.waitForResponse((r) => r.url().includes('/api/labs/order') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign', exact: true }).click();
    expect((await blocked).status()).toBe(409);
    await expect(page.getByRole('button', { name: 'Remove Glucose (capillary)', exact: true })).toBeVisible();
    expect((await byPatient('ServiceRequest', f.patientId)).length).toBe(0);
    await beat(true);
    const ordered = page.waitForResponse((r) => r.url().includes('/api/labs/order') && r.request().method() === 'POST');
    const billed = page.waitForResponse((r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign', exact: true }).click();
    const response = await ordered;
    expect(response.ok()).toBeTruthy();
    expect((await billed).ok()).toBeTruthy();
    const sr = (await byPatient('ServiceRequest', f.patientId)).filter((r) => r.code?.coding?.some((c: any) => c.code === '14743-9'));
    expect(sr).toHaveLength(1);
    expect(sr[0].status).toBe('active');
    expect(sr[0].intent).toBe('order');
    expect(sr[0].performer).toEqual([{ reference: `Device/${f.device.id}` }]);
    expect(sr[0].meta.tag).toContainEqual(expect.objectContaining({ system: tagSystem, code: 'poct' }));
    expect(sr[0].category[0].coding[0].code).toBe('108252007');
    expect(sr[0].requester.reference).toMatch(/^Practitioner\//);
    expect(sr[0].identifier).toContainEqual(expect.objectContaining({ system: 'clinic', value: f.clinicId }));
    expect(await byPatient('Procedure', f.patientId)).toHaveLength(0);
    // Retry the exact same signed entry: conditional create must return the original resource.
    const retry = await request.post('/api/labs/order', { data: response.request().postDataJSON() });
    expect(retry.ok()).toBeTruthy();
    expect((await retry.json()).serviceRequestId).toBe(sr[0].id);
    const consultation = await (await request.get(`/api/consultations?id=${f.consultationId}`)).json();
    expect(consultation.consultation.billingItems).toContainEqual(expect.objectContaining({ name: 'Glucose (capillary)', price: 5, quantity: 1 }));
    await page.goto(`/orders/checkout/${f.consultationId}?patientId=${f.patientId}`);
    await expect(page.getByText('Glucose (capillary)', { exact: true }).first()).toBeVisible();
    // Signed order must surface on the /poct worklist, not just the checkout screen.
    await page.goto('/poct');
    await expect(page.getByText(f.patientName, { exact: true })).toBeVisible();
    const pendingStat = page.getByText('Pending', { exact: true }).locator('xpath=ancestor::*[@data-slot="card"]');
    const pendingCount = await pendingStat.getByText(/^\d+$/).innerText();
    expect(Number(pendingCount)).toBeGreaterThan(0);
  } finally { await f.m.deleteResource('Device', f.device.id!); await f.restorePoctModule(); }
});

test('POCT module disabled for the clinic: composer hides the section and the API refuses orders', async ({ request, page }) => {
  const m = await fhir();
  const suffix = randomUUID().slice(0, 8);
  const created = await request.post('/api/patients', { data: { fullName: `POCT Fake ${suffix}`, nric: `FAKE-POCT-${suffix}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000' } });
  expect(created.ok()).toBeTruthy();
  const { patientId } = await created.json();
  const patient = await m.readResource('Patient', patientId);
  const clinicId = patient.identifier?.find((id) => id.system === 'clinic')?.value;
  expect(['demo', 'clinicb', 'clinicc', 'clinicd']).toContain(clinicId);
  const restorePoctModule = await setPoctModuleEnabled(m, clinicId!, false);
  try {
    const consult = await request.post('/api/consultations', { data: { patientId, chiefComplaint: 'Fake POCT test visit', diagnosis: 'Fake test', procedures: [], prescriptions: [] } });
    expect(consult.ok()).toBeTruthy();
    const { consultationId } = await consult.json();
    await page.route('**/api/consultations/plan**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, persistenceAvailable: false, plan: { entries: [], summary: {} } }) }));
    await page.goto(`/patients/${patientId}`);
    await page.getByRole('tab', { name: 'Treatment', exact: true }).click();
    await expect(page.getByRole('region', { name: 'POCT', exact: true })).toHaveCount(0);

    expect((await request.get('/api/poct/analysers')).status()).toBe(404);
    const result = await request.post('/api/labs/order', { data: { patientId, encounterId: consultationId,
      tests: [{ code: '14743-9', display: 'Glucose' }], poct: { code: '14743-9', analyserId: randomUUID(), entryId: randomUUID() } } });
    expect(result.status()).toBe(403);
    expect((await byPatient('ServiceRequest', patientId)).length).toBe(0);
  } finally {
    await restorePoctModule();
  }
});

test('POCT module disabled after an order exists blocks PATCH/DELETE of that order; a generic lab order stays mutable', async ({ request, page }) => {
  const f = await fixture(request, page, true);
  try {
    const poctOrder = await request.post('/api/labs/order', { data: { patientId: f.patientId, encounterId: f.consultationId,
      tests: [{ code: '14743-9', display: 'Glucose' }], poct: { code: '14743-9', analyserId: f.device.id, entryId: randomUUID() } } });
    expect(poctOrder.ok()).toBeTruthy();
    const { serviceRequestId: poctServiceRequestId } = await poctOrder.json();

    const genericOrder = await request.post('/api/labs/order', { data: { patientId: f.patientId, tests: ['CBC'] } });
    expect(genericOrder.ok()).toBeTruthy();
    const { serviceRequestId: genericServiceRequestId } = await genericOrder.json();

    const disable = await setPoctModuleEnabled(f.m, f.clinicId, false);
    try {
      const patchPoct = await request.patch('/api/labs/order', { data: { serviceRequestId: poctServiceRequestId, priority: 'urgent' } });
      expect(patchPoct.status()).toBe(403);
      const deletePoct = await request.delete('/api/labs/order', { data: { serviceRequestId: poctServiceRequestId } });
      expect(deletePoct.status()).toBe(403);
      expect((await f.m.readResource('ServiceRequest', poctServiceRequestId)).priority).not.toBe('urgent');

      const patchGeneric = await request.patch('/api/labs/order', { data: { serviceRequestId: genericServiceRequestId, priority: 'urgent' } });
      expect(patchGeneric.ok()).toBeTruthy();
      expect((await f.m.readResource('ServiceRequest', genericServiceRequestId)).priority).toBe('urgent');
    } finally {
      await disable();
    }

    const patchPoctAgain = await request.patch('/api/labs/order', { data: { serviceRequestId: poctServiceRequestId, priority: 'stat' } });
    expect(patchPoctAgain.ok()).toBeTruthy();
    expect((await f.m.readResource('ServiceRequest', poctServiceRequestId)).priority).toBe('stat');
    const deleteGeneric = await request.delete('/api/labs/order', { data: { serviceRequestId: genericServiceRequestId } });
    expect(deleteGeneric.ok()).toBeTruthy();
  } finally {
    await f.m.deleteResource('Device', f.device.id!);
    await f.restorePoctModule();
  }
});
