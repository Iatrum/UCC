import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import type { Device, Organization, ServiceRequest } from '@medplum/fhirtypes';
import type { MedplumClient } from '@medplum/core';
import { fhir, byPatient } from '../lib/fhir';
import { POCT_API_KEY } from '../lib/env';
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

// Signs the fixture's online analyser's Glucose test and returns the resulting ServiceRequest.
// Duplicated from (not shared with) the "online + Sign" test above so that test stays untouched.
async function signGlucoseOrder(f: Awaited<ReturnType<typeof fixture>>, page: Page, request: APIRequestContext): Promise<ServiceRequest> {
  await f.m.updateResource({ ...f.device, status: 'active', property: [{ type: { coding: [{ system: propertySystem, code: 'last-heartbeat' }] }, valueCode: [{ text: new Date().toISOString() }] }] });
  await expect(page.getByRole('button', { name: 'Add POCT Glucose (capillary)', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Add POCT Glucose (capillary)', exact: true }).click();
  // Wait for the composer to actually register the add (same as the "online + Sign" test above)
  // before signing — clicking Sign immediately after Add races the composer's own state update.
  await expect(page.getByRole('button', { name: 'Remove Glucose (capillary)', exact: true })).toBeVisible();
  const ordered = page.waitForResponse((r) => r.url().includes('/api/labs/order') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign', exact: true }).click();
  expect((await ordered).ok()).toBeTruthy();
  const [sr] = (await byPatient('ServiceRequest', f.patientId)).filter((r: ServiceRequest) => r.code?.coding?.some((c: any) => c.code === '14743-9'));
  expect(sr).toBeTruthy();
  return sr;
}

// Builds a minimal, spec-shaped HL7 ORU^R01 message by hand (not via lib/poct/hl7's own
// builder) so this test checks the wire contract independently of our encoder.
function buildTestOruMessage(placerOrderNumber: string, value: number, flag: 'N' | 'H' | 'HH') {
  const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const segments = [
    ['MSH', '^~\\&', 'SIMANALYSER', 'UCC', 'UCC', 'UCC', ts, '', 'ORU^R01', 'TEST-MSG-1', 'P', '2.5.1'].join('|'),
    ['OBR', '1', placerOrderNumber, '', '', '', ts].join('|'),
    ['OBX', '1', 'NM', '14743-9^Glucose (capillary)^LN', '', String(value), 'mmol/L', 'To confirm per analyser', flag, '', '', 'F'].join('|'),
  ];
  return segments.join('\r') + '\r';
}

// Builds a minimal, spec-shaped ASTM E1394 result message by hand, same rationale as above.
function buildTestAstmMessage(placerOrderNumber: string, testCode: string, testName: string, value: number, flag: 'N' | 'H' | 'HH') {
  const ts = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const segments = [
    ['H', '\\^&', '', '', 'SIMANALYSER', '', '', '', '', '', '', 'P', 'E1394-97', ts].join('|'),
    `O|1|${placerOrderNumber}`,
    ['R', '1', `^^^${testCode}^${testName}`, String(value), 'mmol/L', 'To confirm per analyser', flag, '', 'F', '', '', ts].join('|'),
    'L|1|N',
  ];
  return segments.join('\r') + '\r';
}

// Single test covering the whole simulated-analyser bridge: only one UI sign round-trip
// (signGlucoseOrder) is used; everything else is driven directly via FHIR (f.m, the same
// superadmin client the fixture already uses) or the api-key-authenticated ingestion route
// (no clinic-session cookie involved), to keep this test's wall-clock footprint small — the
// `request` fixture and `page` are separate browser/API contexts that each hold their own copy
// of the session cookie, and a long test mixing many calls on both risks one of them hitting a
// stale/rotated refresh token (the "Session expired" cascades documented in prior STATE.md
// rounds); minimizing cross-context calls after the initial fixture() setup avoids that.
test('Simulated analyser HL7/ASTM results reach the Lab tab, clear pending, and the bridge rejects a bad key or a non-POCT order', async ({ request, page }) => {
  const f = await fixture(request, page, true);
  try {
    const sr = await signGlucoseOrder(f, page, request);

    await page.goto(`/patients/${f.patientId}/labs-imaging`);
    await expect(page.getByText('Pending POCT Tests', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Glucose (capillary)', exact: true })).toBeVisible();
    await expect(page.getByText('Laboratory Report')).toHaveCount(0);

    const wrongKey = await request.post('/api/labs/receive/message', {
      data: { format: 'hl7', message: buildTestOruMessage(sr.id!, 6.8, 'H'), apiKey: 'wrong-key' },
    });
    expect(wrongKey.status()).toBe(401);

    // A non-POCT (plain lab) ServiceRequest, created directly via FHIR (no extra UI/session
    // round trip), must be rejected by this analyser bridge even with a valid key.
    const plainSr = await f.m.createResource<ServiceRequest>({
      resourceType: 'ServiceRequest', status: 'active', intent: 'order',
      subject: { reference: `Patient/${f.patientId}` },
      code: { coding: [{ system: 'http://loinc.org', code: '58410-2', display: 'CBC' }] },
      identifier: [{ system: 'clinic', value: f.clinicId! }],
    });
    const rejected = await request.post('/api/labs/receive/message', {
      data: { format: 'hl7', message: buildTestOruMessage(plainSr.id!, 1, 'N'), apiKey: POCT_API_KEY },
    });
    expect(rejected.status()).toBe(400);

    const ingested = await request.post('/api/labs/receive/message', {
      data: { format: 'hl7', message: buildTestOruMessage(sr.id!, 6.8, 'H'), apiKey: POCT_API_KEY },
    });
    expect(ingested.ok()).toBeTruthy();
    expect((await ingested.json()).serviceRequestId).toBe(sr.id);
    expect((await f.m.readResource('ServiceRequest', sr.id!)).status).toBe('completed');

    await page.goto(`/patients/${f.patientId}/labs-imaging`);
    await expect(page.getByText('Pending POCT Tests', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Laboratory Report')).toBeVisible();
    await expect(page.getByText('6.8 mmol/L', { exact: true })).toBeVisible();
    await expect(page.getByText('high', { exact: true })).toBeVisible();

    // ASTM critical result for a second POCT order, also created directly via FHIR (same
    // Device, no second UI sign round trip needed to exercise the ASTM parser end to end).
    const sr2 = await f.m.createResource<ServiceRequest>({
      resourceType: 'ServiceRequest', status: 'active', intent: 'order',
      subject: { reference: `Patient/${f.patientId}` },
      code: { coding: [{ system: 'http://loinc.org', code: '1988-5', display: 'CRP' }], text: 'CRP' },
      identifier: [{ system: 'clinic', value: f.clinicId! }],
      meta: { tag: [{ system: tagSystem, code: 'poct' }] },
      performer: [{ reference: `Device/${f.device.id}` }],
    });
    const astmIngested = await request.post('/api/labs/receive/message', {
      data: { format: 'astm', message: buildTestAstmMessage(sr2.id!, '1988-5', 'CRP', 42, 'HH'), apiKey: POCT_API_KEY },
    });
    expect(astmIngested.ok()).toBeTruthy();

    await page.goto(`/patients/${f.patientId}/labs-imaging`);
    await expect(page.getByText('Critical Results Detected', { exact: true })).toBeVisible();
    await expect(page.getByText('critical', { exact: true })).toBeVisible();
  } finally { await f.m.deleteResource('Device', f.device.id!); await f.restorePoctModule(); }
});
