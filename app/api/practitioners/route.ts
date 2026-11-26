import { NextRequest, NextResponse } from 'next/server';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';
import { getClinicPractitionerOptions } from '@/lib/fhir/admin-service';

export async function GET(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const practitioners = await getClinicPractitionerOptions(medplum, clinicId);
    return NextResponse.json({ success: true, practitioners });
  } catch (error) {
    return handleRouteError(error);
  }
}
