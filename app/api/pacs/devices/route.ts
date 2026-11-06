import { NextRequest, NextResponse } from 'next/server';
import { requireClinicAuth, getCurrentProfile } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';
import { listXrayDevices } from '@/lib/fhir/xray-device';
import { isModuleEnabledForClinic } from '@/lib/module-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // This endpoint requires a session even when the development auth bypass is enabled.
    await getCurrentProfile(request);
    const { medplum, clinicId } = await requireClinicAuth(request);
    if (!(await isModuleEnabledForClinic('pacs', clinicId))) {
      return NextResponse.json({ error: 'PACS module is disabled' }, { status: 404 });
    }
    return NextResponse.json({ devices: await listXrayDevices(medplum, clinicId) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handleRouteError(error, 'PACS X-ray devices');
  }
}
