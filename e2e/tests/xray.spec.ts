import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import type { Device, Organization, ServiceRequest } from '@medplum/fhirtypes';
import type { MedplumClient } from '@medplum/core';
import { fhir, byPatient } from '../lib/fhir';
import { newDeviceKey, bearer } from '../lib/device-key';
import { randomUUID } from 'node:crypto';

// Device requests contain a runtime secret; exclude them from trace artifacts.
test.use({ trace: 'off' });

const typeSystem = 'https://ucc.emr/xray/device-type';
const propertySystem = 'https://ucc.emr/xray/device-property';
const tagSystem = 'https://ucc.emr/xray';
// Mirrors lib/module-settings.ts: the PACS feature toggle gate, same mechanism as every other module.
const moduleExtensionUrl = 'https://ucc.emr/organization-enabled-module-ids';
const defaultBranchEnabledModuleIds = ['appointments', 'inventory', 'analytics', 'follow-up'];
const pacsHostsExtensionUrl = 'https://ucc.emr/organization-pacs-viewer-hosts';
// Phase 2: viewer links are default-deny; this is what an admin saves in the clinic form. Returns a cleanup.
async function allowPacsHost(m: MedplumClient, clinicId: string, host: string) {
  const org = await m.searchOne('Organization', { identifier: `clinic|${clinicId}` });
  await m.updateResource<Organization>({ ...org!, extension: [...(org!.extension?.filter((e) => e.url !== pacsHostsExtensionUrl) ?? []), { url: pacsHostsExtensionUrl, valueString: JSON.stringify([host]) }] });
  return async () => { const latest = await m.readResource('Organization', org!.id!); await m.updateResource<Organization>({ ...latest, extension: latest.extension?.filter((e) => e.url !== pacsHostsExtensionUrl) }); };
}
const STUDY = { code: '36643-5', name: 'Chest X-ray (PA)', unitPrice: 45 };

