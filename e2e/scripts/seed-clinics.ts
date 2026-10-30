// Run from e2e/: npx tsx scripts/seed-clinics.ts [--dry-run]
// Research: .ai/research/task2-seed-4-clinics.md
// APIs verified against https://www.medplum.com/docs/sdk/core.medplumclient.createresourceifnoneexist
// and https://www.medplum.com/docs/api/fhir/operations/set-accounts.
/// <reference types="node" />
import '../lib/ws-polyfill.js';
import { MedplumClient } from '@medplum/core';
import type { CodeableConcept, Identifier, Resource, Practitioner, Organization, HealthcareService } from '@medplum/fhirtypes';

const SEED = 'http://iatrum.com/seed';
const TAG = { system: SEED, code: 'ucc-dummy-v1' };
// Copy of LAB_TESTS.CBC: e2e deliberately does not import app aliases.
const CBC = { code: '58410-2', display: 'Complete Blood Count (CBC) panel', system: 'http://loinc.org' };
const CLINICS = [
  { slug: 'demo', name: 'Demo UCC Clinic' },
  { slug: 'clinicb', name: 'Klinik Bravo' },
  { slug: 'clinicc', name: 'Klinik Charlie' },
  { slug: 'clinicd', name: 'Klinik Delta' },
];
const NAMES = ['Aina Binti Contoh', 'Amir Bin Rekaan', 'Mei Ling Contoh', 'Wei Ming Rekaan', 'Kavitha Contoh', 'Arun Rekaan'];
const DIAGNOSES = [
  { code: 'J02.9', display: 'Acute pharyngitis, unspecified' },
  { code: 'E11.9', display: 'Type 2 diabetes mellitus without complications' },
  { code: 'I10', display: 'Essential (primary) hypertension' },
];
type SeedResource = Extract<Resource, { identifier?: Identifier[] }>;
type Counts = Record<string, string | number>;
let stage = 'configuration';

function requireId<T extends Resource>(resource: T): T & { id: string } {
  if (!resource.id) throw new Error('Resource has no ID');
  return resource as T & { id: string };
}

function assertClinic(resource: SeedResource, slug: string): void {
  const values = resource.identifier?.filter((i) => i.system === 'clinic').map((i) => i.value) ?? [];
  if (values.length !== 1 || values[0] !== slug) throw new Error('Clinic identifier mismatch');
}

function seedFields(slug: string, key: string) {
  return {
    identifier: [{ system: 'clinic', value: slug }, { system: SEED, value: key }],
    meta: { tag: [TAG] },
  };
}

async function login(baseUrl: string): Promise<MedplumClient> {
  // Do not import lib/env: it reads a password file and creates an evidence directory.
  const client = new MedplumClient({ baseUrl, fetch: globalThis.fetch.bind(globalThis) });
  const result = await client.startLogin({
    email: process.env.MEDPLUM_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.MEDPLUM_ADMIN_PASSWORD || 'medplum_admin',
  });
  if (!result.code) throw new Error('Admin login did not return a code');
  await client.processCode(result.code);
  return client;
}

