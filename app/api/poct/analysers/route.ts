import { NextRequest, NextResponse } from 'next/server';
import { requireClinicAuth, getCurrentProfile } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';
import { listPoctAnalysers } from '@/lib/fhir/poct-device';
import { isModuleEnabledForClinic } from '@/lib/module-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // This endpoint requires a session even when the development auth bypass is enabled.
    await getCurrentProfile(request);
    const { clinicId } = await requireClinicAuth(request);
    if (!(await isModuleEnabledForClinic('poct', clinicId))) {
      return NextResponse.json({ error: 'POCT module is disabled' }, { status: 404 });
    }
    return NextResponse.json({ analysers: await listPoctAnalysers(clinicId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'POCT analysers');
  }
}
