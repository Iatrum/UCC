// Read-only FHIR verification against the local Medplum (super-admin login on the local test server only).
import './ws-polyfill';
import { MedplumClient } from '@medplum/core';
import { MEDPLUM, MEDPLUM_ADMIN } from './env';
let client: MedplumClient | undefined;
export async function fhir(): Promise<MedplumClient> {
  if (client) return client;
  const m = new MedplumClient({ baseUrl: MEDPLUM, fetch: globalThis.fetch.bind(globalThis) });
  const r = await m.startLogin(MEDPLUM_ADMIN); await m.processCode(r.code!);
  return (client = m);
}
export async function byPatient(type: string, patientId: string): Promise<any[]> {
  const m = await fhir();
  try { return await m.searchResources(type as any, { patient: patientId, _count: '200' }, { cache: 'no-cache' }); }
  catch { return await m.searchResources(type as any, { subject: `Patient/${patientId}`, _count: '200' }, { cache: 'no-cache' }); }
}