async function doctor(client: MedplumClient): Promise<Practitioner & { id: string }> {
  let matches = await client.searchResources('Practitioner', { email: 'doctor@ucc.local', _count: '2' });
  // The local invitation may create a profile without telecom; seed.mjs uses this fallback.
  if (matches.length === 0) matches = await client.searchResources('Practitioner', { name: 'Doctor', _count: '2' });
  if (matches.length !== 1) throw new Error('Expected exactly one test doctor');
  return requireId(matches[0]);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--dry-run')) throw new Error('Unsupported argument');
  const dryRun = args.includes('--dry-run');
  const url = new URL(process.env.MEDPLUM_URL || 'http://localhost:8113/');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) ||
      !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Only a local Medplum URL without credentials is allowed');
  }
  // No login, reads, writes, or secret-file access in dry-run mode.
  stage = 'admin login';
  const client = dryRun ? undefined : await login(url.href);
  stage = 'clinic and doctor preflight';
  const practitioner = client ? await doctor(client) : { id: 'dry-run-doctor' };
  let demo: Organization | undefined;
  let labCategory: CodeableConcept = {
    coding: [
      { system: 'http://snomed.info/sct', code: '108252007', display: 'Laboratory procedure' },
      // A text label cannot match category=laboratory; an actual token is required.
      { system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' },
    ],
    text: 'laboratory',
  };
  if (client) {
    const demos = await client.searchResources('Organization', { identifier: 'clinic|demo', _count: '2' });
    if (demos.length !== 1) throw new Error('Expected one existing demo clinic; refusing to create a replacement');
    demo = requireId(demos[0]);
    assertClinic(demo, 'demo');
    // Inspect an existing demo order before any writes. Never print its content.
    const existing = await client.searchOne('ServiceRequest', { identifier: 'clinic|demo' });
    const category = existing?.category?.find((c) => c.coding?.some((coding) => coding.code === 'laboratory'));
    if (category) {
      labCategory = { ...labCategory, coding: [...labCategory.coding!, ...category.coding!.filter(
        (c) => !labCategory.coding!.some((own) => own.system === c.system && own.code === c.code),
      )] };
    }
  }

  const rows: Counts[] = [];
  for (const [clinicIndex, clinic] of CLINICS.entries()) {
    const { slug, name } = clinic;
    stage = `seeding ${slug}`;
    const counts: Counts = { clinic: slug };
    // All generated resources use a stable unique seed identifier. Existing clinic
    // directory entries and staff roles are reused without changing their metadata.
    async function ensure<T extends SeedResource>(resource: T, key: string): Promise<T & { id: string }> {
      counts[resource.resourceType] = Number(counts[resource.resourceType] ?? 0) + 1;
      if (!client) return { ...resource, id: `dry-run-${key}` };
      const result = await client.createResourceIfNoneExist(resource, new URLSearchParams({ identifier: `${SEED}|${key}` }).toString());
      assertClinic(result, slug);
      return requireId(result);
    }
    async function directory<T extends Organization | HealthcareService>(resource: T, key: string): Promise<T & { id: string }> {
      const existing = resource.resourceType === 'Organization' && slug === 'demo' ? demo :
        await client?.searchOne(resource.resourceType, { identifier: `clinic|${slug}` });
      if (existing) {
        assertClinic(existing, slug);
        counts[resource.resourceType] = 1;
        return requireId(existing) as T & { id: string };
      }
      return ensure(resource, key);
    }
    const org = await directory({ resourceType: 'Organization', ...seedFields(slug, `${slug}-org1`), active: true, name }, `${slug}-org1`);
    const orgRef = { reference: `Organization/${org.id}` };
    const account = await directory({ resourceType: 'HealthcareService', ...seedFields(slug, `${slug}-account1`), active: true,
      name: `${name} account`, providedBy: orgRef }, `${slug}-account1`);
    if (account.providedBy?.reference !== orgRef.reference) throw new Error('Clinic account organization mismatch');
    const practitionerRef = { reference: `Practitioner/${practitioner.id}` };
    // Only the demo clinic gets the test doctor: a 2nd clinic role makes localhost login fail
    // ("This account belongs to multiple clinics" in app/api/auth/login). Other clinics keep their own staff.
    const role = slug !== 'demo' ? { active: true } : await client?.searchOne('PractitionerRole', { practitioner: practitionerRef.reference, organization: orgRef.reference });
    if (slug !== 'demo') {
      counts.PractitionerRole = 0;
    } else if (role) {
      if (role.active === false) throw new Error('Existing test doctor role is inactive');
      counts.PractitionerRole = 1;
    } else {
      await ensure({ resourceType: 'PractitionerRole', ...seedFields(slug, `${slug}-role1`), active: true,
        practitioner: practitionerRef, organization: orgRef }, `${slug}-role1`);
    }
    async function assignAccounts(patientId: string): Promise<void> {
      if (!client) return;
      await client.post(`fhir/R4/Patient/${patientId}/$set-accounts`, {
        resourceType: 'Parameters', parameter: [
          { name: 'accounts', valueReference: { reference: `HealthcareService/${account.id}` } },
          { name: 'propagate', valueBoolean: true },
        ],
      });
    }
    for (let n = 1; n <= 6; n++) {
      const key = `${slug}-p${n}`;
      const patient = await ensure({ resourceType: 'Patient', ...seedFields(slug, key), active: true,
        name: [{ text: `FAKE ${NAMES[n - 1]}`, given: ['FAKE', NAMES[n - 1]] }],
        gender: n % 2 ? 'female' : 'male', birthDate: '1999-01-01',
        identifier: [...seedFields(slug, key).identifier,
          { system: 'http://iatrum.com/seed/fake-nric', value: `990101-14-F${clinicIndex}${String(n).padStart(2, '0')}` }],
        telecom: [{ system: 'phone', value: `012-000${clinicIndex}${String(n).padStart(3, '0')}` }],
        managingOrganization: orgRef,
      }, key);
      // Set accounts first so subsequent Patient-compartment resources inherit them.
      await assignAccounts(patient.id);
      const subject = { reference: `Patient/${patient.id}` };
      let encounterRef = { reference: '' };
      // Fixed dates keep seed payloads stable and in the past.
      const date = `2025-10-${String(10 + n).padStart(2, '0')}`;
      for (let visit = 1; visit <= (n % 2 ? 1 : 2); visit++) {
        const encKey = `${key}-enc${visit}`;
        const encounter = await ensure({ resourceType: 'Encounter', ...seedFields(slug, encKey), status: 'finished',
          class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
          subject, serviceProvider: orgRef, participant: [{ individual: practitionerRef }],
          period: { start: `${date}T0${visit}:00:00Z`, end: `${date}T0${visit}:30:00Z` },
        }, encKey);
        if (visit === 1) encounterRef = { reference: `Encounter/${encounter.id}` };
      }
      const diagnosis = DIAGNOSES[(n - 1) % DIAGNOSES.length];
      await ensure({ resourceType: 'Condition', ...seedFields(slug, `${key}-cond1`), subject, encounter: encounterRef,
        clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }] },
        verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }] },
        code: { coding: [{ system: 'http://hl7.org/fhir/sid/icd-10', ...diagnosis }], text: diagnosis.display },
        recordedDate: `${date}T01:10:00Z`,
      }, `${key}-cond1`);
      if (n % 2 === 1) {
        const order = await ensure({ resourceType: 'ServiceRequest', ...seedFields(slug, `${key}-sr1`),
          status: 'completed', intent: 'order', priority: 'routine', category: [labCategory],
          code: { coding: [CBC], text: CBC.display }, subject, encounter: encounterRef, requester: practitionerRef,
          authoredOn: `${date}T01:10:00Z`, occurrenceDateTime: `${date}T01:20:00Z`,
        }, `${key}-sr1`);
        const basedOn = [{ reference: `ServiceRequest/${order.id}` }];
        const results: { reference: string }[] = [];
        const measurements = [
          { code: '6690-2', display: 'Leukocytes [#/volume] in Blood by Automated count', unit: '10*9/L', low: 4, high: 11, value: n === 3 ? 12 : 7, flag: n === 3 ? 'H' : 'N' },
          { code: '718-7', display: 'Hemoglobin [Mass/volume] in Blood', unit: 'g/dL', low: 12, high: 16, value: n === 5 ? 11.5 : 14, flag: n === 5 ? 'L' : 'N' },
        ];
        for (const [index, measurement] of measurements.entries()) {
          const obsKey = `${key}-obs${index + 1}`;
          const quantity = (value: number) => ({ value, unit: measurement.unit, system: 'http://unitsofmeasure.org', code: measurement.unit });
          const observation = await ensure({ resourceType: 'Observation', ...seedFields(slug, obsKey), status: 'final',
            category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
            code: { coding: [{ system: 'http://loinc.org', code: measurement.code, display: measurement.display }], text: measurement.display },
            subject, encounter: encounterRef, basedOn, effectiveDateTime: `${date}T01:20:00Z`, issued: `${date}T01:25:00Z`,
            valueQuantity: quantity(measurement.value), referenceRange: [{ low: quantity(measurement.low), high: quantity(measurement.high), text: `${measurement.low}-${measurement.high} ${measurement.unit}` }],
            interpretation: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: measurement.flag,
              display: measurement.flag === 'H' ? 'high' : measurement.flag === 'L' ? 'low' : 'normal' }] }],
          }, obsKey);
          results.push({ reference: `Observation/${observation.id}` });
        }
        await ensure({ resourceType: 'DiagnosticReport', ...seedFields(slug, `${key}-dr1`), status: 'final',
          category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'LAB', display: 'Laboratory' }] }],
          code: { coding: [CBC], text: CBC.display }, subject, encounter: encounterRef, basedOn, result: results,
          effectiveDateTime: `${date}T01:20:00Z`, issued: `${date}T01:25:00Z`, conclusion: 'Synthetic CBC results for testing only.',
        }, `${key}-dr1`);
      }
      await assignAccounts(patient.id);
    }
    rows.push(counts);
  }
  console.log(dryRun ? 'DRY RUN (offline): would ensure these resources, reusing existing matches; assign each patient account before children and propagate again afterward.' :
    'Seed resources ensured per clinic (includes reused resources; excludes unrelated data):');
  console.table(rows);
}

main().catch(() => {
  // SDK errors can contain requests/resources. Emit only our controlled stage.
  console.error(`Seed failed during ${stage}. No error payload printed; check local configuration and prerequisites.`);
  process.exitCode = 1;
});
