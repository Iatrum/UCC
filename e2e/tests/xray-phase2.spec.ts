import { test, expect, type Page } from '@playwright/test';
import type { Device, Organization, ServiceRequest } from '@medplum/fhirtypes';
import type { MedplumClient } from '@medplum/core';
import path from 'node:path';
import { fhir } from '../lib/fhir';
import { newDeviceKey } from '../lib/device-key';
import { randomUUID } from 'node:crypto';

// Phase 2: per-clinic PACS viewer host allowlist (default deny) gating the Lab-tab viewer link.
test.use({ trace: 'off' });

const SHOTS = path.join(import.meta.dirname, '../../.ai/ux-shots/task340');
const moduleExt = 'https://ucc.emr/organization-enabled-module-ids';
const hostsExt = 'https://ucc.emr/organization-pacs-viewer-hosts';
const typeSystem = 'https://ucc.emr/xray/device-type';
const propertySystem = 'https://ucc.emr/xray/device-property';
const tagSystem = 'https://ucc.emr/xray';
const ALLOWED = 'viewer.fake-pacs.org';

async function setOrgExtensions(m: MedplumClient, clinicId: string, apply: (ext: NonNullable<Organization['extension']>) => NonNullable<Organization['extension']>) {
  const org = await m.searchOne('Organization', { identifier: `clinic|${clinicId}` });
  if (!org?.id) throw new Error('org missing');
  const original = org.extension ?? [];
  await m.updateResource<Organization>({ ...org, extension: apply([...original]) });
  return async () => { const latest = await m.readResource('Organization', org.id!); await m.updateResource<Organization>({ ...latest, extension: original.length ? original : undefined }); };
}
const withPacsOn = (ext: NonNullable<Organization['extension']>) => {
  const cur = ext.find((e) => e.url === moduleExt);
  const ids: string[] = cur?.valueString ? JSON.parse(cur.valueString) : ['appointments', 'inventory', 'analytics', 'follow-up'];
  return [...ext.filter((e) => e.url !== moduleExt), { url: moduleExt, valueString: JSON.stringify(Array.from(new Set([...ids, 'pacs']))) }];
};
const withHosts = (ext: NonNullable<Organization['extension']>, hosts: string[]) =>
  [...ext.filter((e) => e.url !== hostsExt), ...(hosts.length ? [{ url: hostsExt, valueString: JSON.stringify(hosts) }] : [])];

