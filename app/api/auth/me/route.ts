/**
 * GET /api/auth/me
 * Returns current user profile from Medplum.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getCurrentProfile, getProfileRole } from '@/lib/server/medplum-auth';
import { AUTH_DISABLED } from '@/lib/auth-config';

export async function GET(req: NextRequest) {
  if (AUTH_DISABLED) {
    return NextResponse.json({
      id: 'dev',
      resourceType: 'User',
      name: 'Dev User',
      email: 'dev@local',
      role: 'user',
      provider: 'disabled',
    });
  }

  try {
    const profile = await getCurrentProfile(req);

    return NextResponse.json({
      id: profile.id,
      resourceType: profile.resourceType,
      name: profile.resourceType === 'Practitioner'
        ? (profile as any).name?.[0]?.text || 'Unknown'
        : (profile as any).name?.[0]?.text || 'Patient',
      email: profile.resourceType === 'Practitioner'
        ? (profile as any).telecom?.find((t: any) => t.system === 'email')?.value
        : null,
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
