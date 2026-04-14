/**
 * Shared admin MedplumClient singleton.
 *
 * Intentionally does NOT import 'next/headers' so it can be safely imported
 * by service files that are also imported by client components (for constants
 * and type exports). The actual server-only auth helpers live in
 * medplum-auth.ts.
 */

import { MedplumClient } from '@medplum/core';

let _adminClient: MedplumClient | undefined;
let _adminClientPromise: Promise<MedplumClient> | undefined;

/**
 * Get the process-level admin MedplumClient.
 * Uses client-credentials grant. Singleton — one connection per process.
 */
export async function getAdminMedplum(): Promise<MedplumClient> {
  if (_adminClient) return _adminClient;
  if (_adminClientPromise) return _adminClientPromise;

  const baseUrl =
    process.env.MEDPLUM_BASE_URL ||
    process.env.NEXT_PUBLIC_MEDPLUM_BASE_URL ||
    'http://localhost:8103';
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Admin Medplum credentials not configured. Set MEDPLUM_CLIENT_ID and MEDPLUM_CLIENT_SECRET.'
    );
  }

  _adminClientPromise = (async () => {
    const medplum = new MedplumClient({ baseUrl, clientId, clientSecret });
    try {
      await medplum.startClientLogin(clientId, clientSecret);
      console.log('✅ Connected to Medplum');
      _adminClient = medplum;
      return medplum;
    } catch (err) {
      // Reset so the next request can retry instead of using a poisoned promise
      _adminClientPromise = undefined;
      throw err;
    }
  })();

  return _adminClientPromise;
}