async function openImaging(page: Page, patientId: string) {
  await page.goto(`/patients/${patientId}/labs-imaging`);
  const tab = page.getByRole('tab', { name: 'Imaging Studies', exact: true });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute('data-state', 'active', { timeout: 2000 });
    await expect(page.getByText('AVAILABLE', { exact: true }).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
}

test('X-ray viewer link: default deny, shown only for allowlisted https host and X-ray modality; hostile URLs never rendered', async ({ request, page }) => {
  const m = await fhir();
  const suffix = randomUUID().slice(0, 8);
  const created = await request.post('/api/patients', { data: { fullName: `Xray2 Fake ${suffix}`, nric: `FAKE-XRAY2-${suffix}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000' } });
  expect(created.ok()).toBeTruthy();
  const { patientId } = await created.json();
  const patient = await m.readResource('Patient', patientId);
  const clinicId = patient.identifier?.find((id) => id.system === 'clinic')?.value as string;
  const restoreOrg = await setOrgExtensions(m, clinicId, withPacsOn);
  const { key, identifier } = newDeviceKey();
  const device = await m.createResource<Device>({ resourceType: 'Device', status: 'active',
    identifier: [{ system: 'clinic', value: clinicId }, identifier], meta: { tag: [{ system: tagSystem, code: 'simulated' }] },
    deviceName: [{ name: `Fake X-ray ${suffix}`, type: 'user-friendly-name' }], type: { coding: [{ system: typeSystem, code: 'xray' }] },
    property: [{ type: { coding: [{ system: propertySystem, code: 'last-heartbeat' }] }, valueCode: [{ text: new Date().toISOString() }] }] });
  const mkSr = (code: string) => m.createResource<ServiceRequest>({ resourceType: 'ServiceRequest', status: 'active', intent: 'order',
    subject: { reference: `Patient/${patientId}` }, performer: [{ reference: `Device/${device.id}` }],
    code: { coding: [{ system: 'http://loinc.org', code, display: 'Chest X-ray (PA)' }] },
    identifier: [{ system: 'clinic', value: clinicId }], meta: { tag: [{ system: tagSystem, code: 'xray' }], account: patient.meta?.account, accounts: patient.meta?.accounts } });
  const ingest = async (srId: string, modality: string, pacsUrl: string, endpoint?: string) => {
    const uid = `1.2.3.${randomUUID()}`;
    const r = await request.post('/api/imaging/receive/message', { headers: { Authorization: `Bearer ${key}` },
      data: { serviceRequestId: srId, study: { studyUid: uid, modality, description: `Fake ${modality}`, numberOfSeries: 1, numberOfInstances: 1, pacsUrl,
        series: [{ uid: `${uid}.1`, number: 1, modality, numberOfInstances: 1, ...(endpoint ? { endpoint } : {}) }] } } });
    expect(r.ok()).toBeTruthy();
  };
  try {
    const good = await mkSr('36643-5');
    await ingest(good.id!, 'DX', `https://${ALLOWED}/viewer?studyUid=1`, 'https://evil.fake-attacker.org/series/1');
    const ctOdd = await mkSr('30746-2'); // X-ray tagged order but a non-X-ray modality reported
    await ingest(ctOdd.id!, 'CT', `https://${ALLOWED}/viewer?studyUid=2`);
    const links = async () => {
      const j = await (await request.get(`/api/imaging/results?patientId=${patientId}`)).json();
      return j.studies.filter((s: any) => s.xray).map((s: any) => ({ modality: s.modality, url: s.study?.pacsUrl, ep: s.study?.series?.map((x: any) => x.endpoint) }));
    };

    // BEFORE: no allowlist configured -> default deny.
    let before: any[] = [];
    await expect(async () => { before = await links(); expect(before).toHaveLength(2); }).toPass({ timeout: 20_000 });
    expect(before.every((s) => !s.url)).toBe(true);
    await openImaging(page, patientId);
    await expect(page.getByTestId('xray-viewer-link')).toHaveCount(0);
    await page.screenshot({ path: path.join(SHOTS, 'before-default-deny.png'), fullPage: true });

    // Look-alike / hostile hosts on the list do not unlock the allowed URL.
    const restoreHosts1 = await setOrgExtensions(m, clinicId, (e) => withHosts(withPacsOn(e), ['viewer.fake-pacs.org.evil.com', 'other.fake-pacs.org', 'viewer.fake-pacs.org:8443']));
    try {
      await expect(async () => { expect((await links()).every((s: any) => !s.url)).toBe(true); }).toPass({ timeout: 20_000 });
    } finally { await restoreHosts1(); await setOrgExtensions(m, clinicId, withPacsOn); }

    // AFTER: exact host allowlisted -> DX link only; CT modality, off-list series endpoint stay hidden.
    const restoreHosts = await setOrgExtensions(m, clinicId, (e) => withHosts(withPacsOn(e), [ALLOWED]));
    try {
      await expect(async () => {
        const after = await links();
        expect(after.find((s: any) => s.modality === 'DX')?.url).toBe(`https://${ALLOWED}/viewer?studyUid=1`);
        expect(after.find((s: any) => s.modality === 'CT')?.url).toBeUndefined();
        expect(after.find((s: any) => s.modality === 'DX')?.ep).toEqual([undefined]);
      }).toPass({ timeout: 20_000 });
      await openImaging(page, patientId);
      const link = page.getByTestId('xray-viewer-link');
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute('href', `https://${ALLOWED}/viewer?studyUid=1`);
      await expect(link).toHaveAttribute('rel', /noopener/);
      await expect(link).toHaveAttribute('target', '_blank');
      await page.screenshot({ path: path.join(SHOTS, 'after-allowlisted-link.png'), fullPage: true });
      // Link is not shown outside the Lab area: composer/Treatment tab carries no viewer link.
      await page.goto(`/patients/${patientId}`);
      await page.getByRole('tab', { name: 'Treatment', exact: true }).click();
      await expect(page.getByTestId('xray-viewer-link')).toHaveCount(0);
    } finally { await restoreHosts(); }
  } finally {
    await m.deleteResource('Device', device.id!);
    await restoreOrg();
  }
});
