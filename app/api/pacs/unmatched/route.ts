/**
 * Review list for studies the PACS received without a matching X-ray order (X-ray phase 3).
 *   GET  /api/pacs/unmatched                                  -> { studies, orders }
 *   POST /api/pacs/unmatched { id, action: 'attach', serviceRequestId } | { id, action: 'dismiss' }
 * Signed-in clinic staff only, always scoped to the caller's clinic; requires the `pacs` module.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getCurrentProfile, requireClinicAuth } from '@/lib/server/medplum-auth';
import { isModuleEnabledForClinic } from '@/lib/module-registry';
import { ForbiddenError } from '@/lib/server/route-helpers';
import { attachUnmatchedStudy, dismissUnmatchedStudy, listOpenXrayOrders, listUnmatchedStudies } from '@/lib/pacs/study-ingest';
import { handlePacsRouteError } from '@/lib/pacs/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function staff(request: NextRequest) {
  const profile = await getCurrentProfile(request);
  const { medplum, clinicId } = await requireClinicAuth(request);
  if (!(await isModuleEnabledForClinic('pacs', clinicId))) throw new ForbiddenError('PACS module is disabled for this clinic');
  return { medplum, clinicId, actor: profile?.id ? `${profile.resourceType}/${profile.id}` : undefined };
}

export async function GET(request: NextRequest) {
  try {
    const { medplum, clinicId } = await staff(request);
    const studies = await listUnmatchedStudies(clinicId);
    const orders = studies.length ? await listOpenXrayOrders(clinicId, medplum) : [];
    return NextResponse.json({ studies, orders }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return handlePacsRouteError(error, 'pacs/unmatched');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { medplum, clinicId, actor } = await staff(request);
    const body = await request.json().catch(() => ({})) as { id?: unknown; action?: unknown; serviceRequestId?: unknown };
    if (typeof body.id !== 'string' || (body.action !== 'attach' && body.action !== 'dismiss')) {
      return NextResponse.json({ error: 'id and action (attach|dismiss) are required' }, { status: 400 });
    }
    if (body.action === 'dismiss') {
      await dismissUnmatchedStudy(clinicId, body.id, actor);
      return NextResponse.json({ success: true });
    }
    if (typeof body.serviceRequestId !== 'string') {
      return NextResponse.json({ error: 'serviceRequestId is required' }, { status: 400 });
    }
    const result = await attachUnmatchedStudy(clinicId, body.id, body.serviceRequestId, medplum, actor);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return handlePacsRouteError(error, 'pacs/unmatched');
  }
}
