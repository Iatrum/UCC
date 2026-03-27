/**
 * GET /api/auth/me
 * Returns current Medplum practitioner profile.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentProfile, getProfileRole } from '@/lib/server/medplum-auth';

export async function GET(req: NextRequest) {
  try {
    const profile = await getCurrentProfile(req);

    return NextResponse.json({
      id: profile.id,
      resourceType: profile.resourceType,
      name: (profile as any).name?.[0]?.text || 'Unknown',
      email: (profile as any).telecom?.find((t: any) => t.system === 'email')?.value ?? null,
      role: getProfileRole(profile),
      provider: 'medplum',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Not authenticated' },
      { status: 401 }
    );
  }
}