// Sets the "pacs" module on/off for the clinic's Organization (same toggle an admin flips in /admin/clinics).
// Returns a restore function so the test clinic's module config is left exactly as found.
async function setPacsModuleEnabled(m: MedplumClient, clinicId: string, enabled: boolean) {
  const org = await m.searchOne('Organization', { identifier: `clinic|${clinicId}` });
  if (!org?.id) throw new Error(`Organization for clinic ${clinicId} not found`);
  const existingExtension = org.extension?.find((ext) => ext.url === moduleExtensionUrl);
  const currentIds: string[] = existingExtension?.valueString
    ? JSON.parse(existingExtension.valueString)
    : [...defaultBranchEnabledModuleIds];
  if (currentIds.includes('pacs') === enabled) return async () => {};

  const nextIds = enabled ? [...currentIds, 'pacs'] : currentIds.filter((id) => id !== 'pacs');
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
  const created = await request.post('/api/patients', { data: { fullName: `Xray Fake ${suffix}`, nric: `FAKE-XRAY-${suffix}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000' } });
  expect(created.ok()).toBeTruthy();
  const { patientId } = await created.json();
  const patient = await m.readResource('Patient', patientId);
  const clinicId = patient.identifier?.find((id) => id.system === 'clinic')?.value;
  expect(['demo', 'clinicb', 'clinicc', 'clinicd']).toContain(clinicId);
  const restorePacsModule = await setPacsModuleEnabled(m, clinicId!, true);
  const consult = await request.post('/api/consultations', { data: { patientId, chiefComplaint: 'Fake X-ray test visit', diagnosis: 'Fake test', procedures: [], prescriptions: [] } });
  expect(consult.ok()).toBeTruthy();
  const { consultationId } = await consult.json();
  const { key: deviceKey, identifier: keyHash } = newDeviceKey();
  const device = await m.createResource<Device>({ resourceType: 'Device', status: 'active',
    identifier: [{ system: 'clinic', value: clinicId }, keyHash],
    meta: { tag: [{ system: tagSystem, code: 'simulated' }] },
    deviceName: [{ name: `Fake X-ray ${suffix}`, type: 'user-friendly-name' }],
    type: { coding: [{ system: typeSystem, code: 'xray' }] },
    property: [{ type: { coding: [{ system: propertySystem, code: 'last-heartbeat' }] },
      valueCode: [{ text: new Date(Date.now() - (online ? 0 : 300_000)).toISOString() }] }],
  });
  await page.route('**/api/consultations/plan**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, persistenceAvailable: false, plan: { entries: [], summary: {} } }) }));
  await page.goto(`/patients/${patientId}`);
  await page.getByRole('tab', { name: 'Treatment', exact: true }).click();
  await expect(page.getByRole('region', { name: 'X-ray', exact: true })).toBeVisible();
  return { m, patientId, patientName: `Xray Fake ${suffix}`, consultationId, clinicId, device, deviceKey, restorePacsModule };
}

test('X-ray offline device cannot be added; auth, clinic and server guard fail closed', async ({ request, page, playwright, baseURL }) => {
  const f = await fixture(request, page, false);
  const foreign = await f.m.createResource<Device>({ ...f.device, id: undefined, meta: { tag: [{ system: tagSystem, code: 'simulated' }] },
    identifier: [{ system: 'clinic', value: f.clinicId === 'demo' ? 'clinicb' : 'demo' }] });
  try {
    const anon = await playwright.request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
    try { expect((await anon.get('/api/pacs/devices')).status()).toBe(401); } finally { await anon.dispose(); }
    const list = await (await request.get('/api/pacs/devices')).json();
    expect(list.devices.some((d: any) => d.id === foreign.id)).toBe(false);
    expect(list.devices.find((d: any) => d.id === f.device.id)?.online).toBe(false);
    await expect(page.getByRole('button', { name: `Add X-ray ${STUDY.name}`, exact: true })).toBeDisabled();
    for (const deviceId of [f.device.id, foreign.id]) {
      const result = await request.post('/api/imaging/order', { data: { patientId: f.patientId, encounterId: f.consultationId,
        procedures: [{ code: STUDY.code, display: STUDY.name }], clinicalIndication: 'Fake test',
        xray: { code: STUDY.code, deviceId, entryId: randomUUID() } } });
      expect(result.status()).toBe(409);
    }
    expect((await byPatient('ServiceRequest', f.patientId)).length).toBe(0);
  } finally {
    await f.m.deleteResource('Device', foreign.id!);
    await f.m.deleteResource('Device', f.device.id!);
    await f.restorePacsModule();
  }
});

test('X-ray online + Sign creates active Device ServiceRequest, preserves bill and no completed Procedure', async ({ request, page }) => {
  const f = await fixture(request, page, true);
  try {
    const beat = async (active: boolean) => f.m.updateResource({ ...f.device, status: active ? 'active' as const : 'inactive' as const,
      property: [{ type: { coding: [{ system: propertySystem, code: 'last-heartbeat' }] }, valueCode: [{ text: new Date().toISOString() }] }] });
    await beat(true);
    await expect(page.getByRole('button', { name: `Add X-ray ${STUDY.name}`, exact: true })).toBeEnabled();
    await page.getByRole('button', { name: `Add X-ray ${STUDY.name}`, exact: true }).click();
    await expect(page.getByRole('button', { name: `Remove ${STUDY.name}`, exact: true })).toBeVisible();
    await beat(false);
    const blocked = page.waitForResponse((r) => r.url().includes('/api/imaging/order') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign', exact: true }).click();
    expect((await blocked).status()).toBe(409);
    await expect(page.getByRole('button', { name: `Remove ${STUDY.name}`, exact: true })).toBeVisible();
    expect((await byPatient('ServiceRequest', f.patientId)).length).toBe(0);
    await beat(true);
    const ordered = page.waitForResponse((r) => r.url().includes('/api/imaging/order') && r.request().method() === 'POST');
    const billed = page.waitForResponse((r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign', exact: true }).click();
    const response = await ordered;
    expect(response.ok()).toBeTruthy();
    expect((await billed).ok()).toBeTruthy();
    const sr = (await byPatient('ServiceRequest', f.patientId)).filter((r) => r.code?.coding?.some((c: any) => c.code === STUDY.code));
    expect(sr).toHaveLength(1);
    expect(sr[0].status).toBe('active');
    expect(sr[0].intent).toBe('order');
    expect(sr[0].performer).toEqual([{ reference: `Device/${f.device.id}` }]);
    expect(sr[0].meta.tag).toContainEqual(expect.objectContaining({ system: tagSystem, code: 'xray' }));
    expect(sr[0].category[0].coding[0].code).toBe('363679005');
    expect(sr[0].requester.reference).toMatch(/^Practitioner\//);
    expect(sr[0].identifier).toContainEqual(expect.objectContaining({ system: 'clinic', value: f.clinicId }));
    expect(await byPatient('Procedure', f.patientId)).toHaveLength(0);
    // Retry the exact same signed entry: conditional create must return the original resource.
    const retry = await request.post('/api/imaging/order', { data: response.request().postDataJSON() });
    expect(retry.ok()).toBeTruthy();
    expect((await retry.json()).serviceRequestId).toBe(sr[0].id);
    const consultation = await (await request.get(`/api/consultations?id=${f.consultationId}`)).json();
    expect(consultation.consultation.billingItems).toContainEqual(expect.objectContaining({ name: STUDY.name, price: STUDY.unitPrice, quantity: 1 }));
    await page.goto(`/orders/checkout/${f.consultationId}?patientId=${f.patientId}`);
    await expect(page.getByText(STUDY.name, { exact: true }).first()).toBeVisible();
  } finally { await f.m.deleteResource('Device', f.device.id!); await f.restorePacsModule(); }
});

test('X-ray module disabled for the clinic: composer hides the section and the API refuses orders', async ({ request, page }) => {
  const m = await fhir();
  const suffix = randomUUID().slice(0, 8);
  const created = await request.post('/api/patients', { data: { fullName: `Xray Fake ${suffix}`, nric: `FAKE-XRAY-${suffix}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000' } });
  expect(created.ok()).toBeTruthy();
  const { patientId } = await created.json();
  const patient = await m.readResource('Patient', patientId);
  const clinicId = patient.identifier?.find((id) => id.system === 'clinic')?.value;
  expect(['demo', 'clinicb', 'clinicc', 'clinicd']).toContain(clinicId);
  const restorePacsModule = await setPacsModuleEnabled(m, clinicId!, false);
  try {
    const consult = await request.post('/api/consultations', { data: { patientId, chiefComplaint: 'Fake X-ray test visit', diagnosis: 'Fake test', procedures: [], prescriptions: [] } });
    expect(consult.ok()).toBeTruthy();
    const { consultationId } = await consult.json();
    await page.route('**/api/consultations/plan**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, persistenceAvailable: false, plan: { entries: [], summary: {} } }) }));
    await page.goto(`/patients/${patientId}`);
    await page.getByRole('tab', { name: 'Treatment', exact: true }).click();
    await expect(page.getByRole('region', { name: 'X-ray', exact: true })).toHaveCount(0);

    expect((await request.get('/api/pacs/devices')).status()).toBe(404);
    const result = await request.post('/api/imaging/order', { data: { patientId, encounterId: consultationId,
      procedures: [{ code: STUDY.code, display: STUDY.name }], clinicalIndication: 'Fake test',
      xray: { code: STUDY.code, deviceId: randomUUID(), entryId: randomUUID() } } });
    expect(result.status()).toBe(403);
    expect((await byPatient('ServiceRequest', patientId)).length).toBe(0);
  } finally {
    await restorePacsModule();
  }
});

test('Simulated X-ray device study reaches the Lab tab pending card and clears it; duplicate study and bad key fail correctly', async ({ request, page }) => {
  const f = await fixture(request, page, true);
  let cleanupHost: (() => Promise<void>) | undefined;
  try {
    const addButton = page.getByRole('button', { name: `Add X-ray ${STUDY.name}`, exact: true });
    const removeButton = page.getByRole('button', { name: `Remove ${STUDY.name}`, exact: true });
    await expect(addButton).toBeEnabled({ timeout: 10_000 });
    await addButton.click();
    await expect(removeButton).toBeVisible();
    const ordered = page.waitForResponse((r) => r.url().includes('/api/imaging/order') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Sign', exact: true }).click();
    expect((await ordered).ok()).toBeTruthy();
    await expect(page.getByText('Treatment Signed', { exact: true })).toBeVisible();
    const [sr] = (await byPatient('ServiceRequest', f.patientId)).filter((r: ServiceRequest) => r.code?.coding?.some((c: any) => c.code === STUDY.code));
    expect(sr).toBeTruthy();

    await page.goto(`/patients/${f.patientId}/labs-imaging`);
    await expect(page.getByText('Pending X-ray', { exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: STUDY.name, exact: true })).toBeVisible();

    const wrongKey = await request.post('/api/imaging/receive/message', {
      data: { serviceRequestId: sr.id, study: { studyUid: `1.2.3.${randomUUID()}`, modality: 'DX', numberOfSeries: 1, numberOfInstances: 1, series: [] }, apiKey: 'wrong-key' },
    });
    expect(wrongKey.status()).toBe(401);

    // A non-X-ray (generic imaging) ServiceRequest, created directly via FHIR, must be
    // rejected by this device bridge even with a valid key.
    const plainSr = await f.m.createResource<ServiceRequest>({
      resourceType: 'ServiceRequest', status: 'active', intent: 'order',
      subject: { reference: `Patient/${f.patientId}` },
      code: { coding: [{ system: 'http://loinc.org', code: '24638-9', display: 'Pelvis Ultrasound' }] },
      identifier: [{ system: 'clinic', value: f.clinicId! }],
    });
    const rejected = await request.post('/api/imaging/receive/message', {
      data: { serviceRequestId: plainSr.id, study: { studyUid: `1.2.3.${randomUUID()}`, modality: 'US', numberOfSeries: 1, numberOfInstances: 1, series: [] }, apiKey: f.deviceKey },
    });
    expect(rejected.status()).toBe(400);

    const studyUid = `1.2.3.${randomUUID()}`;
    const ingested = await request.post('/api/imaging/receive/message', {
      data: { serviceRequestId: sr.id, study: { studyUid, modality: 'DX', description: 'Chest PA', numberOfSeries: 1, numberOfInstances: 2,
        pacsUrl: `https://viewer.fake-pacs.org/viewer?studyUid=${studyUid}`,
        series: [{ uid: `${studyUid}.1`, number: 1, modality: 'DX', numberOfInstances: 2 }] }, apiKey: f.deviceKey },
    });
    expect(ingested.ok()).toBeTruthy();
    const ingestResult = await ingested.json();
    expect(ingestResult.serviceRequestId).toBe(sr.id);
    const replay = await request.post('/api/imaging/receive/message', {
      data: { serviceRequestId: sr.id, study: { studyUid, modality: 'DX', numberOfSeries: 1, numberOfInstances: 2,
        series: [{ uid: `${studyUid}.1`, number: 1, modality: 'DX', numberOfInstances: 2 }] }, apiKey: f.deviceKey },
    });
    expect(replay.ok()).toBeTruthy();
    expect((await replay.json()).imagingStudyId).toBe(ingestResult.imagingStudyId);
    const studies = await f.m.searchResources('ImagingStudy', { basedon: `ServiceRequest/${sr.id}` });
    expect(studies).toHaveLength(1);
    expect((await f.m.readResource('ServiceRequest', sr.id!)).status).toBe('completed');

    const removeHost = await allowPacsHost(f.m, f.clinicId!, 'viewer.fake-pacs.org');
    cleanupHost = removeHost;
    await page.goto(`/patients/${f.patientId}/labs-imaging`);
    await expect(page.getByText('Pending X-ray', { exact: true })).toHaveCount(0);
    const imagingTab = page.getByRole('tab', { name: 'Imaging Studies', exact: true });
    await expect(async () => {
      await imagingTab.click();
      await expect(imagingTab).toHaveAttribute('data-state', 'active', { timeout: 2000 });
      await expect(page.getByText(STUDY.name, { exact: true }).first()).toBeVisible({ timeout: 2000 });
      await expect(page.getByText('AVAILABLE', { exact: true }).first()).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    // Result link: shown only in the Lab/Imaging area, taken from the stored (sanitised) viewer URL.
    await expect(page.getByRole('link', { name: 'View in PACS' }).first()).toBeVisible();
    const [study] = studies;
    expect(study.extension?.find((e: any) => e.url === 'https://ucc.emr/xray/viewer-url')?.valueUrl).toBe(`https://viewer.fake-pacs.org/viewer?studyUid=${studyUid}`);
    const withModule = await (await request.get(`/api/imaging/results?patientId=${f.patientId}`)).json();
    expect(withModule.studies.some((x: any) => x.xray && x.study?.pacsUrl)).toBeTruthy();
    // Default-off toggle: with `pacs` disabled the X-ray study and its link disappear from the results API.
    const restoreOff = await setPacsModuleEnabled(f.m, f.clinicId!, false);
    try {
      await expect(async () => {
        const gated = await (await request.get(`/api/imaging/results?patientId=${f.patientId}`)).json();
        expect(gated.studies.filter((x: any) => x.xray)).toHaveLength(0);
      }).toPass({ timeout: 20_000 });
    } finally { await restoreOff(); }
  } finally { await cleanupHost?.(); await f.m.deleteResource('Device', f.device.id!); await f.restorePacsModule(); }
});

test('X-ray module disabled after an order exists blocks PATCH/DELETE of that order; a generic imaging order stays mutable', async ({ request, page }) => {
  const f = await fixture(request, page, true);
  try {
    const xrayOrder = await request.post('/api/imaging/order', { data: { patientId: f.patientId, encounterId: f.consultationId,
      procedures: [{ code: STUDY.code, display: STUDY.name }], clinicalIndication: 'Fake test',
      xray: { code: STUDY.code, deviceId: f.device.id, entryId: randomUUID() } } });
    expect(xrayOrder.ok()).toBeTruthy();
    const { serviceRequestId: xrayServiceRequestId } = await xrayOrder.json();

    const genericOrder = await request.post('/api/imaging/order', { data: { patientId: f.patientId,
      procedures: [{ code: '24638-9', display: 'Pelvis Ultrasound', modality: 'US' }], clinicalIndication: 'Fake test' } });
    expect(genericOrder.ok()).toBeTruthy();
    const { serviceRequestId: genericServiceRequestId } = await genericOrder.json();

    const disable = await setPacsModuleEnabled(f.m, f.clinicId, false);
    try {
      const blockedStudy = await request.post('/api/imaging/receive/message', {
        data: { serviceRequestId: xrayServiceRequestId, study: { studyUid: `1.2.3.${randomUUID()}`, modality: 'DX', numberOfSeries: 1, numberOfInstances: 1, series: [] }, apiKey: f.deviceKey },
      });
      expect(blockedStudy.status()).toBe(403);
      expect((await f.m.readResource('ServiceRequest', xrayServiceRequestId)).status).toBe('active');
      expect(await f.m.searchResources('ImagingStudy', { basedon: `ServiceRequest/${xrayServiceRequestId}` })).toHaveLength(0);

      const patchXray = await request.patch('/api/imaging/order', { data: { serviceRequestId: xrayServiceRequestId, priority: 'urgent' } });
      expect(patchXray.status()).toBe(403);
      const deleteXray = await request.delete('/api/imaging/order', { data: { serviceRequestId: xrayServiceRequestId } });
      expect(deleteXray.status()).toBe(403);
      expect((await f.m.readResource('ServiceRequest', xrayServiceRequestId)).priority).not.toBe('urgent');

      const patchGeneric = await request.patch('/api/imaging/order', { data: { serviceRequestId: genericServiceRequestId, priority: 'urgent' } });
      expect(patchGeneric.ok()).toBeTruthy();
      expect((await f.m.readResource('ServiceRequest', genericServiceRequestId)).priority).toBe('urgent');
    } finally {
      await disable();
    }

    const patchXrayAgain = await request.patch('/api/imaging/order', { data: { serviceRequestId: xrayServiceRequestId, priority: 'stat' } });
    expect(patchXrayAgain.ok()).toBeTruthy();
    expect((await f.m.readResource('ServiceRequest', xrayServiceRequestId)).priority).toBe('stat');
    const deleteGeneric = await request.delete('/api/imaging/order', { data: { serviceRequestId: genericServiceRequestId } });
    expect(deleteGeneric.ok()).toBeTruthy();
  } finally {
    await f.m.deleteResource('Device', f.device.id!);
    await f.restorePacsModule();
  }
});

test('Per-device keys: X-ray ingress fails closed without a valid key; a clinic-A key cannot write into a clinic-B order', async ({ request, page }) => {
  const f = await fixture(request, page, true);
  const otherClinic = f.clinicId === 'demo' ? 'clinicb' : 'demo';
  const created: { type: 'Device' | 'ServiceRequest'; id: string }[] = [];
  const make = async <T extends Device | ServiceRequest>(resource: T) => { const r = await f.m.createResource<T>(resource); created.push({ type: r.resourceType as 'Device', id: r.id! }); return r; };
  try {
    const orderIn = (clinic: string, xray: boolean): ServiceRequest => ({ resourceType: 'ServiceRequest', status: 'active', intent: 'order',
      subject: { reference: `Patient/${f.patientId}` },
      ...(xray ? { meta: { tag: [{ system: tagSystem, code: 'xray' }] } } : {}),
      code: { coding: [{ system: 'http://loinc.org', code: xray ? STUDY.code : '24638-9', display: xray ? STUDY.name : 'Pelvis Ultrasound' }] },
      identifier: [{ system: 'clinic', value: clinic }] });
    const own = await make(orderIn(f.clinicId, true));
    const foreignXray = await make(orderIn(otherClinic, true));
    const foreignPlain = await make(orderIn(otherClinic, false));
    const study = () => ({ studyUid: `1.2.3.${randomUUID()}`, modality: 'DX', numberOfSeries: 1, numberOfInstances: 1, series: [] });
    const studiesFor = (id: string) => f.m.searchResources('ImagingStudy', { basedon: `ServiceRequest/${id}` }, { cache: 'no-cache' });

    // No key / malformed / unknown -> 401 on both imaging ingress routes (JSON route no longer fails open).
    for (const headers of [{}, bearer('not-a-device-key'), bearer(`ucc_dk_${randomUUID()}`)]) {
      expect((await request.post('/api/imaging/receive', { headers, data: { serviceRequestId: own.id, study: study() } })).status()).toBe(401);
      expect((await request.post('/api/imaging/receive/message', { headers, data: { serviceRequestId: own.id, study: study() } })).status()).toBe(401);
    }

    // A clinic-A key cannot write into a clinic-B order on either route.
    expect((await request.post('/api/imaging/receive/message', { headers: bearer(f.deviceKey), data: { serviceRequestId: foreignXray.id, study: study() } })).status()).toBe(403);
    expect((await request.post('/api/imaging/receive', { headers: { 'X-Device-Key': f.deviceKey }, data: { serviceRequestId: foreignPlain.id, study: study() } })).status()).toBe(403);
    expect((await request.post('/api/imaging/receive', { headers: bearer(f.deviceKey), data: { serviceRequestId: foreignXray.id, study: study() } })).status()).toBe(403);
    for (const sr of [foreignXray, foreignPlain]) {
      expect(await studiesFor(sr.id!)).toHaveLength(0);
      expect((await f.m.readResource('ServiceRequest', sr.id!)).status).toBe('active');
    }

    // A POCT analyser key is the wrong device type for imaging ingress.
    const analyser = newDeviceKey();
    await make<Device>({ resourceType: 'Device', status: 'active', identifier: [{ system: 'clinic', value: f.clinicId }, analyser.identifier],
      meta: { tag: [{ system: 'https://ucc.emr/poct', code: 'simulated' }] }, type: { coding: [{ system: 'https://ucc.emr/poct/analyser-type', code: 'glucose' }] } });
    expect((await request.post('/api/imaging/receive/message', { headers: bearer(analyser.key), data: { serviceRequestId: own.id, study: study() } })).status()).toBe(401);

    // Inactive / revoked devices are refused.
    await f.m.updateResource({ ...f.device, status: 'inactive' as const });
    expect((await request.post('/api/imaging/receive/message', { headers: bearer(f.deviceKey), data: { serviceRequestId: own.id, study: study() } })).status()).toBe(401);
    await f.m.updateResource({ ...f.device, status: 'active' as const, identifier: f.device.identifier!.filter((id) => !id.system?.includes('api-key')) });
    expect((await request.post('/api/imaging/receive/message', { headers: bearer(f.deviceKey), data: { serviceRequestId: own.id, study: study() } })).status()).toBe(401);
    await f.m.updateResource(f.device);
    expect(await studiesFor(own.id!)).toHaveLength(0);

    // The device's own clinic works; the clinic identifier is stamped from the Device.
    const ok = await request.post('/api/imaging/receive', { headers: bearer(f.deviceKey), data: { serviceRequestId: own.id, study: study() } });
    expect(ok.ok(), await ok.text()).toBeTruthy();
    const stored = await f.m.readResource('ImagingStudy', (await ok.json()).imagingStudyId);
    expect(stored.identifier).toContainEqual({ system: 'clinic', value: f.clinicId });
  } finally {
    for (const r of created.reverse()) await f.m.deleteResource(r.type, r.id).catch(() => {});
    await f.m.deleteResource('Device', f.device.id!);
    await f.restorePacsModule();
  }
});

test('Imaging results API is clinic-scoped: a patient/encounter of another clinic is refused', async ({ request, page }) => {
  const f = await fixture(request, page, true);
  const otherClinic = f.clinicId === 'demo' ? 'clinicb' : 'demo';
  const foreign = await f.m.createResource<import('@medplum/fhirtypes').Patient>({ resourceType: 'Patient', name: [{ given: ['Fake'], family: `Foreign ${randomUUID().slice(0, 6)}` }],
    identifier: [{ system: 'clinic', value: otherClinic }] });
  try {
    expect((await request.get(`/api/imaging/results?patientId=${foreign.id}`)).status()).toBe(403);
    expect((await request.get(`/api/imaging/results?encounterId=${foreign.id}`)).status()).toBe(403);
    expect((await request.get(`/api/imaging/results?patientId=${f.patientId}`)).status()).toBe(200);
  } finally { await f.m.deleteResource('Patient', foreign.id!); await f.m.deleteResource('Device', f.device.id!); await f.restorePacsModule(); }
});
