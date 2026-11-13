import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { MedplumClient } from '@medplum/core';
import { createRequire } from 'node:module';
import { BASE, MEDPLUM, MEDPLUM_ADMIN } from '../lib/env';
import '../lib/ws-polyfill';

const require = createRequire(import.meta.url);
require('tsx/cjs');
const { getAdminMedplum } = require('../../lib/server/medplum-admin.ts');
const { invitePractitionerToMedplum, updatePractitionerInMedplum, deletePractitionerFromMedplum } = require('../../lib/fhir/admin-service.ts');
const run = promisify(execFile);
const script = new URL('../../scripts/access-policy/migrate-staff-membership.mjs', import.meta.url).pathname;
// Password logins are deliberately spaced; fixture/service auth uses client credentials.
const pause = () => new Promise(resolve => setTimeout(resolve, 13_000));
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off' });

test('staff membership CLI dry-run, apply, direct isolation, multi-clinic union and exact rollback', async () => {
  test.setTimeout(15 * 60_000);
  expect(BASE).toBe('http://localhost:3210');
  expect(MEDPLUM.replace(/\/$/, '')).toBe('http://localhost:8113');
  process.loadEnvFile(new URL('../../.env.local', import.meta.url));
  expect(new URL(process.env.MEDPLUM_BASE_URL || process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL!).origin).toBe('http://localhost:8113');
  // A prior spec can use the whole 5/min login budget.
  await new Promise(resolve => setTimeout(resolve, 65_000));
  const m: MedplumClient = await getAdminMedplum();
  const owned: Array<{ resourceType: any; id: string }> = [];
  const practitioners: string[] = [];
  const create = async (resource: any) => {
    const saved = await m.createResource(resource);
    owned.push({ resourceType: saved.resourceType, id: saved.id! });
    return saved;
  };
  const cli = async (args: string[], expected = 0) => {
    await pause();
    let code = 0, output = '';
    try {
      const result = await run(process.execPath, [script, ...args], {
        env: { ...process.env, MEDPLUM_BASE_URL: MEDPLUM, MEDPLUM_ADMIN_EMAIL: MEDPLUM_ADMIN.email, MEDPLUM_ADMIN_PASSWORD: MEDPLUM_ADMIN.password },
        timeout: 60_000,
      });
      output = result.stdout + result.stderr;
    } catch (error: any) { code = Number(error.code) || 1; output = error.stdout + error.stderr; }
    // Never attach process arguments/env, resource bodies, or full errors to reports.
    expect(code, 'migration CLI exit status').toBe(expected);
    return output;
  };
  const login = async (email: string, password: string) => {
    await pause();
    const client = new MedplumClient({ baseUrl: MEDPLUM, fetch: globalThis.fetch.bind(globalThis) });
    const verifier = randomUUID();
    const response = await client.startLogin({ email, password, scope: 'openid profile offline_access',
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256' });
    const token = await fetch(new URL('oauth2/token', MEDPLUM), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: response.code!, code_verifier: verifier }),
    });
    expect(token.status, 'fake staff token exchange').toBe(200);
    client.setAccessToken((await token.json()).access_token);
    return client;
  };
  const raw = async (client: MedplumClient, path: string, method = 'GET', body?: any) => fetch(`${MEDPLUM.replace(/\/$/, '')}/fhir/R4/${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${client.getAccessToken()}`, 'Content-Type': 'application/fhir+json', 'X-Medplum': 'extended' },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    const clinics = [];
    for (const slug of ['demo', 'clinicb', 'clinicc', 'clinicd']) {
      const organization = await m.searchOne('Organization', { identifier: `clinic|${slug}` }, { cache: 'no-cache' });
      const account = await m.searchOne('HealthcareService', { identifier: `clinic|${slug}` }, { cache: 'no-cache' });
      expect(Boolean(organization?.id && account?.id)).toBe(true);
      const identifier = [{ system: 'clinic', value: slug }];
      const patient = await create({ resourceType: 'Patient', identifier, name: [{ family: 'Fake migration probe' }] });
      await m.post(`fhir/R4/Patient/${patient.id}/$set-accounts`, { resourceType: 'Parameters', parameter: [
        { name: 'accounts', valueReference: { reference: `HealthcareService/${account!.id}` } }, { name: 'propagate', valueBoolean: false },
      ] });
      const subject = { reference: `Patient/${patient.id}` };
      const encounter = await create({ resourceType: 'Encounter', identifier, subject, status: 'in-progress', class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' } });
      const observation = await create({ resourceType: 'Observation', identifier, subject, status: 'final', code: { text: 'Fake migration result' } });
      const order = await create({ resourceType: 'ServiceRequest', identifier, subject, status: 'active', intent: 'order', code: { text: 'Fake migration order' } });
      clinics.push({ slug, organization: organization!, account: account!, resources: [patient, encounter, observation, order] });
    }
    for (const indices of [[0], [0, 1]]) {
      const email = `migration-${randomUUID()}@example.invalid`;
      const password = `Fake-${randomUUID()}!`;
      await invitePractitionerToMedplum({ firstName: 'Fake', lastName: 'Migration', email, password, sendEmail: false, clinicId: clinics[0].organization.id });
      const practitioner = await m.searchOne('Practitioner', { telecom: email }, { cache: 'no-cache' });
      expect(Boolean(practitioner?.id)).toBe(true);
      practitioners.push(practitioner!.id!);
      if (indices.length > 1) await updatePractitionerInMedplum(practitioner!.id, { firstName: 'Fake', lastName: 'Migration', organizationIds: indices.map(i => clinics[i].organization.id) });
      let member = await m.searchOne('ProjectMembership', { profile: `Practitioner/${practitioner!.id}` }, { cache: 'no-cache' });
      expect(Boolean(member?.id)).toBe(true);
      const legacy = { ...member! }; delete legacy.access; delete legacy.accessPolicy;
      member = await m.updateResource(legacy);
      const original = JSON.stringify([member.accessPolicy ?? null, member.access ?? null]);
      if (indices.length === 1) {
        const role = await m.searchOne('PractitionerRole', { practitioner: `Practitioner/${practitioner!.id}`, active: 'true' }, { cache: 'no-cache' });
        expect(Boolean(role?.id)).toBe(true);
        await m.updateResource({ ...role!, active: false });
        expect(await cli(['--membership', member.id!], 1)).toContain('Unresolved clinic assignments');
        expect(await cli(['--apply', '--membership', member.id!], 1)).toContain('No active PractitionerRole');
        expect((await m.readResource('ProjectMembership', member.id!, { cache: 'no-cache' })).access).toBeUndefined();
        await m.updateResource({ ...role!, active: true });
      }
      expect(await cli(['--membership', member.id!])).toContain('Dry run only');
      expect(JSON.stringify((await m.readResource('ProjectMembership', member.id!, { cache: 'no-cache' })).access ?? null)).toBe('null');
      expect(await cli(['--apply', '--membership', member.id!])).toContain('Applied clinic staff policy');
      const current = await m.readResource('ProjectMembership', member.id!, { cache: 'no-cache' });
      const backupPath = `/workspace/ai-logs/task-isolation-phase2/backup/${member.project!.reference!.split('/')[1]}-${member.id}.json`;
      expect(fs.statSync(backupPath).mode & 0o777).toBe(0o600);
      const expectedUnion = '^(' + indices.map(i => `HealthcareService/${clinics[i].account.id}`).sort().join('|') + ')$';
      expect(current.access?.length).toBe(indices.length);
      for (const access of current.access!) expect(access.parameter?.find(p => p.name === 'clinicWriteAccounts')?.valueString).toBe(expectedUnion);
      expect(await cli(['--membership', member.id!])).toContain('already has the expected policy');
      const staff = await login(email, password);
      for (const [index, clinic] of clinics.entries()) {
        const allowed = indices.includes(index);
        for (const resource of clinic.resources) {
          expect((await raw(staff, `${resource.resourceType}/${resource.id}`)).status, `read ${resource.resourceType} clinic ${index}`).toBe(allowed ? 200 : 404);
          const search = await raw(staff, `${resource.resourceType}?_id=${resource.id}&_count=100`);
          expect(search.status).toBe(200);
          expect((await search.json()).entry?.length || 0).toBe(allowed ? 1 : 0);
          const fresh = await m.readResource(resource.resourceType, resource.id, { cache: 'no-cache', headers: { 'X-Medplum': 'extended' } });
          const update = await raw(staff, `${resource.resourceType}/${resource.id}`, 'PUT', fresh);
          expect(allowed ? update.status === 200 : [403, 404].includes(update.status), `update ${resource.resourceType} clinic ${index}`).toBe(true);
          if (!allowed) expect([403, 404]).toContain((await raw(staff, `${resource.resourceType}/${resource.id}`, 'DELETE')).status);
        }
        for (const resource of clinic.resources.slice(1)) {
          const { id, meta, ...copy } = resource;
          const response = await raw(staff, resource.resourceType, 'POST', copy);
          expect(response.status, `create ${resource.resourceType} clinic ${index}`).toBe(allowed ? 201 : 403);
          if (response.ok) { const saved = await response.json(); owned.push({ resourceType: saved.resourceType, id: saved.id }); }
        }
      }
      // Patients have no subject from which to inherit clinic accounts.
      const foreignPatient = await raw(staff, 'Patient', 'POST', {
        resourceType: 'Patient', identifier: [{ system: 'clinic', value: clinics[3].slug }],
        meta: { accounts: [{ reference: `HealthcareService/${clinics[3].account.id}` }],
          compartment: [{ reference: `HealthcareService/${clinics[3].account.id}` }] },
      });
      if (foreignPatient.ok) { const saved = await foreignPatient.json(); owned.push({ resourceType: 'Patient', id: saved.id }); }
      expect(foreignPatient.status, 'forged foreign Patient create').toBe(403);
      if (indices.length === 1) {
        // Prove drift protection before restoring the exact original absent grants.
        await m.updateResource({ ...current, access: [...current.access!, { policy: current.access![0].policy }] });
        expect(await cli(['--apply', '--rollback', '--membership', member.id!], 1)).toContain('Grant drift');
        const drifted = await m.readResource('ProjectMembership', member.id!, { cache: 'no-cache' });
        await m.updateResource({ ...drifted, access: current.access });
        expect(await cli(['--apply', '--rollback', '--membership', member.id!])).toContain('Restored original');
        const restored = await m.readResource('ProjectMembership', member.id!, { cache: 'no-cache' });
        expect(JSON.stringify([restored.accessPolicy ?? null, restored.access ?? null])).toBe(original);
        const legacyStaff = await login(email, password);
        expect((await raw(legacyStaff, `Patient/${clinics[3].resources[0].id}`)).status).toBe(200);
      }
    }
  } finally {
    const failed: string[] = [];
    for (const id of practitioners) {
      try {
        await deletePractitionerFromMedplum(id);
      } catch { failed.push('Practitioner cleanup request'); }
    }
    for (const resource of owned.reverse()) {
      try { await m.deleteResource(resource.resourceType, resource.id); } catch { failed.push(resource.resourceType); }
    }
    expect(failed, 'fake migration fixture cleanup').toEqual([]);
  }
});
