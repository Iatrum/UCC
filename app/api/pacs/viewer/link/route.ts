/**
 * POST /api/pacs/viewer/link { imagingStudyId }  - mint a viewer link (X-ray phase 3).
 *
 * Signed-in clinic staff only. The study must belong to the caller's clinic (403 otherwise) and be
 * held by the clinic PACS. Returns a URL on the viewer origin carrying a single-use, 60-second launch
 * token bound to that clinic and that one study. No Orthanc credential or address is ever returned.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentProfile, requireClinicAuth } from '@/lib/server/medplum-auth';
import { isModuleEnabledForClinic } from '@/lib/module-registry';
import { ForbiddenError, NotFoundError } from '@/lib/server/route-helpers';
import { getClinicIdentifierValue } from '@/lib/fhir/clinic-tenancy';
import { isPacsStoredStudy, isXrayStudy } from '@/lib/fhir/pacs-link';
import { readStudyUid } from '@/lib/pacs/accession';
import { pacsServesClinic, requirePacsConfig } from '@/lib/pacs/orthanc-client';
import { LAUNCH_TTL_SECONDS, isDicomUid, mintViewerToken } from '@/lib/pacs/viewer-token';
import { handlePacsRouteError } from '@/lib/pacs/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    // A real session is required even when the development auth bypass is on.
    await getCurrentProfile(request);
    const { medplum, clinicId } = await requireClinicAuth(request);
    if (!(await isModuleEnabledForClinic('pacs', clinicId))) throw new ForbiddenError('PACS module is disabled for this clinic');

    const body = await request.json().catch(() => ({})) as { imagingStudyId?: unknown };
    const id = typeof body.imagingStudyId === 'string' && /^[A-Za-z0-9.-]{1,64}$/.test(body.imagingStudyId) ? body.imagingStudyId : undefined;
    if (!id) return NextResponse.json({ error: 'imagingStudyId is required' }, { status: 400 });

    // Clinic AND id in one search, re-checked on the result: another clinic's study is never read by id.
    const study = await medplum.searchOne('ImagingStudy', { identifier: `clinic|${clinicId}`, _id: id }, { cache: 'no-cache' });
    if (!study?.id || getClinicIdentifierValue(study) !== clinicId) throw new ForbiddenError('Imaging study unavailable in current clinic');

    const studyUid = readStudyUid(study);
    if (!isXrayStudy(study) || !isPacsStoredStudy(study) || !isDicomUid(studyUid)) throw new NotFoundError('No stored images for this study');

    const config = requirePacsConfig();
    if (!pacsServesClinic(config, clinicId)) throw new ForbiddenError('PACS storage is not available to this clinic');
    const token = mintViewerToken({ kind: 'launch', clinicId, studyUid }, config.viewerSecret);
    return NextResponse.json(
      { url: `${config.viewerOrigin}/launch?t=${encodeURIComponent(token)}`, expiresIn: LAUNCH_TTL_SECONDS },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    return handlePacsRouteError(error, 'pacs/viewer/link');
  }
}
