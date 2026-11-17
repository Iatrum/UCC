import { describe, expect, it } from 'bun:test';
import { OperationOutcomeError, notFound, type MedplumClient } from '@medplum/core';
import { deleteLabOrder, updateLabOrder } from '../../lib/fhir/lab-service';
import { deleteImagingOrder, updateImagingOrder } from '../../lib/fhir/imaging-service';
import { ForbiddenError, NotFoundError, handleRouteError } from '../../lib/server/route-helpers';

// Task 482: lab/imaging order update/delete helpers must assert the STORED order's clinic
// before any write (not only module gates + Medplum AccessPolicy). Fake data only; the fake
// server is an unrestricted client, so no AccessPolicy can mask a missing service guard.
const clinicId = 'fake-clinic-a';
const own = { system: 'clinic', value: clinicId };
const foreign = { system: 'clinic', value: 'fake-clinic-b' };
const account = { reference: 'HealthcareService/fake-account-a' };
const foreignAccount = { reference: 'HealthcareService/fake-account-b' };

function fakeServer(overrides: Record<string, unknown> = {}) {
  let stored: any = structuredClone({
    resourceType: 'ServiceRequest', id: 'fake-order', status: 'active', intent: 'order',
    subject: { reference: 'Patient/fake-patient' }, identifier: [own], priority: 'routine', ...overrides,
  });
  const reads: any[] = [];
  const writes: any[] = [];
  const client = {
    async readResource(type: string, id: string, options: any) {
      reads.push({ type, id, options });
      if (type === 'Organization') return { resourceType: type, id };
      if (!stored) throw new OperationOutcomeError(notFound);
      const result = structuredClone(stored);
      // Like Medplum: meta.accounts is only returned with the extended header.
      if (options?.headers?.['X-Medplum'] !== 'extended') delete result.meta?.accounts;
      return result;
    },
    async searchOne(type: string) { return type === 'HealthcareService' ? { resourceType: type, id: 'fake-account-a' } : undefined; },
    async updateResource(resource: any) { writes.push({ method: 'PUT', resource: structuredClone(resource) }); stored = structuredClone(resource); return resource; },
    async deleteResource(type: string, id: string) { writes.push({ method: 'DELETE', type, id }); stored = undefined; },
  } as unknown as MedplumClient;
  return { client, reads, writes, stored: () => stored };
}

const cases = [
  { name: 'updateLabOrder', update: true, run: (m: MedplumClient, c: string) => updateLabOrder('fake-order', { priority: 'urgent' }, m, c) },
  { name: 'deleteLabOrder', update: false, run: (m: MedplumClient, c: string) => deleteLabOrder('fake-order', m, c) },
  { name: 'updateImagingOrder', update: true, run: (m: MedplumClient, c: string) => updateImagingOrder('fake-order', { priority: 'urgent' }, m, c) },
  { name: 'deleteImagingOrder', update: false, run: (m: MedplumClient, c: string) => deleteImagingOrder('fake-order', m, c) },
];

for (const c of cases) describe(c.name, () => {
  for (const [name, overrides] of [
    ['foreign clinic', { identifier: [foreign] }],
    ['untagged order', { identifier: [] }],
    ['absent identifier', { identifier: undefined }],
    ['conflicting clinic identifiers', { identifier: [own, foreign] }],
    ['foreign account despite own identifier', { meta: { accounts: [foreignAccount] } }],
    ['mixed accounts despite own identifier', { meta: { accounts: [account, foreignAccount] } }],
  ] as const) {
    it(`${name} => 404 NotFoundError and zero writes`, async () => {
      const server = fakeServer(overrides as any);
      const before = structuredClone(server.stored());
      const error = await c.run(server.client, clinicId).then(() => undefined, e => e);
      expect(error).toBeInstanceOf(NotFoundError);
      expect(handleRouteError(error, 'fake order containment')).toHaveProperty('status', 404);
      expect(server.writes).toHaveLength(0);
      expect(server.stored()).toEqual(before);
    });
  }

  for (const caller of ['', undefined as unknown as string]) {
    it(`missing caller clinic (${JSON.stringify(caller)}) => 403 and zero writes`, async () => {
      const server = fakeServer();
      const error = await c.run(server.client, caller).then(() => undefined, e => e);
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(handleRouteError(error, 'fake order containment')).toHaveProperty('status', 403);
      expect(server.writes).toHaveLength(0);
    });
  }

  it('missing order => 404 and zero writes', async () => {
    const server = fakeServer();
    (server as any).client.readResource = async () => { throw new OperationOutcomeError(notFound); };
    const error = await c.run(server.client, clinicId).then(() => undefined, e => e);
    expect(handleRouteError(error, 'fake order read')).toHaveProperty('status', 404);
    expect(server.writes).toHaveLength(0);
  });

  for (const withAccount of [false, true]) it(`own clinic succeeds (${withAccount ? 'with account' : 'identifier only'})`, async () => {
    const server = fakeServer(withAccount ? { meta: { accounts: [account] } } : {});
    await c.run(server.client, clinicId);
    expect(server.reads[0]).toEqual({ type: 'ServiceRequest', id: 'fake-order', options: { cache: 'no-cache', headers: { 'X-Medplum': 'extended' } } });
    expect(server.writes).toHaveLength(1);
    if (c.update) {
      const result = server.writes[0].resource;
      expect(result.priority).toBe('urgent');
      expect(result.identifier).toEqual([own]);
      if (withAccount) expect(result.meta.accounts).toEqual([account]);
    } else {
      expect(server.writes[0]).toEqual({ method: 'DELETE', type: 'ServiceRequest', id: 'fake-order' });
    }
  });
});
