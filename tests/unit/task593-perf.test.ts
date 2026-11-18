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
    const { c } = client({});
    const t0 = performance.now();
    const tenant = await resolveClinicTenant(c, 'demo');
    expect(tenant?.organizationId).toBe('search-org');
    expect(performance.now() - t0).toBeLessThan(75); // serial read-then-search would be >= 80 ms
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

  it('runs the history searches alongside the tenant lookup', async () => {
    const { c } = client('demo');
    const t0 = performance.now();
    const result = await getPatientFromMedplum('p1', 'demo', c);
    expect(result?.fullName).toBe('Fake Patient');
    // tenant ~60 ms || history ~40 ms after a 5 ms read -> ~65 ms; serial would be >= 105 ms.
    expect(performance.now() - t0).toBeLessThan(95);
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
