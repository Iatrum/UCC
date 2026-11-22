import { NextRequest, NextResponse } from 'next/server';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';
import { getPractitionersFromMedplum } from '@/lib/fhir/admin-service';

export async function GET(request: NextRequest) {
  try {
    const { medplum } = await requireClinicAuth(request);
    const practitioners = await getPractitionersFromMedplum(medplum);
    // Task 797: callers only need a picker (id + name); do not hand staff e-mails or other clinics' memberships to every clinic user.
    return NextResponse.json({
      success: true,
      practitioners: practitioners.map(({ id, name }) => ({ id, name })),
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
