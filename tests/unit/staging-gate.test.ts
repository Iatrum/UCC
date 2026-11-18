import { afterAll, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBaselineIdentity, writeBaselineIdentity } from '../../e2e/scripts/lib/baseline.mjs';
import { bootstrapDemo, type BootstrapClient } from '../../scripts/staging/bootstrap';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ucc-gate-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const report = (tests: Record<string, string>) => JSON.stringify({ suites: [{ specs: Object.entries(tests).map(([title, status]) => ({ title, tests: [{ results: [{ status }] }] })) }] });
const write = (name: string, body: string) => { const f = path.join(dir, name); fs.writeFileSync(f, body); return f; };
const compare = (cur: string, base: string | undefined, target?: string, exceptions?: string) => spawnSync('node', ['e2e/scripts/compare.mjs', cur, ...(base ? [base] : [])], {
  cwd: path.resolve(import.meta.dir, '../..'), encoding: 'utf8', env: { PATH: process.env.PATH, ...(target ? { UCC_GATE_TARGET: target } : {}), ...(exceptions ? { UCC_GATE_EXCEPTIONS: exceptions } : {}) },
});

test('baseline identity: valid only for the recorded target and bytes', () => {
  const b = write('b1.json', report({ a: 'passed' }));
  expect(checkBaselineIdentity(b, 'staging')).toContain('baseline identity file is missing (record one with: node e2e/scripts/lib/baseline.mjs write <results.json> <target>)');
  writeBaselineIdentity(b, 'staging');
  expect(checkBaselineIdentity(b, 'staging')).toEqual([]);
  expect(checkBaselineIdentity(b, 'Staging')).toEqual([]);
  expect(checkBaselineIdentity(b, 'prod-like').join()).toContain('different target');
  fs.appendFileSync(b, ' ');
  expect(checkBaselineIdentity(b, 'staging').join()).toContain('hash');
});

test('baseline identity: missing / malformed inputs are rejected, not thrown', () => {
  expect(checkBaselineIdentity(path.join(dir, 'nope.json'), 'staging').length).toBe(1);
  expect(checkBaselineIdentity(undefined as any, 'staging').length).toBe(1);
  expect(checkBaselineIdentity(write('bad.json', '{not json'), 'staging').length).toBe(1);
  expect(checkBaselineIdentity(write('empty.json', '{"suites":[]}'), 'staging').length).toBe(1);
  const b = write('b2.json', report({ a: 'passed' }));
  fs.writeFileSync(`${b}.identity.json`, 'garbage');
  expect(checkBaselineIdentity(b, 'staging').join()).toContain('identity file is not valid JSON');
  expect(checkBaselineIdentity(b, '../etc').join()).toContain('invalid');
});

test('compare.mjs staging target FAILS on missing or foreign baseline, passes on attested one', () => {
  const cur = write('cur.json', report({ a: 'passed', b: 'failed' }));
  const base = write('base.json', report({ a: 'passed', b: 'failed' }));
  expect(compare(cur, undefined, 'staging').status).toBe(1);          // no baseline arg
  expect(compare(cur, path.join(dir, 'gone.json'), 'staging').status).toBe(1);
  expect(compare(cur, base, 'staging').status).toBe(1);               // no identity
  writeBaselineIdentity(base, 'local');
  expect(compare(cur, base, 'staging').status).toBe(1);               // identity of another target
  writeBaselineIdentity(base, 'staging');
  expect(compare(cur, base, 'staging', write('none.json', '[]')).status).toBe(1); // baseline match alone is not an approval
  const ok = compare(cur, base, 'staging', write('exc.json', '["b"]'));
  expect(ok.status).toBe(0);                                          // known failure b is in the baseline AND approved
  expect(compare(write('cur2.json', report({ a: 'passed', b: 'failed', c: 'failed' })), base, 'staging', write('exc2.json', '["b"]')).status).toBe(1); // unknown failing test
});

