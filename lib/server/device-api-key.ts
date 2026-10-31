import { createHash, timingSafeEqual } from 'node:crypto';

type DeviceApiKeyEnv = 'POCT_API_KEY' | 'PACS_API_KEY';
type DeviceApiKeyVerification = { ok: true } | { ok: false; status: 401 };

const warnedUnconfiguredReceivers = new Set<DeviceApiKeyEnv>();

// proxy.ts only routes/forwards headers; this is the receivers' only auth gate.
export function verifyDeviceApiKey(
  request: Pick<Request, 'headers'>,
  body: unknown,
  envName: DeviceApiKeyEnv
): DeviceApiKeyVerification {
  const expectedKey = process.env[envName];
  if (!expectedKey) {
    if (!warnedUnconfiguredReceivers.has(envName)) {
      warnedUnconfiguredReceivers.add(envName);
      console.warn(`Device receiver not configured: ${envName} is unset or empty`);
    }
    return { ok: false, status: 401 };
  }

  const bodyKey = body && typeof body === 'object' && 'apiKey' in body
    ? body.apiKey
    : undefined;
  const providedKey = request.headers.get('x-api-key') ?? bodyKey;
  if (typeof providedKey !== 'string' || !providedKey) {
    return { ok: false, status: 401 };
  }

  // Hash both strings so timingSafeEqual always receives equal-length buffers.
  const expectedDigest = createHash('sha256').update(expectedKey).digest();
  const providedDigest = createHash('sha256').update(providedKey).digest();
  return timingSafeEqual(expectedDigest, providedDigest)
    ? { ok: true }
    : { ok: false, status: 401 };
}
