import { describe, expect, test } from 'bun:test';
import {
  allowedPacsUrl, getPacsHostsFromOrganization, normalizePacsHost, validatePacsHosts,
  withPacsHostsExtension, PACS_HOSTS_EXTENSION_URL,
} from '@/lib/fhir/pacs-allowlist';
import { isXrayModality } from '@/lib/fhir/pacs-link';

describe('normalizePacsHost', () => {
  test('accepts DNS names, lowercases, default port elided', () => {
    expect(normalizePacsHost(' Viewer.Clinic.COM ')).toBe('viewer.clinic.com');
    expect(normalizePacsHost('viewer.clinic.com:443')).toBe('viewer.clinic.com');
    expect(normalizePacsHost('viewer.clinic.com:8443')).toBe('viewer.clinic.com:8443');
  });
  test.each([
    'https://viewer.clinic.com', 'viewer.clinic.com/path', 'u:p@viewer.clinic.com', '*.clinic.com', 'localhost',
    '127.0.0.1', '10.0.0.5', '169.254.169.254', '[::1]', '2130706433', 'intranet', 'pacs.local', 'a.internal',
    'viewer.clinic.com:0', 'viewer.clinic.com:70000', 'viewer.clinic.com.', '-bad.clinic.com', '', 'a b.com', 42,
  ])('rejects %p', (v) => expect(normalizePacsHost(v)).toBeUndefined());
});

describe('validatePacsHosts', () => {
  test('dedupes and reports invalid', () => {
    const r = validatePacsHosts(['a.com', 'A.com', '10.0.0.1']);
    expect(r.hosts).toEqual(['a.com']);
    expect(r.invalid).toEqual(['10.0.0.1']);
  });
  test('caps at 20', () => {
    const many = Array.from({ length: 25 }, (_, i) => `h${i}.clinic.com`);
    expect(validatePacsHosts(many).invalid.length).toBe(1);
  });
});

describe('allowedPacsUrl', () => {
  const hosts = ['viewer.clinic.com', 'pacs.clinic.com:8443'];
  test('default deny with empty list', () => expect(allowedPacsUrl('https://viewer.clinic.com/x', [])).toBeUndefined());
  test('allows exact host', () => expect(allowedPacsUrl('https://viewer.clinic.com/v?uid=1', hosts)).toBe('https://viewer.clinic.com/v?uid=1'));
  test('allows exact host:port only', () => {
    expect(allowedPacsUrl('https://pacs.clinic.com:8443/v', hosts)).toBeDefined();
    expect(allowedPacsUrl('https://pacs.clinic.com/v', hosts)).toBeUndefined();
    expect(allowedPacsUrl('https://viewer.clinic.com:8443/v', hosts)).toBeUndefined();
  });
  test.each([
    'http://viewer.clinic.com/v', 'https://evil.com/?u=viewer.clinic.com', 'https://viewer.clinic.com.evil.com/',
    'https://evil.com/@viewer.clinic.com', 'https://viewer.clinic.com@evil.com/', 'https://user:pw@viewer.clinic.com/',
    'https://sub.viewer.clinic.com/', 'https://viewer.clinic.com./', 'javascript:alert(1)', '//evil.com', 'data:text/html,x',
    'https://VIEWER.clinic.com.evil.com/',
  ])('denies %p', (u) => expect(allowedPacsUrl(u, hosts)).toBeUndefined());
  test('backslash is parsed as path, host stays the allowed one', () => {
    const out = allowedPacsUrl('https://viewer.clinic.com\\@evil.com/', hosts);
    expect(out && new URL(out).hostname).toBe('viewer.clinic.com');
  });
  test('case-insensitive host match', () => expect(allowedPacsUrl('https://VIEWER.Clinic.com/v', hosts)).toBeDefined());
});

describe('organization extension', () => {
  test('missing/corrupt => empty (deny)', () => {
    expect(getPacsHostsFromOrganization({ resourceType: 'Organization' })).toEqual([]);
    expect(getPacsHostsFromOrganization({ resourceType: 'Organization', extension: [{ url: PACS_HOSTS_EXTENSION_URL, valueString: '{bad' }] })).toEqual([]);
  });
  test('tampered entries re-validated on read', () => {
    const org = { resourceType: 'Organization' as const, extension: [{ url: PACS_HOSTS_EXTENSION_URL, valueString: JSON.stringify(['ok.clinic.com', '127.0.0.1']) }] };
    expect(getPacsHostsFromOrganization(org)).toEqual(['ok.clinic.com']);
  });
  test('round trip keeps other extensions; empty list clears', () => {
    const base = [{ url: 'x', valueString: 'y' }];
    const set = withPacsHostsExtension(base, ['a.clinic.com'])!;
    expect(set.length).toBe(2);
    expect(withPacsHostsExtension(set, [])).toEqual(base);
    expect(withPacsHostsExtension(set, undefined)).toEqual(set);
  });
});

describe('xray modality filter', () => {
  test('DX/CR/RG only', () => {
    expect(['DX', 'cr', 'RG'].every(isXrayModality)).toBe(true);
    expect(['CT', 'MR', 'US', 'MG', '', undefined].some(isXrayModality)).toBe(false);
  });
});
