import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { CLINIC_COOKIE } from '@/lib/server/cookie-constants';

/**
 * Resolve clinicId from header or cookie. Returns null if not provided.
 */
export async function getClinicIdFromRequest(req: NextRequest): Promise<string | null> {
  const cookieStore = await cookies();
  return req.headers.get('x-clinic-id') || cookieStore.get(CLINIC_COOKIE)?.value || null;
}
