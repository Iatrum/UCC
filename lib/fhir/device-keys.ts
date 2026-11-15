/**
 * Per-device API keys for device ingress (POCT analysers, X-ray devices).
 *
 * A key authenticates ONE clinic-scoped FHIR Device. Only a SHA-256 hash is stored, as a
 * Device.identifier (so it survives heartbeat updates, which rewrite Device.property, and is
 * directly searchable). The plaintext key is shown once at issue time and never persisted or
 * logged. The caller's clinic is resolved from the authenticated Device, never from the request.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Device } from '@medplum/fhirtypes';
import type { NextRequest } from 'next/server';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { isModuleEnabledForClinic } from '@/lib/module-registry';
import { AuthError, ForbiddenError } from '@/lib/server/route-helpers';
import { POCT_TYPE_SYSTEM, deviceForClinic as poctDeviceForClinic } from '@/lib/fhir/poct-device';
import { XRAY_TYPE_SYSTEM, deviceForClinic as xrayDeviceForClinic } from '@/lib/fhir/xray-device';

export const DEVICE_KEY_HASH_SYSTEM = 'https://ucc.emr/device/api-key-sha256';
export const DEVICE_KEY_PREFIX = 'ucc_dk_';

export type DeviceIngressKind = 'poct' | 'pacs';

export interface AuthenticatedDevice {
  deviceId: string;
  clinicId: string;
  kind: DeviceIngressKind;
}

export function hashDeviceKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function generateDeviceKey(): string {
  return `${DEVICE_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** Remove any existing key hash from the identifier list (revoke), keeping everything else. */
function withoutKeyHash(device: Device): NonNullable<Device['identifier']> {
  return (device.identifier ?? []).filter((id) => id.system !== DEVICE_KEY_HASH_SYSTEM);
}

/** Issue (or rotate) the key for a Device. Returns the plaintext key — show it once, never store it. */
export async function issueDeviceKey(deviceId: string): Promise<string> {
  const client = await getAdminMedplum();
  const device = await client.readResource('Device', deviceId, { cache: 'no-cache' });
  const key = generateDeviceKey();
  await client.updateResource<Device>({
    ...device,
    identifier: [...withoutKeyHash(device), { system: DEVICE_KEY_HASH_SYSTEM, value: hashDeviceKey(key) }],
  });
  return key;
}

export async function revokeDeviceKey(deviceId: string): Promise<void> {
  const client = await getAdminMedplum();
  const device = await client.readResource('Device', deviceId, { cache: 'no-cache' });
  await client.updateResource<Device>({ ...device, identifier: withoutKeyHash(device) });
}

/** Key from `Authorization: Bearer`, `X-Device-Key`, or (legacy device clients) the JSON body `apiKey`. */
export function extractDeviceKey(request: NextRequest, bodyApiKey?: unknown): string | undefined {
  const bearer = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const key = bearer || request.headers.get('x-device-key') || (typeof bodyApiKey === 'string' ? bodyApiKey : undefined);
  return key && key.startsWith(DEVICE_KEY_PREFIX) ? key : undefined;
}

const INGRESS: Record<DeviceIngressKind, { typeSystem: string; label: string }> = {
  poct: { typeSystem: POCT_TYPE_SYSTEM, label: 'POCT' },
  pacs: { typeSystem: XRAY_TYPE_SYSTEM, label: 'PACS' },
};

/**
 * Authenticate the calling Device. Fails closed: no key, unknown/revoked key, inactive Device,
 * wrong device type for this ingress, or a disabled module for the Device's clinic all refuse.
 * Throws AuthError (401) or ForbiddenError (403).
 */
export async function authenticateDeviceKey(key: string | undefined, kind: DeviceIngressKind): Promise<AuthenticatedDevice> {
  if (!key) throw new AuthError('Unauthorized: device API key required');
  const client = await getAdminMedplum();
  const devices = await client.searchResources('Device', {
    identifier: `${DEVICE_KEY_HASH_SYSTEM}|${hashDeviceKey(key)}`, _count: '2',
  }, { cache: 'no-cache' });
  const device = devices.length === 1 ? devices[0] : undefined;
  if (!device?.id || device.status !== 'active') throw new AuthError('Unauthorized: invalid device API key');

  const clinics = [...new Set(device.identifier?.filter((id) => id.system === 'clinic' && id.value).map((id) => id.value!))];
  if (clinics.length !== 1) throw new ForbiddenError('Device is not bound to exactly one clinic');
  const clinicId = clinics[0];
  const hasType = device.type?.coding?.some((c) => c.system === INGRESS[kind].typeSystem);
  const projection = kind === 'poct' ? poctDeviceForClinic(device, clinicId) : xrayDeviceForClinic(device, clinicId);
  if (!hasType || !projection) throw new AuthError('Unauthorized: invalid device API key');

  if (!(await isModuleEnabledForClinic(kind, clinicId))) {
    throw new ForbiddenError(`${INGRESS[kind].label} module is disabled for this clinic`);
  }
  return { deviceId: device.id, clinicId, kind };
}
