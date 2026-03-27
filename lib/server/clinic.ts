import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { CLINIC_COOKIE } from '@/lib/server/cookie-constants';

/**
 * Resolve clinicId from the httpOnly session cookie set by middleware.
 * Returns null if the cookie is absent.
 *
 * Security model:
 *  - The cookie is written by Next.js middleware from the request subdomain,
 *    not from user-supplied input. It cannot be spoofed by the browser
 *    because it is scoped to the server-set cookie store.
 *  - Do NOT read clinicId from request headers — that would allow any
 *    authenticated user to scope queries to any clinic by sending an
 *    arbitrary x-clinic-id header.
 *  - Medplum's FHIR access control provides a second layer: a practitioner's
 *    token only grants access to resources in their own project/organisation.
 */
export async function getClinicIdFromRequest(req: NextRequest): Promise<string | null> {
  // Read exclusively from the middleware-set cookie.
  // Intentionally NOT reading from req.headers to prevent header injection.
  const cookieStore = await cookies();
  return req.cookies.get(CLINIC_COOKIE)?.value || cookieStore.get(CLINIC_COOKIE)?.value || null;
}
