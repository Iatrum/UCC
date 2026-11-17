import { test, expect, type APIRequestContext } from '@playwright/test';
import type { Basic, Organization } from '@medplum/fhirtypes';
import type { MedplumClient } from '@medplum/core';
import { fhir } from '../lib/fhir';
import { randomUUID } from 'node:crypto';

// Task 210: in-app Feedback. Fake data only. Records are created by the app via the server directory
// client and read back here with the local super-admin client.
const moduleExtensionUrl = 'https://ucc.emr/organization-enabled-module-ids';
const defaults = ['appointments', 'inventory', 'analytics', 'follow-up'];

async function setFeedbackEnabled(m: MedplumClient, clinicId: string, enabled: boolean) {
  const org = await m.searchOne('Organization', { identifier: `clinic|${clinicId}` }, { cache: 'no-cache' });
  if (!org?.id) throw new Error(`Organization for clinic ${clinicId} not found`);
  const original = org.extension?.find((e) => e.url === moduleExtensionUrl);
  const ids: string[] = original?.valueString ? JSON.parse(original.valueString) : [...defaults];
  const next = enabled ? Array.from(new Set([...ids, 'feedback'])) : ids.filter((i) => i !== 'feedback');
  const others = org.extension?.filter((e) => e.url !== moduleExtensionUrl) ?? [];
  await m.updateResource<Organization>({ ...org, extension: [...others, { url: moduleExtensionUrl, valueString: JSON.stringify(next) }] });
  return async () => {
    const latest = await m.readResource('Organization', org.id!, { cache: 'no-cache' });
    await m.updateResource<Organization>({
      ...latest,
      extension: [...(latest.extension?.filter((e) => e.url !== moduleExtensionUrl) ?? []), ...(original ? [original] : [])],
    });
  };
}

async function clinicOf(request: APIRequestContext) {
  const suffix = randomUUID().slice(0, 8);
  const created = await request.post('/api/patients', {
    data: { fullName: `Feedback Fake ${suffix}`, nric: `FAKE-FB-${suffix}`, dateOfBirth: '1990-01-01', gender: 'female', phone: '0100000000' },
  });
  expect(created.ok()).toBeTruthy();
  const { patientId } = await created.json();
  const m = await fhir();
  const patient = await m.readResource('Patient', patientId);
  return { m, clinicId: patient.identifier!.find((i) => i.system === 'clinic')!.value! };
}

const feedbackRecords = (m: MedplumClient, clinicId: string, title: string) =>
  m.searchResources('Basic', { identifier: `clinic|${clinicId}`, code: 'https://ucc.emr/feedback/kind|feature-request' }, { cache: 'no-cache' })
    .then((rs) => rs.filter((r) => r.extension?.some((e) => e.url.endsWith('/title') && e.valueString === title)));

test.describe('Feedback module', () => {
  test('toggle off (default): no Feedback control and API is 404', async ({ request, page }) => {
    const { m, clinicId } = await clinicOf(request);
    const restore = await setFeedbackEnabled(m, clinicId, false);
    try {
      await page.goto('/dashboard');
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page.getByTestId('feedback-trigger')).toHaveCount(0);
      const res = await request.post('/api/feedback', { data: { kind: 'feature', title: 'Should not be stored' } });
      expect(res.status()).toBe(404);
    } finally { await restore(); }
  });

  test('toggle on: feature request form stores once and counts a repeat; PII scrubbed', async ({ request, page }) => {
    const { m, clinicId } = await clinicOf(request);
    const restore = await setFeedbackEnabled(m, clinicId, true);
    // Numeric/ID-like hex suffixes are intentionally redacted by the privacy scrubber.
    const suffix = randomUUID().slice(0, 6).replace(/[0-9]/g, digit => 'ghijklmnop'[Number(digit)]);
    const title = `Dark mode ${suffix}`;
    try {
      await page.goto('/dashboard');
      await page.getByTestId('feedback-trigger').click();
      await expect(page.getByTestId('feedback-dialog')).toBeVisible();
      await page.getByTestId('feedback-kind-feature').click();
      await page.getByLabel('Title').fill(title);
      await page.getByLabel('What would you like?').fill('Please. Contact 900101-14-5678 or ali@example.com');
      await page.getByTestId('feedback-submit').click();
      await expect(page.getByTestId('feedback-done')).toBeVisible();

      // Same request again (reworded) from the same user must not create a second record or double count.
      const again = await request.post('/api/feedback', { data: { kind: 'feature', title: title.toUpperCase(), description: 'x' } });
      expect(again.status()).toBe(201);
      expect((await again.json()).result.status).toBe('already-counted');

      const rows = await feedbackRecords(m, clinicId, title);
      expect(rows).toHaveLength(1);
      const json = JSON.stringify(rows[0]);
      expect(json).not.toMatch(/900101|ali@example/);
      expect(json).toContain('REDACTED-IC');
      expect(rows[0].extension!.filter((e) => e.url.endsWith('/requester'))).toHaveLength(1);
    } finally {
      for (const r of await feedbackRecords(m, clinicId, title)) await m.deleteResource('Basic', r.id!);
      await restore();
    }
  });

  test('bug without GitHub token is queued sanitized; screenshot needs the no-patient-data confirmation', async ({ request }) => {
    const { m, clinicId } = await clinicOf(request);
    const restore = await setFeedbackEnabled(m, clinicId, true);
    const title = `Bug ${randomUUID().slice(0, 6)}`;
    try {
      const png = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]).toString('base64');
      const noConfirm = await request.post('/api/feedback', { data: { kind: 'bug', title, screenshot: png } });
      expect(noConfirm.status()).toBe(400);
      const res = await request.post('/api/feedback', {
        data: { kind: 'bug', title, description: 'Patient name: Fake Person fails, IC 900101145678', page: '/patients/12345678', screenshot: png, screenshotNoPatientData: true },
      });
      expect(res.status()).toBe(201);
      const { result } = await res.json();
      // GITHUB_FEEDBACK_TOKEN is not set on the dev server, so the bug must be queued (never lost).
      expect(['queued', 'issue-created']).toContain(result.status);
      if (result.status === 'queued') {
        const rec = await m.readResource('Basic', result.recordId, { cache: 'no-cache' }) as Basic;
        const json = JSON.stringify(rec);
        expect(json).not.toMatch(/Fake Person|900101/);
        expect(json).toContain('/patients/:id');
        expect(json).toContain('screenshot');
        await m.deleteResource('Basic', rec.id!);
      }
    } finally { await restore(); }
  });
});
