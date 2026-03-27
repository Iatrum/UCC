import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { CLINIC_COOKIE } from '@/lib/server/cookie-constants';

/**
 * Resolve clinicId from header or cookie. Returns null if not provided.
 *
 * Security model: this value is used to *scope* Medplum queries
 * (e.g. `organization=<clinicId>`) but is NOT the access-control boundary.
 * Access control is enforced at the Medplum layer — if the user's token
 * does not have permission on a given Organization's resources, Medplum
 * will return empty results or a 403. A misconfigured cookie cannot leak
 * data from an Organization the practitioner is not authorised for.
 */
export async function getClinicIdFromRequest(req: NextRequest): Promise<string | null> {
  const cookieStore = await cookies();
  return req.headers.get('x-clinic-id') || cookieStore.get(CLINIC_COOKIE)?.value || null;
}
