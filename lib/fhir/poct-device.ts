import type { Device } from '@medplum/fhirtypes';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import type { PoctAnalyser } from './lab-constants';
import { ConflictError } from '@/lib/server/route-helpers';

export const POCT_TYPE_SYSTEM = 'https://ucc.emr/poct/analyser-type';
export const POCT_PROPERTY_SYSTEM = 'https://ucc.emr/poct/device-property';
export const POCT_TAG_SYSTEM = 'https://ucc.emr/poct';
export const POCT_HEARTBEAT_MAX_AGE = 90_000;

export function deviceForClinic(device: Device, clinicId: string, now = Date.now()): PoctAnalyser | undefined {
  if (!device.id || !device.identifier?.some((id) => id.system === 'clinic' && id.value === clinicId)) return;
  const simulated = device.meta?.tag?.some((tag) => tag.system === POCT_TAG_SYSTEM && tag.code === 'simulated');
  if (simulated && (process.env.NODE_ENV === 'production' || !['demo', 'clinicb', 'clinicc', 'clinicd'].includes(clinicId))) return;
  const analyserType = device.type?.coding?.find((code) => code.system === POCT_TYPE_SYSTEM)?.code;
  if (!analyserType) return;
  const lastHeartbeat = device.property?.find((p) => p.type.coding?.some((c) => c.system === POCT_PROPERTY_SYSTEM && c.code === 'last-heartbeat'))?.valueCode?.[0]?.text;
  const age = now - Date.parse(lastHeartbeat || '');
  return { id: device.id, name: device.deviceName?.[0]?.name || 'POCT analyser', analyserType,
    lastHeartbeat, online: device.status === 'active' && Number.isFinite(age) && age >= 0 && age <= POCT_HEARTBEAT_MAX_AGE };
}

// Device is clinic configuration, not patient data: the clinic staff AccessPolicy grants staff no
// Device access, so look devices up with the server directory client, scoped by the caller's
// authenticated clinicId, and return only the safe projection below (Task 130 finding).
export async function listPoctAnalysers(clinicId: string): Promise<PoctAnalyser[]> {
  const result: PoctAnalyser[] = [];
  const client = await getAdminMedplum();
  for await (const page of client.searchResourcePages('Device', { identifier: `clinic|${clinicId}`, _count: '100' }, { cache: 'no-cache' })) {
    for (const device of page) {
      const analyser = deviceForClinic(device, clinicId);
      if (analyser) result.push(analyser);
    }
  }
  return result;
}

export async function requireOnlineAnalyser(clinicId: string, id: string, type: string) {
  const client = await getAdminMedplum();
  // Search with BOTH identifier and id: never read another clinic's Device by id.
  const device = await client.searchOne('Device', { identifier: `clinic|${clinicId}`, _id: id }, { cache: 'no-cache' });
  const analyser = device && deviceForClinic(device, clinicId);
  if (!analyser?.online || analyser.analyserType !== type) {
    throw new ConflictError('POCT analyser is offline or unavailable. Refresh the POCT section before signing.');
  }
  return analyser;
}
