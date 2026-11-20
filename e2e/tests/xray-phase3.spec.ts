import { test, expect, request as pwRequest, type Page } from '@playwright/test';
import type { Device, ImagingStudy, Organization, ServiceRequest, Task } from '@medplum/fhirtypes';
import type { MedplumClient } from '@medplum/core';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fhir } from '../lib/fhir';
import { EVIDENCE } from '../lib/env';
import { newDeviceKey } from '../lib/device-key';
import { deviceMeta } from '../lib/device-meta';

// X-ray phase 3 (Task 357): real DICOM storage + viewer, against the DEV PACS only (compose project
// ucc-pacs-dev: Orthanc + OHIF, see infra/pacs-dev). SYNTHETIC DICOM only (pydicom test pattern,
// fake identifiers). Skipped when the dev PACS is not set up on this machine.
//   store DICOM in Orthanc -> Lua OnStableStudy -> UCC ingress (per-device key) -> ImagingStudy matched
//   by AccessionNumber -> Lab/Imaging tab -> clinic-scoped, short-lived viewer link -> OHIF.
test.use({ trace: 'off' });

const PACS_DIR = path.join(import.meta.dirname, '../../infra/pacs-dev');
const SHOTS = path.join(EVIDENCE, 'task357');
const ORTHANC = process.env.PACS_ORTHANC_URL || 'http://127.0.0.1:8042';
const VIEWER = process.env.PACS_VIEWER_ORIGIN || 'http://127.0.0.1:3320';
// .env.local and secrets/ are git-ignored and written by infra/pacs-dev/up.sh, so they exist only in the checkout that ran it.
// PACS_DEV_STATE_DIR points at that checkout's infra/pacs-dev when the test runs from another worktree (Task 420).
const STATE_DIR = process.env.PACS_DEV_STATE_DIR ? path.resolve(process.env.PACS_DEV_STATE_DIR) : PACS_DIR;
const KEY_FILE = path.join(STATE_DIR, 'secrets/device-key');
const moduleExt = 'https://ucc.emr/organization-enabled-module-ids';
const typeSystem = 'https://ucc.emr/xray/device-type';
const tagSystem = 'https://ucc.emr/xray';
const ACC = 'https://ucc.emr/xray/accession';
const UID = 'urn:dicom:uid';

