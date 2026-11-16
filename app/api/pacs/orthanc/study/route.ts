/**
 * POST /api/pacs/orthanc/study  - PACS ingress (X-ray phase 3).
 *
 * Called by the clinic Orthanc (Lua OnStableStudy) when a study is complete. Body: { orthancStudyId }.
 * Auth: per-device key (#236) -> the device's clinic scopes everything. The payload is only a
 * pointer: UCC reads the study from Orthanc itself, matches it by AccessionNumber to an open X-ray
 * order of that clinic, and otherwise files it in the clinic's review list (never auto-attached).
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticateDeviceKey, extractDeviceKey } from '@/lib/fhir/device-keys';
import { AuthError, ForbiddenError } from '@/lib/server/route-helpers';
import { fetchOrthancStudy, isOrthancId, pacsServesClinic, requirePacsConfig } from '@/lib/pacs/orthanc-client';
import { ingestPacsStudyForDevice } from '@/lib/pacs/device-ingress';
import { handlePacsRouteError } from '@/lib/pacs/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { orthancStudyId?: unknown };
    // Fail closed, and authenticate before anything else (bad JSON without a key is still 401).
    const device = await authenticateDeviceKey(extractDeviceKey(request), 'pacs');
    const config = requirePacsConfig();
    if (!pacsServesClinic(config, device.clinicId)) throw new ForbiddenError('This PACS does not serve the device clinic');
    if (!isOrthancId(body.orthancStudyId)) {
      return NextResponse.json({ error: 'orthancStudyId is required' }, { status: 400 });
    }
    const study = await fetchOrthancStudy(config, body.orthancStudyId);
    if (!study) return NextResponse.json({ error: 'Study not found in PACS' }, { status: 404 });

    const result = await ingestPacsStudyForDevice(study, device.clinicId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    return handlePacsRouteError(error, 'pacs/orthanc/study');
  }
}
