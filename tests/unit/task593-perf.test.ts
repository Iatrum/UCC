import { describe, expect, it } from 'bun:test';
import { resolveClinicTenant } from '../../lib/fhir/clinic-tenancy';
import { getPatientFromMedplum } from '../../lib/fhir/patient-service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Organization lookup overlaps the direct read and the identifier search (Task 593)', () => {
  function client(opts: { directOk?: boolean; searchFails?: boolean }) {
    const calls: string[] = [];
    const c: any = {
      async readResource() {
        calls.push('read');
        await sleep(40);
        if (!opts.directOk) throw new Error('404');
        return { resourceType: 'Organization', id: 'direct-org' };
      },
      async searchOne(type: string) {
        calls.push(`search:${type}`);
        await sleep(40);
        if (type === 'Organization') {
          if (opts.searchFails) throw new Error('search boom');
          return { resourceType: 'Organization', id: 'search-org' };
        }
        return { resourceType: 'HealthcareService', id: 'acct' };
      },
    };
    return { c, calls };
  }

  it('uses the search result for a slug id without waiting for the 404 first', async () => {
    const { c, calls } = client({});
    const pending = resolveClinicTenant(c, 'demo');
    await Promise.resolve();
    // Deterministic (no wall-clock): both Organization calls are issued before either settles.
    expect(calls).toContain('read');
    expect(calls).toContain('search:Organization');
    expect((await pending)?.organizationId).toBe('search-org');
  });

  it('direct read wins over a successful search that returns a different org', async () => {
    const { c } = client({ directOk: true });
    expect((await resolveClinicTenant(c, 'org-uuid'))?.organizationId).toBe('direct-org');
  });

  it('memoised tenants are never shared across clinics', async () => {
    const { resolveClinicTenantMemo } = await import('../../lib/fhir/clinic-tenancy');
    const c: any = {
      async readResource(_t: string, id: string) { throw new Error('404 ' + id); },
      async searchOne(type: string, params: any) {
        if (type === 'Organization') return { resourceType: 'Organization', id: 'org-' + String(params.identifier).split('|')[1] };
        return { resourceType: 'HealthcareService', id: 'acct' };
      },
    };
    const [a, b] = await Promise.all([resolveClinicTenantMemo(c, 'clinic-a'), resolveClinicTenantMemo(c, 'clinic-b')]);
    expect(a?.organizationId).toBe('org-clinic-a');
    expect(b?.organizationId).toBe('org-clinic-b');
  });

  it('prefers the direct read when it succeeds, even if the search fails', async () => {
    const { c } = client({ directOk: true, searchFails: true });
    const tenant = await resolveClinicTenant(c, 'org-uuid');
    expect(tenant?.organizationId).toBe('direct-org');
  });

  it('surfaces a search failure when the direct read did not succeed', async () => {
    const { c } = client({ searchFails: true });
    await expect(resolveClinicTenant(c, 'demo')).rejects.toThrow('search boom');
  });
});

describe('getPatientFromMedplum (Task 593)', () => {
  const patient = (clinic: string) => ({
    resourceType: 'Patient', id: 'p1', name: [{ text: 'Fake Patient' }],
    identifier: [{ system: 'clinic', value: clinic }],
  });
  function client(clinic: string) {
    const calls: string[] = [];
    const c: any = {
      async readResource(type: string) { calls.push(`read:${type}`); await sleep(5); return type === 'Patient' ? patient(clinic) : { resourceType: 'Organization', id: 'org' }; },
      async searchOne(type: string) {
        calls.push(`searchOne:${type}`); await sleep(60);
        return type === 'Organization' ? { resourceType: 'Organization', id: 'org' } : { resourceType: 'HealthcareService', id: 'acct' };
      },
      async searchResources(type: string) { calls.push(`search:${type}`); await sleep(40); return []; },
    };
    return { c, calls };
  }

  it('runs history searches alongside tenancy and uses the resolved compartment for allergies', async () => {
    const { c, calls } = client('demo');
    const pending = getPatientFromMedplum('p1', 'demo', c);
    await sleep(25); // Patient read (5 ms) done; tenant search (60 ms) still in flight
    expect(calls).toContain('search:Encounter');
    expect(calls).not.toContain('search:AllergyIntolerance');
    expect((await pending)?.fullName).toBe('Fake Patient');
    expect(calls).toContain('search:AllergyIntolerance');
  });

  it('returns null (no unhandled rejection) when the Patient read fails first', async () => {
    const { c } = client('demo');
    c.readResource = async (type: string) => { if (type === 'Patient') throw new Error('boom'); return { id: 'org' }; };
    c.searchOne = async () => { await sleep(10); throw new Error('tenant boom'); };
    expect(await getPatientFromMedplum('p1', 'demo', c)).toBeNull();
    await sleep(30);
  });

  it('does not query history for a patient of another clinic', async () => {
    const { c, calls } = client('other-clinic');
    expect(await getPatientFromMedplum('p1', 'demo', c)).toBeNull();
    expect(calls.filter((x) => x.startsWith('search:'))).toEqual([]);
  });

  it('still returns null when the tenant lookup fails', async () => {
    const { c } = client('demo');
    c.searchOne = async () => { throw new Error('tenant boom'); };
    expect(await getPatientFromMedplum('p1', 'demo', c)).toBeNull();
  });
});
