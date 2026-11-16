import type { Extension, Organization } from '@medplum/fhirtypes';
import { sanitizePacsViewerUrl } from './pacs-link';

export const PACS_HOSTS_EXTENSION_URL = 'https://ucc.emr/organization-pacs-viewer-hosts';
export const MAX_PACS_HOSTS = 20;

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const INTERNAL_SUFFIXES = ['.local', '.localhost', '.internal', '.lan', '.home', '.corp', '.intranet', '.test', '.invalid', '.example'];

/**
 * Normalise one admin-entered entry ("pacs.clinic.com" or "pacs.clinic.com:8443") to
 * "host" (port 443 implied) or "host:port". Returns undefined when invalid.
 * Rules: HTTPS only (no scheme/path/userinfo/wildcard accepted), DNS names only
 * (no IP literals, so private/loopback/link-local/metadata addresses cannot be listed),
 * at least two labels, no internal-only suffixes.
 */
export function normalizePacsHost(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const raw = input.trim().toLowerCase();
  if (!raw || raw.length > 260) return undefined;
  const m = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(raw);
  if (!m) return undefined; // rejects scheme, path, '@', '*', brackets (IPv6), spaces
  const [, host, portText] = m;
  if (host.endsWith('.') || host.startsWith('.') || host.length > 253) return undefined;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return undefined;
  if (/^\d+$/.test(labels[labels.length - 1])) return undefined; // IPv4 / numeric TLD
  if (INTERNAL_SUFFIXES.some((s) => host.endsWith(s)) || host === 'localhost') return undefined;
  let port = 443;
  if (portText !== undefined) {
    port = Number(portText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return undefined;
  }
  return port === 443 ? host : `${host}:${port}`;
}

/** Validate a list; returns normalised unique hosts and the entries that were rejected. */
export function validatePacsHosts(input: unknown): { hosts: string[]; invalid: string[] } {
  const list = Array.isArray(input) ? input : [];
  const hosts: string[] = [];
  const invalid: string[] = [];
  for (const item of list) {
    const n = normalizePacsHost(item);
    if (!n) invalid.push(String(item).slice(0, 80));
    else if (!hosts.includes(n)) hosts.push(n);
  }
  if (hosts.length > MAX_PACS_HOSTS) invalid.push(`more than ${MAX_PACS_HOSTS} hosts`);
  return { hosts: hosts.slice(0, MAX_PACS_HOSTS), invalid };
}

/** Default deny: an unset/corrupt extension yields an empty list. Entries are re-validated on read. */
export function getPacsHostsFromOrganization(org: Organization): string[] {
  const raw = org.extension?.find((e) => e.url === PACS_HOSTS_EXTENSION_URL)?.valueString;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    return validatePacsHosts(JSON.parse(raw)).hosts;
  } catch {
    return [];
  }
}

export function withPacsHostsExtension(extensions: Extension[] | undefined, hosts: string[] | undefined): Extension[] | undefined {
  if (hosts === undefined) return extensions; // leave the stored allowlist untouched
  const others = extensions?.filter((e) => e.url !== PACS_HOSTS_EXTENSION_URL) ?? [];
  const clean = validatePacsHosts(hosts).hosts;
  if (!clean.length) return others.length ? others : undefined;
  return [...others, { url: PACS_HOSTS_EXTENSION_URL, valueString: JSON.stringify(clean) }];
}

/**
 * Returns the normalised URL only if it is https, credential-free and its exact host[:port]
 * is on the clinic allowlist. Default deny (empty list). Never follows or fetches the URL.
 */
export function allowedPacsUrl(input: unknown, allowedHosts: readonly string[]): string | undefined {
  if (!allowedHosts.length) return undefined;
  const clean = sanitizePacsViewerUrl(input);
  if (!clean) return undefined;
  const url = new URL(clean);
  if (url.protocol !== 'https:' || url.hostname.endsWith('.')) return undefined;
  const port = url.port || '443';
  const key = port === '443' ? url.hostname : `${url.hostname}:${port}`;
  return allowedHosts.includes(key) ? clean : undefined;
}