test('compare.mjs staging: skipped tests need an exact approved title; bad list fails closed', () => {
  const cur = write('cur4.json', report({ a: 'passed', s: 'skipped' }));
  const base = write('base4.json', report({ a: 'passed', s: 'skipped' }));
  writeBaselineIdentity(base, 'staging');
  const r = compare(cur, base, 'staging', write('e0.json', '[]'));
  expect(r.status).toBe(1); expect(r.stdout).toContain('UNAPPROVED skipped: s');
  expect(compare(cur, base, 'staging', write('e1.json', '["s"]')).status).toBe(0);
  expect(compare(cur, base, 'staging', write('e2.json', '["s "]')).status).toBe(1);  // exact match only
  expect(compare(cur, base, 'staging', write('e3.json', '{bad')).status).toBe(1);
  expect(compare(cur, base, 'staging', write('e4.json', '[1]')).status).toBe(1);
  expect(compare(write('cur5.json', report({ a: 'passed' })), base, 'staging', write('e5.json', '[]')).stdout).toContain('MISSING: s');
});

test('compare.mjs without a gate target keeps the lenient local behaviour', () => {
  const cur = write('cur3.json', report({ a: 'passed' }));
  expect(compare(cur, undefined).status).toBe(0);
});

// ---- bootstrap ----
function fakeClient(base = 'http://127.0.0.1:8123/', initial: any[] = []) {
  const db = [...initial];
  const c: BootstrapClient & { db: any[] } = {
    db,
    getBaseUrl: () => base,
    async searchResources(type, p) {
      let all = db.filter((r) => r.resourceType === type);
      if (p.identifier) { const [s, v] = p.identifier.split('|'); all = all.filter((r) => r.identifier?.some((i: any) => i.system === s && i.value === v)); }
      if (p.email) all = all.filter((r) => r.telecom?.some((t: any) => t.value === p.email));
      if (p.name) all = all.filter((r) => JSON.stringify(r.name ?? '').includes(p.name));
      return all.slice(0, Number(p._count ?? 20));
    },
    async createResourceIfNoneExist(r) { const x = { ...r, id: String(db.length + 1) }; db.push(x); return x; },
  };
  return c;
}

test('bootstrap creates demo org + fake doctor on an empty project, idempotently', async () => {
  const c = fakeClient();
  expect(await bootstrapDemo(c)).toEqual({ organization: 'created', practitioner: 'created' });
  const org = c.db.find((r) => r.resourceType === 'Organization');
  expect(org.identifier).toContainEqual({ system: 'clinic', value: 'demo' });
  expect(org.meta.tag[0].code).toBe('ucc-dummy-v1');
  expect(c.db.find((r) => r.resourceType === 'Practitioner').telecom[0].value).toBe('doctor@ucc.local');
  expect(await bootstrapDemo(c)).toEqual({ organization: 'existing', practitioner: 'existing' });
  expect(c.db.length).toBe(2);
});

test('bootstrap dry-run writes nothing; ambiguous or mismatched state fails closed', async () => {
  const c = fakeClient();
  expect(await bootstrapDemo(c, { dryRun: true })).toEqual({ organization: 'planned', practitioner: 'planned' });
  expect(c.db.length).toBe(0);
  const org = (clinic: string) => ({ resourceType: 'Organization', id: 'o', identifier: [{ system: 'clinic', value: clinic }] });
  await expect(bootstrapDemo(fakeClient('http://127.0.0.1:8123/', [org('demo'), { ...org('demo'), id: 'o2' }]))).rejects.toThrow('more than one demo');
  const dup = (id: string) => ({ resourceType: 'Practitioner', id, telecom: [{ value: 'doctor@ucc.local' }] });
  await expect(bootstrapDemo(fakeClient('http://127.0.0.1:8123/', [dup('1'), dup('2')]))).rejects.toThrow('more than one candidate');
  await expect(bootstrapDemo(fakeClient('http://127.0.0.1:8123/', [{ ...org('demo'), identifier: [{ system: 'clinic', value: 'demo' }, { system: 'clinic', value: 'x' }] }]))).rejects.toThrow('mismatch');
});

test('bootstrap refuses any non-staging client and writes nothing', async () => {
  for (const url of ['http://127.0.0.1:8113/', 'http://localhost:8103/', 'https://fhir.example.com/', 'not a url', 'http://127.0.0.1:8123.evil.com/']) {
    const c = fakeClient(url);
    await expect(bootstrapDemo(c)).rejects.toThrow('Refusing bootstrap');
    expect(c.db.length).toBe(0);
  }
});
