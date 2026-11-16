/**
 * API endpoint to get imaging studies
 * 
 * GET /api/imaging/results?patientId=xxx
 * GET /api/imaging/results?encounterId=xxx
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPatientImagingStudies, getEncounterImagingStudies } from '@/lib/fhir/imaging-service';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { isModuleEnabledForClinic } from '@/lib/module-registry';
import { gateXrayStudies } from '@/lib/fhir/pacs-link';
import { handleRouteError, ForbiddenError } from '@/lib/server/route-helpers';

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

    // Clinic scope: the patient/encounter must belong to the caller's clinic (same check as /api/labs/results).
    const target = await medplum.searchOne(encounterId ? 'Encounter' : 'Patient', {
      _id: (encounterId || patientId)!, identifier: `clinic|${clinicId}`,
    }, { cache: 'no-cache' });
    if (!target) throw new ForbiddenError('Imaging results unavailable in current clinic');

    let studies;
    if (encounterId) {
      studies = await getEncounterImagingStudies(encounterId, medplum);
    } else if (patientId) {
      studies = await getPatientImagingStudies(patientId, medplum);
    }

    const pacsEnabled = await isModuleEnabledForClinic('pacs', clinicId);
    return NextResponse.json({
      success: true,
      studies: gateXrayStudies(studies || [], pacsEnabled),
    });

  } catch (error: any) {
    return handleRouteError(error, 'imaging/results');
  }
}








