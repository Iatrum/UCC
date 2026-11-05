import { test, expect, type APIRequestContext } from '@playwright/test';
import type { Organization } from '@medplum/fhirtypes';
import type { MedplumClient } from '@medplum/core';
import { fhir } from '../lib/fhir';
import { randomUUID } from 'node:crypto';

// Mirrors lib/module-settings.ts: same toggle mechanism an admin flips in /admin/clinics,
// reused here for "pacs" (X-ray/imaging module route) the same way e2e/tests/poct.spec.ts
// already exercises it for "poct" (lab).
//
// Scope note: /pacs and /pacs/new are the dedicated PACS module pages (already gated via
// app/(routes)/pacs/layout.tsx -> loadEnabledModulePage). The generic "order a catalog lab
// or imaging test from the treatment composer / patient Labs & Imaging tab" workflow
// (components/labs/lab-order-form.tsx, components/imaging/imaging-order-form.tsx, and the
// composer's plain catalog search) is a separate, long-predating, module-independent clinic
// feature -- it existed before the "poct"/"pacs" modules were introduced and must keep
// working regardless of their toggle state (workflow.spec.ts test 06/07 exercise exactly
// this path against the demo clinic, which has both modules off by default). This spec does
// not gate that path; only the dedicated module route is in scope here.
const moduleExtensionUrl = 'https://ucc.emr/organization-enabled-module-ids';
const defaultBranchEnabledModuleIds = ['appointments', 'inventory', 'analytics', 'follow-up'];

async function setModuleEnabled(m: MedplumClient, clinicId: string, moduleId: string, enabled: boolean) {
  const org = await m.searchOne('Organization', { identifier: `clinic|${clinicId}` });
  if (!org?.id) throw new Error(`Organization for clinic ${clinicId} not found`);
  const existingExtension = org.extension?.find((ext) => ext.url === moduleExtensionUrl);
  const currentIds: string[] = existingExtension?.valueString
    ? JSON.parse(existingExtension.valueString)
    : [...defaultBranchEnabledModuleIds];
  if (currentIds.includes(moduleId) === enabled) return async () => {};

  const nextIds = enabled ? [...currentIds, moduleId] : currentIds.filter((id) => id !== moduleId);
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

async function fakeClinicId(request: APIRequestContext) {
  const suffix = randomUUID().slice(0, 8);
  const created = await request.post('/api/patients', {
    data: { fullName: `PACS Fake ${suffix}`, nric: `FAKE-PACS-${suffix}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000' },
  });
  expect(created.ok()).toBeTruthy();
  const { patientId } = await created.json();
  const m = await fhir();
  const patient = await m.readResource('Patient', patientId);
  const clinicId = patient.identifier?.find((id) => id.system === 'clinic')?.value;
  expect(['demo', 'clinicb', 'clinicc', 'clinicd']).toContain(clinicId);
  return { m, clinicId: clinicId! };
}

test.describe('PACS (X-ray/imaging) module route toggle', () => {
  test('disabled by default: /pacs and /pacs/new show the friendly disabled page, not the module', async ({ request, page }) => {
    const { m, clinicId } = await fakeClinicId(request);
    const restore = await setModuleEnabled(m, clinicId, 'pacs', false);
    try {
      await page.goto('/pacs');
      await expect(page.getByText('PACS is not enabled for this clinic yet').first()).toBeVisible();

      await page.goto('/pacs/new');
      await expect(page.getByText('PACS is not enabled for this clinic yet').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: 'New Imaging Order' })).toHaveCount(0);
    } finally {
      await restore();
    }
  });

  test('enabled: /pacs and /pacs/new render the module', async ({ request, page }) => {
    const { m, clinicId } = await fakeClinicId(request);
    const restore = await setModuleEnabled(m, clinicId, 'pacs', true);
    try {
      await page.goto('/pacs');
      await expect(page.getByText('PACS is not enabled for this clinic yet').first()).toHaveCount(0);
      await expect(page.getByText('Medical Imaging', { exact: false }).first()).toBeVisible();

      await page.goto('/pacs/new');
      await expect(page.getByText('PACS is not enabled for this clinic yet').first()).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'New Imaging Order' })).toBeVisible();
    } finally {
      await restore();
    }
  });
});
