import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { NextRequest } from 'next/server';

// Task 744: server-side clinic scope resolution. Host wins; the cookie is only the localhost/apex fallback.
let cookieValue: string | undefined;
let headerMap: Record<string, string> = {};
mock.module('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (n === 'medplum-clinic' && cookieValue ? { value: cookieValue } : undefined) }),
  headers: async () => new Headers(headerMap),
}));
const { CLINIC_COOKIE } = await import('../../lib/server/cookie-constants');
const { getClinicIdFromRequest, resolveClinicIdFromServerScope } = await import('../../lib/server/clinic.ts?task744');

const req = (host: string, cookie?: string, extra: Record<string, string> = {}) =>
  new NextRequest(`https://${host}/api/x`, { headers: { host, ...(cookie ? { cookie: `${CLINIC_COOKIE}=${cookie}` } : {}), ...extra } });

beforeEach(() => { cookieValue = undefined; headerMap = {}; });

describe('getClinicIdFromRequest', () => {
  it('uses the host subdomain and ignores a conflicting cookie and x-clinic-id header', async () => {
    cookieValue = 'cookie-clinic';
    expect(await getClinicIdFromRequest(req('fake-a.iatrum.com', 'cookie-clinic', { 'x-clinic-id': 'spoofed' }))).toBe('fake-a');
  });
  it('prefers x-forwarded-host over host', async () => {
    expect(await getClinicIdFromRequest(req('internal.example.com', undefined, { 'x-forwarded-host': 'fake-b.iatrum.com, proxy' }))).toBe('fake-b');
  });
  it('falls back to the request cookie, then the server cookie store, on localhost / apex / admin hosts', async () => {
    expect(await getClinicIdFromRequest(req('localhost:3210', 'from-req'))).toBe('from-req');
    cookieValue = 'from-store';
    expect(await getClinicIdFromRequest(req('localhost:3210'))).toBe('from-store');
    expect(await getClinicIdFromRequest(req('admin.iatrum.com'))).toBe('from-store');
    expect(await getClinicIdFromRequest(req('www.iatrum.com'))).toBe('from-store');
  });
  it('returns null when there is no host clinic and no cookie', async () => {
    expect(await getClinicIdFromRequest(req('localhost:3210'))).toBeNull();
  });
});

describe('resolveClinicIdFromServerScope', () => {
  it('uses the host subdomain first', async () => {
    headerMap = { host: 'fake-c.iatrum.com' };
    cookieValue = 'cookie-clinic';
    expect(await resolveClinicIdFromServerScope()).toBe('fake-c');
  });
  it('falls back to the cookie, else undefined', async () => {
    headerMap = { host: 'localhost:3210' };
    expect(await resolveClinicIdFromServerScope()).toBeUndefined();
    cookieValue = 'from-store';
    expect(await resolveClinicIdFromServerScope()).toBe('from-store');
  });
});
