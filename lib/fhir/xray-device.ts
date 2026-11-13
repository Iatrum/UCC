import type { Device } from '@medplum/fhirtypes';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { ConflictError } from '@/lib/server/route-helpers';

export const XRAY_TYPE_SYSTEM = 'https://ucc.emr/xray/device-type';
export const XRAY_PROPERTY_SYSTEM = 'https://ucc.emr/xray/device-property';
export const XRAY_TAG_SYSTEM = 'https://ucc.emr/xray';
export const XRAY_HEARTBEAT_MAX_AGE = 90_000;

export interface XrayDevice {
  id: string;
  name: string;
  deviceType: string;
  online: boolean;
  lastHeartbeat?: string;
}

export function deviceForClinic(device: Device, clinicId: string, now = Date.now()): XrayDevice | undefined {
  if (!device.id || !device.identifier?.some((id) => id.system === 'clinic' && id.value === clinicId)) return;
  const simulated = device.meta?.tag?.some((tag) => tag.system === XRAY_TAG_SYSTEM && tag.code === 'simulated');
  if (simulated && (process.env.NODE_ENV === 'production' || !['demo', 'clinicb', 'clinicc', 'clinicd'].includes(clinicId))) return;
  const deviceType = device.type?.coding?.find((code) => code.system === XRAY_TYPE_SYSTEM)?.code;
  if (!deviceType) return;
  const lastHeartbeat = device.property?.find((p) => p.type.coding?.some((c) => c.system === XRAY_PROPERTY_SYSTEM && c.code === 'last-heartbeat'))?.valueCode?.[0]?.text;
  const age = now - Date.parse(lastHeartbeat || '');
  return { id: device.id, name: device.deviceName?.[0]?.name || 'X-ray device', deviceType,
    lastHeartbeat, online: device.status === 'active' && Number.isFinite(age) && age >= 0 && age <= XRAY_HEARTBEAT_MAX_AGE };
}

// Device is clinic configuration, not patient data: the clinic staff AccessPolicy grants staff no
// Device access, so look devices up with the server directory client, scoped by the caller's
// authenticated clinicId, and return only the safe projection below (Task 130 finding).
export async function listXrayDevices(clinicId: string): Promise<XrayDevice[]> {
  const result: XrayDevice[] = [];
  const client = await getAdminMedplum();
  for await (const page of client.searchResourcePages('Device', { identifier: `clinic|${clinicId}`, _count: '100' }, { cache: 'no-cache' })) {
    for (const device of page) {
      const xray = deviceForClinic(device, clinicId);
      if (xray) result.push(xray);
    }
  }
  return result;
}

export async function requireOnlineXrayDevice(clinicId: string, id: string) {
  const client = await getAdminMedplum();
  // Search with BOTH identifier and id: never read another clinic's Device by id.
  const device = await client.searchOne('Device', { identifier: `clinic|${clinicId}`, _id: id }, { cache: 'no-cache' });
  const xray = device && deviceForClinic(device, clinicId);
  if (!xray?.online) {
    throw new ConflictError('X-ray device is offline or unavailable. Refresh the X-ray section before signing.');
  }
  return xray;
}
