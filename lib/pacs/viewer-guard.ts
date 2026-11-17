/**
 * Server-side guards for the DICOM viewer routes (Task 392). Medplum-backed, so NOT part of the pure
 * token module.
 *
 *  - `isPacsEnabledForViewer`: the clinic's `pacs` toggle, re-checked on viewer requests (cached for a
 *    few seconds) so switching it OFF also kills viewer sessions already issued (cookie life is 15 min).
 *    Any failure -> false (deny).
 *  - `consumeLaunchTokenShared`: single-use launch tokens across app instances. The consumed jti is
 *    stored in Medplum as a `Basic` resource via conditional create (If-None-Exist), which Medplum
 *    resolves atomically, so exactly one instance wins. Fails closed when Medplum is unreachable.
 */
import { randomBytes } from 'node:crypto';
import type { Basic } from '@medplum/fhirtypes';
import type { MedplumClient } from '@medplum/core';
import { isModuleEnabledForClinic } from '@/lib/module-registry';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { CLINIC_IDENTIFIER_SYSTEM } from '@/lib/fhir/clinic-tenancy';
import { consumeLaunchToken, type ViewerClaims } from './viewer-token';

export const PACS_TOGGLE_CACHE_MS = 5_000;
export const LAUNCH_JTI_SYSTEM = 'urn:ucc:pacs-launch-jti';
/** Consumed-token records are only needed for the 60 s launch life; sweep anything older than this. */
const SWEEP_AFTER_MS = 10 * 60 * 1000;

const toggleCache: Map<string, { enabled: boolean; at: number }> =
  ((globalThis as Record<string, unknown>).__uccPacsToggle as Map<string, { enabled: boolean; at: number }> | undefined) ??
  ((globalThis as Record<string, unknown>).__uccPacsToggle = new Map()) as Map<string, { enabled: boolean; at: number }>;

export async function isPacsEnabledForViewer(
  clinicId: string,
  nowMs = Date.now(),
  check: (clinicId: string) => Promise<boolean> = (id) => isModuleEnabledForClinic('pacs', id)
): Promise<boolean> {
  const hit = toggleCache.get(clinicId);
  if (hit && nowMs - hit.at < PACS_TOGGLE_CACHE_MS) return hit.enabled;
  let enabled = false;
  try {
    enabled = await check(clinicId);
  } catch {
    enabled = false;
  }
  toggleCache.set(clinicId, { enabled, at: nowMs });
  return enabled;
}

export function clearPacsToggleCache(): void {
  toggleCache.clear();
}

let lastSweep = 0;
async function sweepConsumed(medplum: MedplumClient, nowMs: number): Promise<void> {
  if (nowMs - lastSweep < 60_000) return;
  lastSweep = nowMs;
  try {
    const cutoff = new Date(nowMs - SWEEP_AFTER_MS).toISOString();
    const old = await medplum.searchResources('Basic', { identifier: `${LAUNCH_JTI_SYSTEM}|`, _lastUpdated: `lt${cutoff}`, _count: '50' });
    await Promise.all(old.filter((r) => r.id).map((r) => medplum.deleteResource('Basic', r.id as string)));
  } catch {
    // best effort only
  }
}

/** True exactly once per launch token across all instances. Any error -> false (deny). */
export async function consumeLaunchTokenShared(
  claims: ViewerClaims,
  nowMs = Date.now(),
  getClient: () => Promise<MedplumClient> = getAdminMedplum
): Promise<boolean> {
  // Cheap per-process pre-check; also the first line of defence if the same instance sees a replay.
  if (!consumeLaunchToken(claims, nowMs)) return false;
  try {
    const medplum = await getClient();
    const nonce = randomBytes(12).toString('base64url');
    const record: Basic = {
      resourceType: 'Basic',
      identifier: [
        { system: LAUNCH_JTI_SYSTEM, value: claims.jti },
        { system: CLINIC_IDENTIFIER_SYSTEM, value: claims.clinicId },
      ],
      code: { text: nonce },
      created: new Date(nowMs).toISOString().slice(0, 10),
    };
    const stored = await medplum.createResourceIfNoneExist<Basic>(record, `identifier=${LAUNCH_JTI_SYSTEM}|${claims.jti}`);
    void sweepConsumed(medplum, nowMs);
    // If another instance created it first, we get THEIR record back, with their nonce.
    return stored.code?.text === nonce;
  } catch {
    return false;
  }
}
