import { describe, expect, it } from 'bun:test';
import { env } from '../../lib/env';
import type { MedplumClient } from '@medplum/core';
import { ForbiddenError, handleRouteError } from '../../lib/server/route-helpers';
import { updatePatientDocument } from '../../lib/fhir/document-service';
import { updateBillingExceptionTaskStatus } from '../../lib/fhir/billing-task-service';
import { updateReferralInMedplum } from '../../lib/fhir/referral-service';
import { markFollowUpOpened, updateFollowUpStatus, sendFollowUpWithTwilio } from '../../lib/fhir/communication-service';

// Synthetic fixtures only; no live Medplum, Storage or Twilio calls.
function fixture(type: string, clinic: string | undefined = 'clinic-a') {
  const original: any = {
    resourceType: type, id: 'fake-record', status: type === 'Task' ? 'requested' : 'active',
    identifier: clinic ? [{ system: 'clinic', value: clinic }, { system: 'fake', value: 'keep' }] : [],
    meta: { accounts: [{ reference: 'HealthcareService/fake-account' }] },
    content: [{ attachment: { title: 'Old title', url: 'https://example.invalid/fake.pdf' } }],
    extension: [
      { url: 'https://ucc.emr/communication/clinic-id', valueString: clinic },
      { url: 'https://ucc.emr/task/clinic-id', valueString: clinic },
    ],
  };
  const writes: any[] = [], reads: any[] = [];
  const client = {
    async readResource(resourceType: string, id: string, options: unknown) {
      reads.push({ resourceType, id, options });
      return structuredClone(original);
    },
    async updateResource(resource: any) { writes.push(resource); return resource; },
  } as unknown as MedplumClient;
  return { client, original, writes, reads };
}
const cases = [
  { name: 'document', type: 'DocumentReference', run: (m: MedplumClient, clinicId?: string) => updatePatientDocument(m, 'fake-record', { title: 'New title', clinicId }), check: (r: any) => expect(r.content[0].attachment.title).toBe('New title') },
  { name: 'billing status', type: 'Task', run: (m: MedplumClient, clinicId?: string) => updateBillingExceptionTaskStatus(m, 'fake-record', 'completed', 'Fake note', clinicId), check: (r: any) => { expect(r.status).toBe('completed'); expect(r.note[0].text).toBe('Fake note'); } },
  { name: 'referral', type: 'ServiceRequest', run: (m: MedplumClient, clinicId?: string) => updateReferralInMedplum(m, 'fake-record', { status: 'completed', reason: 'Fake reason' }, clinicId), check: (r: any) => { expect(r.status).toBe('completed'); expect(r.reasonCode[0].text).toBe('Fake reason'); } },
  { name: 'follow-up status', type: 'Communication', run: (m: MedplumClient, clinicId?: string) => updateFollowUpStatus(m, 'fake-record', 'completed', clinicId), check: (r: any) => { expect(r.status).toBe('completed'); expect(r.sent).toBeDefined(); } },
  { name: 'follow-up opened', type: 'Communication', run: (m: MedplumClient, clinicId?: string) => markFollowUpOpened(m, 'fake-record', clinicId), check: (r: any) => expect(r.extension).toContainEqual({ url: 'https://ucc.emr/communication/delivery-status', valueString: 'opened' }) },
];
async function forbidden(p: Promise<unknown>) {
  const error = await p.then(() => undefined, e => e);
  expect(error).toBeInstanceOf(ForbiddenError);
  expect(handleRouteError(error, 'synthetic Task 400 test').status).toBe(403);
}
describe('Task 400 update-by-id clinic containment', () => {
  for (const c of cases) {
    it(`${c.name}: foreign clinic returns 403 and writes nothing`, async () => {
      const f = fixture(c.type, 'clinic-b');
      await forbidden(c.run(f.client, 'clinic-a'));
      expect(f.writes).toHaveLength(0);
    });
    it(`${c.name}: own clinic preserves ownership and updates requested fields`, async () => {
      const f = fixture(c.type);
      await c.run(f.client, 'clinic-a');
      expect(f.writes).toHaveLength(1);
      c.check(f.writes[0]);
      expect(f.writes[0].identifier).toEqual(f.original.identifier);
      expect(f.writes[0].meta).toEqual(f.original.meta);
      expect(f.reads[0]).toEqual({ resourceType: c.type, id: 'fake-record', options: { cache: 'no-cache', headers: { 'X-Medplum': 'extended' } } });
    });
    it(`${c.name}: missing caller clinic, untagged and mixed-clinic records fail closed`, async () => {
      const missing = fixture(c.type);
      await forbidden(c.run(missing.client));
      expect(missing.writes).toHaveLength(0);
      const untagged = fixture(c.type); untagged.original.identifier = [];
      await forbidden(c.run(untagged.client, 'clinic-a'));
      expect(untagged.writes).toHaveLength(0);
      const mixed = fixture(c.type);
      mixed.original.identifier.push({ system: 'clinic', value: 'clinic-b' });
      await forbidden(c.run(mixed.client, 'clinic-a'));
      expect(mixed.writes).toHaveLength(0);
    });
  }
  it('billing checks ownership even for a no-op transition', async () => {
    const f = fixture('Task', 'clinic-b');
    await forbidden(updateBillingExceptionTaskStatus(f.client, 'fake-record', 'requested', undefined, 'clinic-a'));
    expect(f.writes).toHaveLength(0);
    const own = fixture('Task');
    expect(await updateBillingExceptionTaskStatus(own.client, 'fake-record', 'requested', undefined, 'clinic-a')).toEqual(own.original);
    expect(own.writes).toHaveLength(0);
  });
  it('Twilio send rejects foreign clinic before config/network/error-status writes', async () => {
    const f = fixture('Communication', 'clinic-b');
    await forbidden(sendFollowUpWithTwilio(f.client, 'fake-record', 'clinic-a'));
    expect(f.writes).toHaveLength(0);
    expect(f.reads).toHaveLength(1);
  });
  it('own-clinic Twilio send still queues a message using a fake transport', async () => {
    const f = fixture('Communication');
    f.original.extension.push({ url: 'https://ucc.emr/communication/patient-phone', valueString: '0000000000' });
    const fields = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_WHATSAPP_FROM'] as const;
    const saved = fields.map(key => env[key]);
    const originalFetch = globalThis.fetch;
    let sent = 0;
    try {
      for (const key of fields) (env as any)[key] = 'fake-test-only';
      globalThis.fetch = (async () => {
        sent++;
        return new Response(JSON.stringify({ sid: 'fake-sid', status: 'queued' }), { status: 200 });
      }) as typeof fetch;
      const result = await sendFollowUpWithTwilio(f.client, 'fake-record', 'clinic-a');
      expect(sent).toBe(1);
      expect(result.status).toBe('in-progress');
      expect(f.writes).toHaveLength(1);
      expect(f.writes[0].identifier).toEqual(f.original.identifier);
      expect(f.writes[0].meta).toEqual(f.original.meta);
    } finally {
      globalThis.fetch = originalFetch;
      fields.forEach((key, i) => { (env as any)[key] = saved[i]; });
    }
  });

});
