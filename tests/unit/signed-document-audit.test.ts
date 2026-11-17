import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

// Capture the real modules first so the mocks can be undone (bun mock.module is process-global).
const realAdmin = { ...(await import('../../lib/server/medplum-admin')) };
const realTenancy = { ...(await import('../../lib/fhir/clinic-tenancy')) };

const created: any[] = [];
const stamped: any[] = [];
const writer = { createResource: mock(async (r: any) => { const c = { ...r, id: 'prov-1' }; created.push(c); return c; }) };

mock.module('@/lib/server/medplum-admin', () => ({ getAdminMedplum: async () => writer }));
mock.module('../../lib/fhir/clinic-tenancy', () => ({
  ...realTenancy,
  getResourceAccountReferences: (r: any) => r.meta?.accounts ?? [],
  assignResourceToAccountReferences: async (_w: any, type: string, res: any, accounts: any[]) => { stamped.push({ type, id: res.id, accounts }); },
}));

const { auditSignedDocument } = await import('../../lib/fhir/signed-document-audit');

const ACCOUNT = { reference: 'HealthcareService/clinic-a' };
const client = (procedure: any = { resourceType: 'Procedure', id: 'proc-1', meta: { accounts: [ACCOUNT] } }) => ({
  readResource: mock(async () => procedure),
  getProfileAsync: async () => ({ resourceType: 'Practitioner', id: 'pr-1' }),
}) as any;
const tenant = { accountReference: ACCOUNT.reference };

afterAll(() => {
  mock.module('@/lib/server/medplum-admin', () => realAdmin);
  mock.module('../../lib/fhir/clinic-tenancy', () => realTenancy);
});

beforeEach(() => { created.length = 0; stamped.length = 0; writer.createResource.mockClear(); });

describe('MC / referral Provenance', () => {
  for (const kind of ['mc', 'referral']) {
    test(`${kind}: writes one CREATE Provenance targeting the Procedure with agent, org and clinic account`, async () => {
      await auditSignedDocument(client(), { id: 'proc-1' }, { notes: JSON.stringify({ kind }) }, 'pr-9', 'org-1', 'CREATE', tenant);
      expect(created).toHaveLength(1);
      const p = created[0];
      expect(p.resourceType).toBe('Provenance');
      expect(p.target).toEqual([{ reference: 'Procedure/proc-1' }]);
      expect(p.agent).toEqual([{ who: { reference: 'Practitioner/pr-9' }, onBehalfOf: { reference: 'Organization/org-1' } }]);
      expect(p.activity.coding[0]).toMatchObject({ code: 'CREATE', display: 'create' });
      expect(Number.isNaN(Date.parse(p.recorded))).toBe(false);
      expect(stamped).toEqual([{ type: 'Provenance', id: 'prov-1', accounts: [ACCOUNT] }]);
    });
  }

  test('UPDATE activity is recorded', async () => {
    await auditSignedDocument(client(), { id: 'proc-1' }, { notes: '{"kind":"mc"}' }, 'pr-9', undefined, 'UPDATE', tenant);
    expect(created[0].activity.coding[0].code).toBe('UPDATE');
  });

  test('no Provenance for other documents, bad notes, or a missing id', async () => {
    await auditSignedDocument(client(), { id: 'p' }, { notes: '{"kind":"time-chit"}' }, 'pr', 'o', 'CREATE', tenant);
    await auditSignedDocument(client(), { id: 'p' }, { notes: 'plain text' }, 'pr', 'o', 'CREATE', tenant);
    await auditSignedDocument(client(), { id: 'p' }, {}, 'pr', 'o', 'CREATE', tenant);
    await auditSignedDocument(client(), undefined, { notes: '{"kind":"mc"}' }, 'pr', 'o', 'CREATE', tenant);
    await auditSignedDocument(client(), {}, { notes: '{"kind":"mc"}' }, 'pr', 'o', 'CREATE', tenant);
    expect(created).toHaveLength(0);
  });

  test('audit failure never blocks document creation', async () => {
    const failing = client();
    failing.readResource = mock(async () => { throw new Error('boom'); });
    await expect(auditSignedDocument(failing, { id: 'proc-1' }, { notes: '{"kind":"mc"}' }, 'pr', 'o', 'CREATE', tenant)).resolves.toBeUndefined();
    expect(created).toHaveLength(0);
  });

  test('cross-clinic account cannot be stamped onto the audit record', async () => {
    const other = client({ resourceType: 'Procedure', id: 'proc-1', meta: { accounts: [{ reference: 'HealthcareService/clinic-b' }] } });
    await auditSignedDocument(other, { id: 'proc-1' }, { notes: '{"kind":"mc"}' }, 'pr', 'o', 'CREATE', tenant);
    expect(created).toHaveLength(0);
  });
});
