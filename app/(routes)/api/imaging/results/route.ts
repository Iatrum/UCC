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
import { gateXrayStudies, isXrayModality, sanitizePacsViewerUrl } from '@/lib/fhir/pacs-link';
import { allowedPacsUrl } from '@/lib/fhir/pacs-allowlist';
import { getPacsHostsForClinic } from '@/lib/server/pacs-hosts';
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
      studies = await getEncounterImagingStudies(encounterId, medplum, clinicId);
    } else if (patientId) {
      studies = await getPatientImagingStudies(patientId, medplum, clinicId);
    }

    const pacsEnabled = await isModuleEnabledForClinic('pacs', clinicId);
    const gated = gateXrayStudies(studies || [], pacsEnabled);
    // X-ray viewer links are default-deny: kept only for X-ray modalities and hosts on the clinic allowlist.
    const hosts = gated.some((s) => s.xray || isXrayModality(s.modality)) ? await getPacsHostsForClinic(clinicId) : [];
    const result = gated.map((s) => {
      if (!s.study) return s;
      const xray = s.xray || isXrayModality(s.modality);
      const link = pacsEnabled && xray && isXrayModality(s.modality) ? allowedPacsUrl(s.study.pacsUrl, hosts) : undefined;
      return {
        ...s,
        study: {
          ...s.study,
          pacsUrl: link,
          series: s.study.series.map((x) => ({
            ...x,
            endpoint: xray
              ? (pacsEnabled ? allowedPacsUrl(x.endpoint, hosts) : undefined)
              : sanitizePacsViewerUrl(x.endpoint),
          })),
        },
      };
    });
    return NextResponse.json({ success: true, studies: result });

  } catch (error: any) {
    return handleRouteError(error, 'imaging/results');
  }
}








