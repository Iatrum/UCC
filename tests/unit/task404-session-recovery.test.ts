import { describe, expect, it } from 'bun:test';
import { parseOptions, revokeStaffSessions } from '../../scripts/access-policy/revoke-staff-sessions.mjs';

// Disposable HTTP simulation; no credentials, real sessions, or network access.
function fixture(overrides: Record<string, any> = {}) {
  const records: any[] = [
    { resourceType: 'Login', id: 'fake-absent', user: { reference: 'User/fake-user' }, meta: { versionId: '1' } },
    { resourceType: 'Login', id: 'fake-false', user: { reference: 'User/fake-user' }, meta: { versionId: '2' }, revoked: false },
    { resourceType: 'Login', id: 'fake-revoked', user: { reference: 'User/fake-user' }, meta: { versionId: '3' }, revoked: true },
  ];
  const calls: any[] = [];
  let revoked = false;
  const env = { MEDPLUM_ADMIN_EMAIL: 'fake-operator@example.invalid', MEDPLUM_ADMIN_PASSWORD: 'fake-only',
    UCC_PROBE_EMAIL: 'fake-staff@example.invalid', UCC_PROBE_PASSWORD: 'fake-only', UCC_PROBE_PROJECT: 'fake-clinical' };
  const options = { user: 'fake-user', operatorProject: 'fake-ops' };
  const response = (status: number, body: any) => new Response(JSON.stringify(body), { status });
  const fetcher = async (input: URL, init: any) => {
    const url = new URL(input);
    calls.push({ url, ...init });
    expect(url.origin).toBe('http://127.0.0.1:8113');
    expect(init.redirect).toBe('error');
    if (url.pathname === '/auth/login') {
      const body = JSON.parse(init.body);
      expect(body.codeChallengeMethod).toBe('S256');
      expect(body.password).toBe('fake-only');
      expect(body.scope).toBe(body.email === env.UCC_PROBE_EMAIL ? 'openid offline_access' : 'openid');
      return response(200, { code: body.email === env.UCC_PROBE_EMAIL ? 'fake-staff-code' : 'fake-operator-code' });
    }
    if (url.pathname === '/oauth2/token') {
      const form = new URLSearchParams(init.body);
      expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded');
      if (form.get('grant_type') === 'refresh_token') {
        if (overrides.refreshBaselineFails && !revoked) return response(400, { error: 'invalid_grant' });
        if (revoked) return response(400, { error: overrides.refreshError || 'invalid_grant' });
        return response(200, { access_token: 'fake-staff-rotated', refresh_token: 'fake-refresh-rotated' });
      }
      return response(200, { access_token: form.get('code') === 'fake-staff-code' ? 'fake-staff-access' : 'fake-operator-access', refresh_token: 'fake-refresh' });
    }
    if (url.pathname === '/auth/me') {
      const staff = init.headers.authorization.startsWith('Bearer fake-staff');
      if (staff && revoked && !overrides.oldTokenWorks) return response(401, {});
      return response(200, {
        project: { id: staff ? 'fake-clinical' : 'fake-ops', superAdmin: staff ? false : !overrides.notSuperAdmin },
        membership: { admin: !staff, user: { reference: staff || overrides.self ? 'User/fake-user' : 'User/fake-operator' } },
      });
    }
    if (init.method === 'PUT') {
      if (overrides.conflict) return response(412, {});
      const saved = JSON.parse(init.body);
      const original = records.find(r => r.id === saved.id);
      expect(init.headers['If-Match']).toBe(`W/"${original.meta.versionId}"`);
      expect(saved).toEqual({ ...original, revoked: true });
      original.revoked = true;
      revoked = records.every(r => r.revoked === true);
      return response(200, saved);
    }
    expect(url.pathname).toBe('/fhir/R4/Login');
    expect(url.searchParams.get('user')).toBe('User/fake-user');
    expect(url.searchParams.has('revoked:missing')).toBe(false);
    if (url.searchParams.has('page')) {
      if (overrides.pageFails) return response(403, { resourceType: 'OperationOutcome' });
      const last = structuredClone(records.slice(1));
      if (overrides.foreign) last[0].user.reference = 'User/foreign-user';
      if (overrides.badBoolean) last[0].revoked = 'false';
      if (overrides.noVersion) delete last[0].meta.versionId;
      if (overrides.duplicate) last.push(records[0]);
      return response(200, { resourceType: 'Bundle', type: 'searchset', entry: last.map(resource => ({ resource })),
        link: overrides.loop ? [{ relation: 'next', url: url.href }] : [] });
    }
    return response(200, { resourceType: 'Bundle', type: 'searchset', entry: [{ resource: records[0] }],
      link: [{ relation: 'next', url: overrides.next || 'http://localhost:8113/fhir/R4/Login?user=User%2Ffake-user&_count=100&page=2' }] });
  };
  return { env, options, fetcher, calls, records };
}

