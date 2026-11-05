/**
 * API endpoint to get lab results
 * 
 * GET /api/labs/results?patientId=xxx
 * GET /api/labs/results?encounterId=xxx
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPatientLabResults, getEncounterLabResults, getPatientPendingPoctOrders } from '@/lib/fhir/lab-service';
import { handleRouteError, ForbiddenError } from '@/lib/server/route-helpers';
import { requireClinicAuth } from '@/lib/server/medplum-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const searchParams = request.nextUrl.searchParams;
    const patientId = searchParams.get('patientId');
    const encounterId = searchParams.get('encounterId');

    if (!patientId && !encounterId) {
      return NextResponse.json(
        { error: 'Either patientId or encounterId is required' },
        { status: 400 }
      );
    }

    const target = await medplum.searchOne(encounterId ? 'Encounter' : 'Patient', {
      _id: (encounterId || patientId)!, identifier: `clinic|${clinicId}`,
    }, { cache: 'no-cache' });
    if (!target) throw new ForbiddenError('Lab results unavailable in current clinic');

    let reports;
    let pending;
    if (encounterId) {
      reports = await getEncounterLabResults(encounterId, medplum);
    } else if (patientId) {
      reports = await getPatientLabResults(patientId, medplum);
      pending = await getPatientPendingPoctOrders(patientId, medplum, clinicId);
    }

    return NextResponse.json({
      success: true,
      reports,
      pending: pending || [],
    });

  } catch (error: any) {
    return handleRouteError(error, 'GET /api/labs/results');
  }
}








