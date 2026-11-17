/**
 * Staging bootstrap (Task 533 / plan 385b gap): on an EMPTY staging Medplum project, create the `demo`
 * clinic Organization and one fake doctor Practitioner that e2e/scripts/seed-clinics.ts requires.
 * Idempotent (conditional create + exact-one lookups mirroring the seed) and fake-only.
 *
 * Safety: callers must run stagingPreflight() first; this module additionally refuses any client whose
 * base URL is not an allowlisted staging origin, so it cannot be pointed at dev or production by mistake.
 * Never prints resource content. Does not create logins/ProjectMemberships (admin task, out of scope).
 */
import { STAGING_MEDPLUM_ORIGINS } from './preflight';

const SEED = 'http://iatrum.com/seed';
const TAG = { system: SEED, code: 'ucc-dummy-v1' };
export const DEMO_DOCTOR_EMAIL = 'doctor@ucc.local';

/** The subset of MedplumClient used here (so tests can inject a fake). */
export interface BootstrapClient {
  getBaseUrl(): string;
  searchResources(type: string, params: Record<string, string>): Promise<any[]>;
  createResourceIfNoneExist(resource: any, query: string): Promise<any>;
}

export interface BootstrapResult { organization: 'created' | 'existing' | 'planned'; practitioner: 'created' | 'existing' | 'planned' }

function assertStagingClient(client: BootstrapClient): void {
  let o: string;
  try { o = new URL(client.getBaseUrl()).origin; } catch { throw new Error('Refusing bootstrap: client has no valid base URL'); }
  if (!STAGING_MEDPLUM_ORIGINS.includes(o)) throw new Error('Refusing bootstrap: client is not targeting the allowlisted staging Medplum');
}

export async function bootstrapDemo(client: BootstrapClient, opts: { dryRun?: boolean } = {}): Promise<BootstrapResult> {
  assertStagingClient(client);
  const out: BootstrapResult = { organization: 'existing', practitioner: 'existing' };

  const orgs = await client.searchResources('Organization', { identifier: 'clinic|demo', _count: '2' });
  if (orgs.length > 1) throw new Error('Bootstrap: more than one demo clinic exists; refusing to guess');
  if (orgs.length === 1) {
    const ids = (orgs[0].identifier ?? []).filter((i: any) => i.system === 'clinic').map((i: any) => i.value);
    if (ids.length !== 1 || ids[0] !== 'demo') throw new Error('Bootstrap: existing demo clinic has a clinic identifier mismatch');
  } else if (opts.dryRun) {
    out.organization = 'planned';
  } else {
    await client.createResourceIfNoneExist({
      resourceType: 'Organization', active: true, name: 'Demo UCC Clinic',
      identifier: [{ system: 'clinic', value: 'demo' }, { system: SEED, value: 'demo-org1' }],
      meta: { tag: [TAG] },
    }, 'identifier=clinic|demo');
    out.organization = 'created';
  }

  // Same lookups as seed-clinics.ts doctor(): email first, then name; it needs exactly one match.
  let docs = await client.searchResources('Practitioner', { email: DEMO_DOCTOR_EMAIL, _count: '2' });
  if (docs.length === 0) docs = await client.searchResources('Practitioner', { name: 'Doctor', _count: '2' });
  if (docs.length > 1) throw new Error('Bootstrap: more than one candidate test doctor exists; refusing to guess');
  if (docs.length === 0) {
    if (opts.dryRun) out.practitioner = 'planned';
    else {
      await client.createResourceIfNoneExist({
        resourceType: 'Practitioner', active: true,
        name: [{ given: ['Fake'], family: 'Doctor', text: 'Fake Doctor' }],
        telecom: [{ system: 'email', value: DEMO_DOCTOR_EMAIL }],
        identifier: [{ system: SEED, value: 'demo-doctor1' }],
        meta: { tag: [TAG] },
      }, `identifier=${SEED}|demo-doctor1`);
      out.practitioner = 'created';
    }
  }
  return out;
}