describe('Task 404 session recovery', () => {
  it('previews both pages and filters absent/false/true revoked locally without writes', async () => {
    const f = fixture();
    expect(await revokeStaffSessions(f.options, f.env, f.fetcher)).toEqual({ mode: 'PREVIEW', pages: 2, found: 3, toRevoke: 2 });
    expect(f.calls.filter(c => c.method === 'PUT')).toHaveLength(0);
  });
  it('revokes all active sessions with If-Match, preserves fields and is idempotent', async () => {
    const f = fixture();
    const result = await revokeStaffSessions({ ...f.options, apply: true }, f.env, f.fetcher);
    expect(result.revoked).toBe(2);
    expect(f.calls.filter(c => c.method === 'PUT')).toHaveLength(2);
    expect((await revokeStaffSessions({ ...f.options, apply: true }, f.env, f.fetcher)).revoked).toBe(0);
  });
  it('proves issued access and rotated refresh work before revocation and fail after', async () => {
    const f = fixture();
    const result = await revokeStaffSessions({ ...f.options, apply: true, verifyFakeSession: true }, f.env, f.fetcher);
    expect(result.fakeSessionVerified).toBe(true);
    const refreshes = f.calls.filter(c => c.url.pathname === '/oauth2/token' && new URLSearchParams(c.body).get('grant_type') === 'refresh_token');
    expect(refreshes).toHaveLength(2);
    expect(new URLSearchParams(refreshes[1].body).get('refresh_token')).toBe('fake-refresh-rotated');
  });
  for (const [name, overrides] of Object.entries({
    'error on a later page': { pageFails: true }, 'foreign User': { foreign: true },
    'invalid revoked value': { badBoolean: true }, 'missing version': { noVersion: true },
    'duplicate Login': { duplicate: true }, 'pagination cycle': { loop: true },
    'external pagination': { next: 'https://untrusted.invalid/fhir/R4/Login' },
    'wrong pagination resource': { next: '/fhir/R4/User' },
    'non-super-admin': { notSuperAdmin: true }, 'operator self-revocation': { self: true },
  })) {
    it(`refuses ${name} before any mutation`, async () => {
      const f = fixture(overrides);
      await expect(revokeStaffSessions({ ...f.options, apply: true }, f.env, f.fetcher)).rejects.toThrow();
      expect(f.calls.filter(c => c.method === 'PUT')).toHaveLength(0);
    });
  }
  it('stops on a version conflict without writing later records', async () => {
    const f = fixture({ conflict: true });
    await expect(revokeStaffSessions({ ...f.options, apply: true }, f.env, f.fetcher)).rejects.toThrow('Revocation failed');
    expect(f.calls.filter(c => c.method === 'PUT')).toHaveLength(1);
  });
  for (const overrides of [{ oldTokenWorks: true }, { refreshError: 'invalid_request' }, { refreshBaselineFails: true }]) {
    it(`does not claim verification on a failed access/refresh probe ${JSON.stringify(overrides)}`, async () => {
      const f = fixture(overrides);
      await expect(revokeStaffSessions({ ...f.options, apply: true, verifyFakeSession: true }, f.env, f.fetcher)).rejects.toThrow();
    });
  }
  it('rejects remote origins before authentication unless HTTPS and explicitly allowed', async () => {
    const f = fixture();
    for (const target of ['https://untrusted.invalid', 'http://localhost:8113', 'http://127.0.0.1:8113/path']) {
      await expect(revokeStaffSessions(f.options, { ...f.env, MEDPLUM_BASE_URL: target }, f.fetcher)).rejects.toThrow();
    }
    expect(f.calls).toHaveLength(0);
  });
  it('requires apply for fake-session rehearsal and rejects malformed/repeated CLI options', async () => {
    const f = fixture();
    await expect(revokeStaffSessions({ ...f.options, verifyFakeSession: true }, f.env, f.fetcher)).rejects.toThrow();
    expect(parseOptions(['--user', 'fake-user', '--operator-project', 'fake-ops', '--apply'])).toEqual({ ...f.options, apply: true });
    for (const args of [['--user'], ['--apply', '--apply'], ['--unknown'], ['--user', '--apply']]) expect(() => parseOptions(args)).toThrow();
  });
});
