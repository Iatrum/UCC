import { createHash, randomBytes } from 'node:crypto';
// Mirrors lib/fhir/device-keys.ts: only the SHA-256 hash is stored on the Device (as an identifier).
// Keys are generated per test run, held in memory, and never written to disk or logs.
export const DEVICE_KEY_HASH_SYSTEM = 'https://ucc.emr/device/api-key-sha256';
export function newDeviceKey() {
  const key = `ucc_dk_${randomBytes(32).toString('base64url')}`;
  return { key, identifier: { system: DEVICE_KEY_HASH_SYSTEM, value: createHash('sha256').update(key).digest('hex') } };
}
export const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
