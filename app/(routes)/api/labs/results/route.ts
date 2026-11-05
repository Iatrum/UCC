/**
 * API endpoint to get lab results
 * 
 * GET /api/labs/results?patientId=xxx
 * GET /api/labs/results?encounterId=xxx
 */

import { NextRequest, NextResponse } from 'next/server';
import { getPatientLabResults, getEncounterLabResults, getPatientPendingPoctOrders } from '@/lib/fhir/lab-service';
import { handleRouteError, ForbiddenError } from '@/lib/server/route-helpers';
import { isModuleEnabledForClinic } from '@/lib/module-registry';
import { POCT_TAG_SYSTEM } from '@/lib/fhir/poct-device';
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

    let reports: import('@/lib/fhir/lab-constants').LabReportSummary[] = [];
    let pending;
    if (encounterId) {
      reports = await getEncounterLabResults(encounterId, medplum);
    } else if (patientId) {
      reports = await getPatientLabResults(patientId, medplum);
      pending = await getPatientPendingPoctOrders(patientId, medplum, clinicId);
    }

    const poctEnabled = await isModuleEnabledForClinic('poct', clinicId);
    if (!poctEnabled && reports?.length) {
      // Resolve only this page's linked orders; avoid truncating a patient's history.
      const visible = await Promise.all(reports.map(async (report) => {
        const raw = await medplum.readResource('DiagnosticReport', report.id, { cache: 'no-cache' });
        for (const ref of raw.basedOn || []) {
          if (!ref.reference?.startsWith('ServiceRequest/')) continue;
          const order = await medplum.searchOne('ServiceRequest', {
            _id: ref.reference.split('/')[1], identifier: `clinic|${clinicId}`,
          }, { cache: 'no-cache' });
          if (!order || order.meta?.tag?.some((tag) => tag.system === POCT_TAG_SYSTEM && tag.code === 'poct')) return false;
        }
        return true;
      }));
      reports = reports.filter((_, index) => visible[index]);
    }
    return NextResponse.json({
      success: true,
      poctEnabled,
      reports,
      pending: pending || [],
    }, { headers: { 'Cache-Control': 'no-store' } });

  } catch (error: any) {
    return handleRouteError(error, 'GET /api/labs/results');
  }
}