let skipReason = 'dev PACS (infra/pacs-dev) is not set up on this machine';
function orthancAuth(): string | undefined {
  try {
    const envFile = path.join(STATE_DIR, '.env.local');
    if (!fs.existsSync(envFile) || !fs.existsSync(KEY_FILE)) {
      skipReason = `dev PACS state not found in ${STATE_DIR} (need .env.local and secrets/device-key from up.sh); set PACS_DEV_STATE_DIR to the infra/pacs-dev checkout that ran up.sh`;
      return undefined;
    }
    const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split('\n')
      .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    if (!env.ORTHANC_USER || !env.ORTHANC_PASSWORD || !fs.existsSync(KEY_FILE)) return undefined;
    return `Basic ${Buffer.from(`${env.ORTHANC_USER}:${env.ORTHANC_PASSWORD}`).toString('base64')}`;
  } catch { return undefined; }
}
const AUTH = orthancAuth();
const accession = () => `UX${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;

/** Generate synthetic DICOM and store it in the dev Orthanc. Returns Orthanc's study id + the Study UID. */
async function storeSyntheticStudy(acc: string, images: number): Promise<{ orthancId: string; studyUid: string }> {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ucc-synth-dicom-'));
  try {
    const files = execFileSync(path.join(PACS_DIR, 'gen-synthetic.sh'), [out, acc, String(images)], { encoding: 'utf8', timeout: 180_000 })
      .split('\n').filter((l) => l.endsWith('.dcm'));
    expect(files).toHaveLength(images);
    let orthancId = '';
    for (const file of files) {
      const r = await fetch(`${ORTHANC}/instances`, { method: 'POST', headers: { Authorization: AUTH!, 'Content-Type': 'application/dicom' }, body: fs.readFileSync(file) });
      expect(r.ok).toBeTruthy();
      orthancId = (await r.json()).ParentStudy;
    }
    const study = await (await fetch(`${ORTHANC}/studies/${orthancId}`, { headers: { Authorization: AUTH! } })).json();
    return { orthancId, studyUid: study.MainDicomTags.StudyInstanceUID };
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
}

async function withPacsOn(m: MedplumClient, clinicId: string) {
  const org = await m.searchOne('Organization', { identifier: `clinic|${clinicId}` });
  if (!org?.id) throw new Error('org missing');
  const original = org.extension ?? [];
  const cur = original.find((e) => e.url === moduleExt);
  const ids: string[] = cur?.valueString ? JSON.parse(cur.valueString) : ['appointments', 'inventory', 'analytics', 'follow-up'];
  await m.updateResource<Organization>({ ...org, extension: [...original.filter((e) => e.url !== moduleExt), { url: moduleExt, valueString: JSON.stringify(Array.from(new Set([...ids, 'pacs']))) }] });
  return async () => { const latest = await m.readResource('Organization', org.id!); await m.updateResource<Organization>({ ...latest, extension: original.length ? original : undefined }); };
}

async function openImaging(page: Page, patientId: string) {
  await page.goto(`/patients/${patientId}/labs-imaging`);
  const tab = page.getByRole('tab', { name: 'Imaging Studies', exact: true });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute('data-state', 'active', { timeout: 2000 });
    await expect(page.getByText('AVAILABLE', { exact: true }).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}

test('stored DICOM appears as a study matched by accession; viewer link is clinic- and study-scoped; unmatched goes to review', async ({ request, page, context }) => {
  test.skip(!AUTH, skipReason);
  test.setTimeout(10 * 60_000);
  const m = await fhir();
  const suffix = randomUUID().slice(0, 8);
  const created = await request.post('/api/patients', { data: { fullName: `Xray3 Fake ${suffix}`, nric: `FAKE-XRAY3-${suffix}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000' } });
  expect(created.ok()).toBeTruthy();
  const { patientId } = await created.json();
  const patient = await m.readResource('Patient', patientId);
  const clinicId = patient.identifier?.find((id) => id.system === 'clinic')?.value as string;
  const otherClinic = clinicId === 'demo' ? 'clinicb' : 'demo';
  const cleanup: Array<() => Promise<unknown>> = [];
  const orthancIds: string[] = [];
  cleanup.push(await withPacsOn(m, clinicId));

  // The dev Orthanc authenticates to UCC as this (fake, per-run) X-ray Device of the test clinic.
  const { key, identifier } = newDeviceKey();
  const device = await m.createResource<Device>({ resourceType: 'Device', status: 'active',
    identifier: [{ system: 'clinic', value: clinicId }, identifier], ...deviceMeta(tagSystem),
    deviceName: [{ name: `Fake PACS ${suffix}`, type: 'user-friendly-name' }], type: { coding: [{ system: typeSystem, code: 'xray' }] } });
  cleanup.push(() => m.deleteResource('Device', device.id!));
  const originalKey = fs.readFileSync(KEY_FILE);
  fs.writeFileSync(KEY_FILE, `${key}\n`, { mode: 0o600 });
  cleanup.push(async () => fs.writeFileSync(KEY_FILE, originalKey, { mode: 0o600 }));

  const mkOrder = async (clinic: string, acc: string) => {
    const sr = await m.createResource<ServiceRequest>({ resourceType: 'ServiceRequest', status: 'active', intent: 'order',
      subject: { reference: `Patient/${patientId}` }, performer: [{ reference: `Device/${device.id}` }],
      code: { coding: [{ system: 'http://loinc.org', code: '36643-5', display: 'Chest X-ray (PA)' }], text: 'Chest X-ray (PA)' },
      identifier: [{ system: 'clinic', value: clinic }, { system: ACC, value: acc }],
      meta: { tag: [{ system: tagSystem, code: 'xray' }], ...(clinic === clinicId ? { account: patient.meta?.account, accounts: patient.meta?.accounts } : {}) } });
    cleanup.push(() => m.deleteResource('ServiceRequest', sr.id!));
    return sr;
  };
  const results = async () => (await (await request.get(`/api/imaging/results?patientId=${patientId}`)).json()).studies as any[];
  const reviewList = async () => (await (await request.get('/api/pacs/unmatched')).json()).studies as any[];

  try {
    // ---- 1. Matched: order with accession -> 2 synthetic images stored -> study appears in UCC ----
    const acc = accession();
    const order = await mkOrder(clinicId, acc);
    const pending = await (await request.get(`/api/labs/results?patientId=${patientId}`)).json();
    expect(pending.xrayPending.find((o: any) => o.id === order.id)?.accessionNumber).toBe(acc);

    // The accession number is shown to staff with the pending order (Lab tab only).
    await page.goto(`/patients/${patientId}/labs-imaging`);
    await expect(page.getByRole('cell', { name: 'Chest X-ray (PA)', exact: true })).toBeVisible();
    await expect(page.getByTestId('xray-accession')).toHaveText(acc);

    const stored = await storeSyntheticStudy(acc, 2);
    orthancIds.push(stored.orthancId);
    let study: any;
    await expect(async () => {
      study = (await results()).find((s) => s.study?.studyUid === stored.studyUid);
      expect(study).toBeTruthy();
    }).toPass({ timeout: 90_000, intervals: [2000] });
    expect(study).toMatchObject({ xray: true, modality: 'DX', status: 'available' });
    expect(study.study).toMatchObject({ viewer: true, accessionNumber: acc, numberOfSeries: 1, numberOfInstances: 2 });
    expect(study.study.pacsUrl).toBeUndefined();
    cleanup.push(() => m.deleteResource('ImagingStudy', study.id));
    const fhirStudy = await m.readResource('ImagingStudy', study.id);
    expect(fhirStudy.basedOn?.[0]?.reference).toBe(`ServiceRequest/${order.id}`);
    expect(fhirStudy.identifier).toContainEqual({ system: 'clinic', value: clinicId });
    expect(fhirStudy.identifier).toContainEqual({ system: UID, value: `urn:oid:${stored.studyUid}` });
    expect((await m.readResource('ServiceRequest', order.id!)).status).toBe('completed');

    // ---- 2. Unmatched: unknown accession, and an accession that exists only on ANOTHER clinic's order ----
    const foreignAcc = accession();
    const foreignOrder = await mkOrder(otherClinic, foreignAcc);
    const strayA = await storeSyntheticStudy(accession(), 1);
    const strayB = await storeSyntheticStudy(foreignAcc, 1);
    orthancIds.push(strayA.orthancId, strayB.orthancId);
    await expect(async () => {
      const uids = (await reviewList()).map((s) => s.studyUid);
      expect(uids).toEqual(expect.arrayContaining([strayA.studyUid, strayB.studyUid]));
    }).toPass({ timeout: 90_000, intervals: [2000] });
    for (const t of await m.searchResources('Task', { identifier: `clinic|${clinicId}`, code: 'https://ucc.emr/pacs/task|unmatched-study', _count: '100' }, { cache: 'no-cache' })) {
      if ([strayA.studyUid, strayB.studyUid].some((u) => (t as Task).identifier?.some((i) => i.value === `urn:oid:${u}`))) cleanup.push(() => m.deleteResource('Task', t.id!));
    }
    expect((await results()).map((s) => s.study?.studyUid)).toEqual([stored.studyUid]); // never auto-attached
    expect((await m.readResource('ServiceRequest', foreignOrder.id!)).status).toBe('active');
    const strays = await m.searchResources('ImagingStudy', { identifier: `${UID}|urn:oid:${strayB.studyUid}` }, { cache: 'no-cache' });
    expect(strays).toHaveLength(0);

    // ---- 3. Ingress auth: no key / wrong key ----
    expect((await request.post('/api/pacs/orthanc/study', { data: { orthancStudyId: stored.orthancId } })).status()).toBe(401);
    expect((await request.post('/api/pacs/orthanc/study', { headers: { Authorization: 'Bearer ucc_dk_fake-not-a-real-key' }, data: { orthancStudyId: stored.orthancId } })).status()).toBe(401);

    // ---- 4. Viewer link: scoped to clinic + study, single use, no Orthanc credentials in the browser ----
    const foreignStudy = await m.createResource<ImagingStudy>({ resourceType: 'ImagingStudy', status: 'available', subject: { reference: `Patient/${patientId}` },
      identifier: [{ system: 'clinic', value: otherClinic }, { system: UID, value: `urn:oid:${strayA.studyUid}` }],
      meta: { tag: [{ system: tagSystem, code: 'xray' }, { system: 'https://ucc.emr/pacs', code: 'orthanc' }] }, modality: [{ code: 'DX' }] });
    cleanup.push(() => m.deleteResource('ImagingStudy', foreignStudy.id!));
    expect((await request.post('/api/pacs/viewer/link', { data: { imagingStudyId: foreignStudy.id } })).status()).toBe(403); // foreign clinic
    const anon = await pwRequest.newContext({ baseURL: process.env.UCC_BASE_URL || 'http://localhost:3210', storageState: { cookies: [], origins: [] } });
    expect((await anon.post('/api/pacs/viewer/link', { data: { imagingStudyId: study.id } })).status()).toBe(401); // no open links
    await anon.dispose();

    const linkResponse = await request.post('/api/pacs/viewer/link', { data: { imagingStudyId: study.id } });
    expect(linkResponse.status()).toBe(200);
    const { url } = await linkResponse.json();
    expect(url.startsWith(`${VIEWER}/launch?t=`)).toBe(true);
    expect(url).not.toContain('8042');

    const viewer = await pwRequest.newContext({ baseURL: VIEWER, storageState: { cookies: [], origins: [] } });
    try {
      const meta = `/dicom-web/studies/${stored.studyUid}/metadata`;
      expect((await viewer.get(meta)).status()).toBe(401); // no session yet
      const launched = await viewer.get(url, { maxRedirects: 0 });
      expect(launched.status()).toBe(303);
      expect(launched.headers()['location']).toBe(`/viewer?StudyInstanceUIDs=${stored.studyUid}`);
      expect(launched.headers()['set-cookie']).toMatch(/^ucc_pacs_viewer_[0-9a-f]{16}=.*HttpOnly/);
      expect((await viewer.get(url, { maxRedirects: 0 })).status()).toBe(403); // single use

      const ok = await viewer.get(meta);
      expect(ok.status()).toBe(200);
      const instances = await ok.json();
      expect(instances).toHaveLength(2);
      expect(JSON.stringify(instances)).not.toContain(':8042'); // no Orthanc address leaks into metadata
      expect((await viewer.get(`/dicom-web/studies/${strayA.studyUid}/metadata`)).status()).toBe(403); // another study
      const search = await viewer.get(`/dicom-web/studies?StudyInstanceUID=${strayA.studyUid}`);
      expect(search.status()).toBe(200);
      expect((await search.json()).map((s: any) => s['0020000D'].Value[0])).toEqual([stored.studyUid]); // forced to own study
      expect((await viewer.get('/dicom-web/series')).status()).toBe(403);
      expect((await viewer.post(meta, { data: {} })).status()).toBeGreaterThanOrEqual(400); // read-only
      expect((await viewer.get('/app-config.js')).ok()).toBeTruthy();
      expect(await (await viewer.get('/app-config.js')).text()).not.toMatch(/password|Authorization|8042/i);
    } finally { await viewer.dispose(); }
    // Orthanc itself refuses anonymous access.
    expect((await fetch(`${ORTHANC}/dicom-web/studies`)).status).toBe(401);

    // ---- 5. UI: Lab/Imaging tab opens the study in OHIF; the composer area carries no viewer button ----
    fs.mkdirSync(SHOTS, { recursive: true });
    await openImaging(page, patientId);
    const button = page.getByTestId('xray-open-viewer');
    await expect(button).toHaveCount(1);
    await page.screenshot({ path: path.join(SHOTS, 'imaging-tab-open-images.png'), fullPage: true });
    const [popup] = await Promise.all([context.waitForEvent('page'), button.click()]);
    const frame = popup.waitForResponse((r) => r.url().includes(`/dicom-web/studies/${stored.studyUid}/`) && r.url().includes('/frames/') && r.status() === 200, { timeout: 120_000 });
    await popup.waitForURL(new RegExp(`^${VIEWER.replace(/[.]/g, '\\.')}/viewer\\?StudyInstanceUIDs=${stored.studyUid.replace(/[.]/g, '\\.')}`), { timeout: 60_000 });
    await frame;
    await popup.waitForTimeout(4000);
    await popup.screenshot({ path: path.join(SHOTS, 'ohif-viewer-synthetic-study.png') });
    await popup.close();

    await page.goto(`/patients/${patientId}`);
    await page.getByRole('tab', { name: 'Treatment', exact: true }).click();
    await expect(page.getByTestId('xray-open-viewer')).toHaveCount(0);

    // ---- 6. Review list on the PACS page: dismiss removes the entry, nothing is attached ----
    await page.goto('/pacs');
    const rows = page.getByTestId('pacs-unmatched-row');
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: path.join(SHOTS, 'pacs-review-list.png'), fullPage: true });
    const review = (await reviewList()).find((s) => s.studyUid === strayB.studyUid);
    expect((await request.post('/api/pacs/unmatched', { data: { id: review.id, action: 'attach', serviceRequestId: foreignOrder.id } })).status()).toBe(403); // foreign order
    expect((await request.post('/api/pacs/unmatched', { data: { id: review.id, action: 'dismiss' } })).status()).toBe(200);
    expect((await reviewList()).some((s) => s.studyUid === strayB.studyUid)).toBe(false);
  } finally {
    for (const remove of cleanup.reverse()) await remove().catch(() => undefined);
    for (const id of orthancIds) await fetch(`${ORTHANC}/studies/${id}`, { method: 'DELETE', headers: { Authorization: AUTH! } }).catch(() => undefined);
    await m.deleteResource('Patient', patientId).catch(() => undefined);
  }
});
