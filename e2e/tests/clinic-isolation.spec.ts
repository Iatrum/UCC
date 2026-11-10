import { randomUUID } from 'node:crypto';
import { test, expect, request } from '@playwright/test';
import { MedplumClient } from '@medplum/core';
import { BASE, MEDPLUM, MEDPLUM_ADMIN } from '../lib/env';
import '../lib/ws-polyfill';
import { createRequire } from 'node:module';
// App sources are CommonJS-scoped; register TypeScript loading explicitly.
const require = createRequire(import.meta.url);
require('tsx/cjs');
const { getAdminMedplum } = require('../../lib/server/medplum-admin.ts');
const { createProvenanceForResource } = require('../../lib/fhir/provenance-service.ts');
const { saveTriageEncounter, updateTriageEncounter, updateQueueStatusForPatient } = require('../../lib/fhir/triage-service.ts');

// Disposable fake clinics and identity only. Never record credentials or bodies.
test.use({ storageState: { cookies: [], origins: [] }, trace: 'off', screenshot: 'off' });
test('phase 1 clinic reassignment, multi-clinic reads, Provenance and Encounter stamping', async () => {
  expect(BASE).toBe('http://localhost:3210');
  expect(MEDPLUM.replace(/\/$/, '')).toBe('http://localhost:8113');
  // Direct service calls need the same local service credentials as Next.
  // Load without printing values, then enforce the local endpoint before use.
  process.loadEnvFile(new URL('../../.env.local', import.meta.url));
  expect(new URL(process.env.MEDPLUM_BASE_URL || process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL || 'http://localhost:8103').origin).toBe('http://localhost:8113');
  const m: MedplumClient = await getAdminMedplum();
  const api = await request.newContext({ baseURL: BASE, storageState: { cookies: [], origins: [] } });
  const owned: Array<{ resourceType: any; id: string }> = [];
  const create = async (resource: any, client = m) => {
    const result = await client.createResource(resource);
    owned.push({ resourceType: result.resourceType, id: result.id! });
    return result;
  };
  const extended = { cache: 'no-cache' as const, headers: { 'X-Medplum': 'extended' } };
  const accounts = async (resource: any) => {
    const fresh: any = await m.readResource(resource.resourceType, resource.id, extended);
    return (fresh.meta?.accounts || []).map((r: any) => r.reference);
  };
  const stamp = async (resource: any, account: any) => {
    await m.post(`fhir/R4/${resource.resourceType}/${resource.id}/$set-accounts`, {
      resourceType: 'Parameters', parameter: [
        { name: 'accounts', valueReference: { reference: `HealthcareService/${account.id}` } },
        { name: 'propagate', valueBoolean: false },
      ],
    });
  };
  const suffix = randomUUID();
  const email = `isolation-${suffix}@example.invalid`;
  const password = `Fake-only-${randomUUID()}!`;
  let practitionerId: string | undefined;
  let staff: MedplumClient | undefined;
  try {
    expect((await api.post('/api/auth/login', { data: MEDPLUM_ADMIN })).status()).toBe(200);
    const clinics = [];
    for (let i = 0; i < 4; i++) {
      const slug = `isolation-${suffix}-${i}`;
      const organization = await create({ resourceType: 'Organization', name: 'Fake isolation clinic', identifier: [{ system: 'clinic', value: slug }] });
      const account = await create({ resourceType: 'HealthcareService', active: true, identifier: [{ system: 'clinic', value: slug }], providedBy: { reference: `Organization/${organization.id}` } });
      const patient = await create({ resourceType: 'Patient', name: [{ family: 'Fake isolation patient' }], identifier: [{ system: 'clinic', value: slug }] });
      await stamp(patient, account);
      const encounter = await create({ resourceType: 'Encounter', status: 'in-progress', class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB' }, subject: { reference: `Patient/${patient.id}` } });
      await stamp(encounter, account);
      const observation = await create({ resourceType: 'Observation', status: 'final', code: { text: 'Fake isolation result' }, subject: { reference: `Patient/${patient.id}` } });
      await stamp(observation, account);
      clinics.push({ slug, organization, account, patient, encounter, observation });
    }
    expect((await api.post('/api/admin/users/invite', { data: {
      firstName: 'Fake', lastName: 'Isolation', email, password, sendEmail: false, clinicId: clinics[0].organization.id,
    } })).status()).toBe(200);
    const practitioner = await m.searchOne('Practitioner', { telecom: email }, { cache: 'no-cache' });
    expect(Boolean(practitioner?.id)).toBe(true);
    practitionerId = practitioner!.id;
    const membership = await m.searchOne('ProjectMembership', { profile: `Practitioner/${practitionerId}` }, { cache: 'no-cache' });
    expect(Boolean(membership?.id)).toBe(true);
    // Add a harmless custom legacy grant, proving reassignment preserves it.
    const custom = await create({ resourceType: 'AccessPolicy', name: `Fake custom ${suffix}`, resource: [{ resourceType: 'ValueSet', readonly: true }] });
    await m.updateResource({ ...membership!, accessPolicy: { reference: `AccessPolicy/${custom.id}` } });
    staff = new MedplumClient({ baseUrl: MEDPLUM, fetch: globalThis.fetch.bind(globalThis) });
    const login = await staff.startLogin({ email, password });
    await staff.processCode(login.code!);
    // Use raw fetch status only: no response bodies or clinical values in assertions.
    const visible = async (allowed: number[]) => {
      for (const [index, clinic] of clinics.entries()) {
        for (const resource of [clinic.patient, clinic.encounter, clinic.observation]) {
          const response = await fetch(`${MEDPLUM.replace(/\/$/, '')}/fhir/R4/${resource.resourceType}/${resource.id}`, {
            headers: { Authorization: `Bearer ${staff!.getAccessToken()}` }, redirect: 'error',
          });
          expect(response.status, `${resource.resourceType} clinic ${index}`).toBe(allowed.includes(index) ? 200 : allowed.length ? 404 : 403);
          const search = await fetch(`${MEDPLUM.replace(/\/$/, '')}/fhir/R4/${resource.resourceType}?_id=${resource.id}&_count=1`, {
            headers: { Authorization: `Bearer ${staff!.getAccessToken()}` }, redirect: 'error',
          });
          expect(search.status).toBe(allowed.length ? 200 : 403);
          if (search.ok) {
            const bundle = await search.json();
            expect(bundle.entry?.length || 0).toBe(allowed.includes(index) ? 1 : 0);
          }
        }
      }
    };
    let preserveCustom = true;
    const assign = async (indices: number[]) => {
      expect((await api.patch(`/api/admin/users/${practitionerId}`, { data: {
        firstName: 'Fake', lastName: 'Isolation', organizationIds: indices.map(i => clinics[i].organization.id),
      } })).status()).toBe(200);
      const current = await m.readResource('ProjectMembership', membership!.id!, { cache: 'no-cache' });
      const clinicAccess = current.access?.filter(a => a.policy.reference === membership!.access![0].policy.reference) || [];
      expect(clinicAccess.length).toBe(new Set(indices).size);
      if (preserveCustom) expect(current.access?.some(a => a.policy.reference === `AccessPolicy/${custom.id}`)).toBe(true);
      const refs = clinicAccess.map(a => a.parameter?.find(p => p.name === 'clinicOrganization')?.valueReference?.reference).sort();
      expect(refs).toEqual([...new Set(indices)].map(i => `Organization/${clinics[i].organization.id}`).sort());
      const roles = await m.searchResources('PractitionerRole', { practitioner: `Practitioner/${practitionerId}` }, { cache: 'no-cache' });
      expect(roles.map(r => r.organization?.reference).sort()).toEqual(refs);
    };
    await visible([0]);
    await assign([0, 1, 1]);
    await visible([0, 1]);
    await assign([1]);
    await visible([1]);
    // Invalid clinic must leave both roles and access unchanged.
    expect((await api.patch(`/api/admin/users/${practitionerId}`, { data: {
      firstName: 'Fake', lastName: 'Isolation', organizationIds: ['does-not-exist'],
    } })).ok()).toBe(false);
    await visible([1]);
    const ownOrder = await create({ resourceType: 'ServiceRequest', status: 'active', intent: 'order', subject: { reference: `Patient/${clinics[1].patient.id}` }, code: { text: 'Fake test' } }, staff);
    expect((await staff.readResource('ServiceRequest', ownOrder.id)).id === ownOrder.id).toBe(true);
    const provenanceId = await createProvenanceForResource(staff, 'ServiceRequest', ownOrder.id, practitionerId, clinics[1].organization.id, 'CREATE', [{ reference: `HealthcareService/${clinics[1].account.id}` }]);
    const provenance = { resourceType: 'Provenance', id: provenanceId };
    owned.push(provenance);
    expect(await accounts(provenance)).toEqual([`HealthcareService/${clinics[1].account.id}`]);
    expect((await staff.readResource('Provenance', provenanceId, { cache: 'no-cache' })).id === provenanceId).toBe(true);
    await assign([0]);
    await expect(staff.readResource('Provenance', provenanceId, { cache: 'no-cache' })).rejects.toThrow();
    await assign([]);
    await visible([]);
    // With no unrelated grants, an explicit empty policy must deny clinical reads.
    const zero = await m.readResource('ProjectMembership', membership!.id!, { cache: 'no-cache' });
    await m.updateResource({ ...zero, access: [], accessPolicy: undefined });
    preserveCustom = false;
    await assign([]);
    await visible([]);
    const denied = await m.readResource('ProjectMembership', membership!.id!, { cache: 'no-cache' });
    expect(Boolean(denied.access?.length)).toBe(true);
    await assign([2, 3]);
    await visible([2, 3]);

    // Exercise all three Encounter update paths on legacy unstamped encounters.
    // Use the admin client just as existing unpolicied staff can today; no migration.
    for (const update of ['save', 'triage', 'queue']) {
      const clinic = clinics[0];
      const patient = await create({ resourceType: 'Patient', name: [{ family: 'Fake legacy encounter' }], identifier: [{ system: 'clinic', value: clinic.slug }] });
      const encounter = await create({ resourceType: 'Encounter', status: 'in-progress',
        class: { code: 'AMB', system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode' },
        subject: { reference: `Patient/${patient.id}` }, period: { start: new Date().toISOString() },
        extension: [{ url: 'https://ucc.emr/triage-encounter', extension: [
          { url: 'queueStatus', valueString: 'waiting' },
          { url: 'queueAddedAt', valueDateTime: new Date().toISOString() },
          { url: 'triageLevel', valueInteger: 4 },
          { url: 'chiefComplaint', valueString: 'Fake legacy complaint' },
        ] }],
        identifier: [{ system: 'clinic', value: clinic.slug }],
        serviceProvider: { reference: `Organization/${clinic.organization.id}` },
      });
      expect(await accounts(encounter)).toEqual([]);
      if (update === 'save') await saveTriageEncounter(patient.id, { chiefComplaint: 'Fake complaint', triageLevel: 4 } as any, m, clinic.slug);
      if (update === 'triage') await updateTriageEncounter(patient.id, { chiefComplaint: 'Fake complaint' }, m, clinic.slug);
      if (update === 'queue') await updateQueueStatusForPatient(patient.id, 'waiting', m, clinic.slug);
      expect(await accounts(encounter), `${update} stamps the original Encounter`).toEqual([`HealthcareService/${clinic.account.id}`]);
    }
  } finally {
    // App deletion also removes the disposable login and PractitionerRole rows.
    if (!practitionerId) practitionerId = (await m.searchOne('Practitioner', { telecom: email }, { cache: 'no-cache' }))?.id;
    if (practitionerId) expect((await api.delete(`/api/admin/users/${practitionerId}`)).ok()).toBe(true);
    const failed: string[] = [];
    for (const patient of owned.filter(r => r.resourceType === 'Patient')) {
      for (const type of ['Observation', 'Encounter'] as const) {
        for (const resource of await m.searchResources(type, { subject: `Patient/${patient.id}`, _count: '100' }, { cache: 'no-cache' })) {
          if (!owned.some(r => r.resourceType === type && r.id === resource.id)) owned.push({ resourceType: type, id: resource.id! });
        }
      }
    }
    for (const resource of owned.reverse()) {
      try { await m.deleteResource(resource.resourceType, resource.id); }
      catch { failed.push(resource.resourceType); }
    }
    await api.dispose();
    expect(failed, 'disposable fixture cleanup failures (types only)').toEqual([]);
  }
});
