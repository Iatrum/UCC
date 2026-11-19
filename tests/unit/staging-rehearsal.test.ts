import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const dir = 'infra/staging/rehearsal';
const compose = readFileSync(`${dir}/docker-compose.yml`, 'utf8');
const dynamic = readFileSync(`${dir}/dynamic/medplum-allowlist.yml`, 'utf8');
const probe = readFileSync('scripts/staging/probe.sh', 'utf8');
const nonComment = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

test('proxy publishes only on loopback, no socket, no dashboard, pinned image', () => {
  const c = nonComment(compose);
  const ports = [...c.matchAll(/^\s*-\s*"([^"]*:[^"]*)"/gm)].map((m) => m[1]);
  expect(ports).toEqual(['127.0.0.1:8180:8000']);
  expect(c).not.toContain('docker.sock');
  expect(c).not.toContain('api.insecure');
  expect(c).toContain('--api=false');
  expect(c).not.toContain('--providers.docker');
  expect(c).toMatch(/TRAEFIK_IMAGE_TAG:\?/);
  expect(c).not.toMatch(/:latest/);
  expect(c).not.toMatch(/container_name:\s*(medplum-|root-traefik)/);
  expect(c).toContain('ucc-staging_stg-net');
});

test('routing is an allowlist that never exposes admin or the dashboard', () => {
  const d = nonComment(dynamic);
  const rule = d.slice(d.indexOf('rule:'), d.indexOf('service:', d.indexOf('rule:')));
  const matchers = [...rule.matchAll(/(PathPrefix|Path)\(`([^`]+)`\)/g)].map((m) => m[2]);
  expect(matchers.sort()).toEqual(['/.well-known/', '/auth/', '/fhir/', '/healthcheck', '/oauth2/', '/storage/']);
  expect(rule).not.toMatch(/admin|api|metrics|rawdata|dashboard/i);
  expect(rule).not.toContain('PathPrefix(`/`)');
  // the single admin exception: UCC invite, POST only, anchored regex
  const invite = d.slice(d.indexOf('medplum-invite:'), d.indexOf('services:'));
  expect(invite).toContain('Method(`POST`)');
  expect(invite).toContain('PathRegexp(`^/admin/projects/[A-Za-z0-9-]+/invite$`)');
  expect((d.match(/\/admin/g) ?? []).length).toBe(1);
  expect(d).toContain('http://ucc-stg-medplum:8103/');
});

test('probe refuses non-staging bases and covers admin mount forms', () => {
  expect(probe).toContain('refusing non-staging base');
  for (const p of ['/admin/projects', '/api/admin/projects', '/projects/x/admin/invite', '//admin/projects', '/%61dmin/projects', '/admin/projects/x1/invite']) {
    expect(probe).toContain(p);
  }
});

test('invite rehearsal is loopback-only, never prints secrets, always tears the proxy down', () => {
  const script = readFileSync('scripts/staging/invite-rehearsal.ts', 'utf8');
  const sh = readFileSync('scripts/staging/rehearse-invite-dev.sh', 'utf8');
  expect(script).toContain('refusing non-loopback base');
  expect(script).toContain('sendEmail: false');
  expect(script).not.toMatch(/console\.log\([^)]*(token|password)/i);
  expect(sh).toContain("trap 'docker rm -f");
  expect(sh).toContain('127.0.0.1:8180:8000');
  expect(nonComment(sh)).not.toMatch(/docker\.sock|root-traefik|\/opt\/medplum/);
});
