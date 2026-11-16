// FHIR verification and disposable fixtures against dev Medplum only.
import './ws-polyfill';
import fs from 'node:fs';
import { MedplumClient } from '@medplum/core';
import { MEDPLUM, MEDPLUM_ADMIN } from './env';
let client: MedplumClient | undefined;
export async function fhir(): Promise<MedplumClient> {
  if (client) return client;
  const endpoint = new URL(MEDPLUM);
  if (endpoint.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(endpoint.hostname) || endpoint.port !== '8113') {
    throw new Error('FHIR fixtures require dev Medplum on loopback:8113');
  }
  // Use the app's existing local service credentials for fixture work. User/password logins are
  // still exercised by browser/auth/isolation tests, without every restarted fixture worker
  // consuming that same small password-login budget.
  const envFile = new URL('../../.env.local', import.meta.url);
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
  const m = new MedplumClient({ baseUrl: MEDPLUM, fetch: globalThis.fetch.bind(globalThis) });
  if (process.env.MEDPLUM_CLIENT_ID && process.env.MEDPLUM_CLIENT_SECRET) {
    const configured = new URL(process.env.MEDPLUM_BASE_URL || process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL || MEDPLUM);
    if (configured.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(configured.hostname) || configured.port !== '8113') {
      throw new Error('Fixture service credentials must be configured for dev Medplum only');
    }
    await m.startClientLogin(process.env.MEDPLUM_CLIENT_ID, process.env.MEDPLUM_CLIENT_SECRET);
  } else {
    const r = await m.startLogin(MEDPLUM_ADMIN); await m.processCode(r.code!);
  }
  return (client = m);
}
export async function byPatient(type: string, patientId: string): Promise<any[]> {
  const m = await fhir();
  try { return await m.searchResources(type as any, { patient: patientId, _count: '200' }, { cache: 'no-cache' }); }
  catch { return await m.searchResources(type as any, { subject: `Patient/${patientId}`, _count: '200' }, { cache: 'no-cache' }); }
}
