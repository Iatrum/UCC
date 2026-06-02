export const dynamic = 'force-dynamic';

import { getConsultationsWithDetails } from '@/lib/models';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';
import { QueueStatus } from '@/lib/types';
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(req);
    const statuses: QueueStatus[] = ['meds_and_bills'];
    const consultations = await getConsultationsWithDetails(statuses, medplum, clinicId);
    return NextResponse.json({ consultations });
  } catch (error) {
    return handleRouteError(error, 'GET /api/orders/billable');
  }
}
