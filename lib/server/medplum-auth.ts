/**
 * Server-side Medplum authentication helpers
 * For use in API routes, Server Components, and Server Actions
 */

import { MedplumClient, type ProfileResource } from '@medplum/core';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/server/cookie-constants';
import { AuthError } from '@/lib/server/route-helpers';
import { env } from '@/lib/env';

// ---------------------------------------------------------------------------
// Admin client singleton — one connection shared across the whole process.
// All FHIR service files that need admin access must use getAdminMedplum()
// rather than creating their own MedplumClient instances.
// ---------------------------------------------------------------------------
let _adminClient: MedplumClient | undefined;
let _adminClientPromise: Promise<MedplumClient> | undefined;

/**
 * Decode a JWT payload without verifying the signature — only used to read
 * the `exp` claim locally so we can reject obviously expired tokens before
 * touching the network.
 */
function getJwtExpiry(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8')
    );
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Get authenticated Medplum client for the current user.
 *
 * Reads the access token from the Authorization header or the session cookie.
 * Does NOT make a Medplum API call — validation is lazy (the first FHIR
 * operation will fail with a clear error if the token is invalid).
 * Expired tokens are rejected immediately via local JWT decode.
 */
export async function getMedplumForRequest(req?: NextRequest): Promise<MedplumClient> {
  const medplum = new MedplumClient({ baseUrl: env.MEDPLUM_BASE_URL });

  let accessToken: string | null = null;

  if (req) {
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      accessToken = authHeader.substring(7);
    }
  }

  if (!accessToken) {
    const cookieStore = await cookies();
    accessToken = cookieStore.get(SESSION_COOKIE)?.value || null;
  }

  if (!accessToken) {
    throw new AuthError('No access token found. User not authenticated.');
  }

  // Reject expired tokens locally — no network round-trip required.
  const exp = getJwtExpiry(accessToken);
  if (exp !== null && exp < Math.floor(Date.now() / 1000)) {
    throw new AuthError('Session expired. Please sign in again.');
  }

  medplum.setAccessToken(accessToken);
  return medplum;
}

/**
 * Get the current user's Medplum profile.
 * Makes exactly one API call (GET /auth/me) and only when the profile is
 * explicitly needed — not on every request.
 */
export async function getCurrentProfile(req?: NextRequest): Promise<ProfileResource> {
  const medplum = await getMedplumForRequest(req);
  const profile = await medplum.getProfileAsync();
  if (!profile) {
    throw new Error('No Medplum profile available');
  }
  return profile as ProfileResource;
}

/**
 * Get admin Medplum client (client-credentials grant).
 * Singleton — the same MedplumClient instance is reused for the lifetime of
 * the Node.js process. Use for background tasks, migrations, and any
 * operation that must run without a user token.
 */
export async function getAdminMedplum(): Promise<MedplumClient> {
  if (_adminClient) return _adminClient;
  if (_adminClientPromise) return _adminClientPromise;

  const { MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET } = env;
  if (!MEDPLUM_CLIENT_ID || !MEDPLUM_CLIENT_SECRET) {
    throw new Error(
      'Admin Medplum credentials not configured. Set MEDPLUM_CLIENT_ID and MEDPLUM_CLIENT_SECRET.'
    );
  }

  _adminClientPromise = (async () => {
    const medplum = new MedplumClient({
      baseUrl: env.MEDPLUM_BASE_URL,
      clientId: MEDPLUM_CLIENT_ID,
      clientSecret: MEDPLUM_CLIENT_SECRET,
    });
    await medplum.startClientLogin(MEDPLUM_CLIENT_ID, MEDPLUM_CLIENT_SECRET);
    console.log('✅ Connected to Medplum');
    _adminClient = medplum;
    return medplum;
  })();

  return _adminClientPromise;
}

/**
 * Check if user has a specific role.
 */
export async function hasRole(req: NextRequest, allowedRoles: string[]): Promise<boolean> {
  try {
    const profile = await getCurrentProfile(req);
    if (profile.resourceType === 'Practitioner') return true;
    if (profile.resourceType === 'Patient') return allowedRoles.includes('patient');
    return false;
  } catch {
    return false;
  }
}

/**
 * Get user's role string from a Medplum profile resource.
 */
export function getProfileRole(profile: ProfileResource): string {
  if (profile.resourceType === 'Practitioner') return 'practitioner';
  if (profile.resourceType === 'Patient') return 'patient';
  return 'user';
}

/** Require authentication — throws AuthError if not authenticated. */
export async function requireAuth(req?: NextRequest): Promise<MedplumClient> {
  return getMedplumForRequest(req);
}

/** Optional authentication — returns null if not authenticated. */
export async function optionalAuth(req?: NextRequest): Promise<MedplumClient | null> {
  try {
    return await getMedplumForRequest(req);
  } catch {
    return null;
  }
}
