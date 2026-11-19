/**
 * POST /api/pacs/orthanc/study  - PACS ingress (X-ray phase 3).
 *
 * Called by the clinic Orthanc (Lua OnStableStudy) when a study is complete. Body: { orthancStudyId }.
 * Auth: per-device key (#236) -> the device's clinic scopes everything. The payload is only a
 * pointer: UCC reads the study from Orthanc itself, matches it by AccessionNumber to an open X-ray
 * order of that clinic, and otherwise files it in the clinic's review list (never auto-attached).
 *
 * Default: answers 202 at once and does the work after the response. This matters: while Orthanc's
 * Lua callback waits for this response, Orthanc does not answer REST calls (verified on 26.11.0: the
 * read-back timed out), so reading the study back inside the request would deadlock.
 * `?wait=1` does the work before answering and returns the outcome: for resync scripts and tests
 * that call from OUTSIDE Orthanc (infra/pacs-dev/resync.sh). Both modes are idempotent.
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { authenticateDeviceKey, extractDeviceKey } from '@/lib/fhir/device-keys';
import { ForbiddenError } from '@/lib/server/route-helpers';
import { guardIngressRequest, readJsonBody, asObject, ingressErrorResponse } from '@/lib/server/device-ingress-http';
import { fetchOrthancStudy, isOrthancId, pacsServesClinic, requirePacsConfig, PacsUpstreamError, PacsNotConfiguredError, type PacsConfig } from '@/lib/pacs/orthanc-client';
import { ingestPacsStudyForDevice } from '@/lib/pacs/device-ingress';
import { handlePacsRouteError } from '@/lib/pacs/route-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

async function ingest(config: PacsConfig, orthancStudyId: string, clinicId: string) {
  const study = await fetchOrthancStudy(config, orthancStudyId);
  return study ? ingestPacsStudyForDevice(study, clinicId) : undefined;
}

/** After-response work: retry while the PACS is unreachable, then give up loudly (resync recovers it). */
async function ingestWithRetry(config: PacsConfig, orthancStudyId: string, clinicId: string, delays = RETRY_DELAYS_MS): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await ingest(config, orthancStudyId, clinicId);
      if (!result) console.warn(`[pacs/orthanc/study] study ${orthancStudyId} is not in the PACS any more`);
      return;
    } catch (error) {
      if (!(error instanceof PacsUpstreamError) || attempt >= delays.length) {
        console.error(`[pacs/orthanc/study] ingest of ${orthancStudyId} failed; run the PACS resync`, error instanceof Error ? error.message : error);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const blocked = guardIngressRequest(request, 'pacs-orthanc-study', 4 * 1024);
    if (blocked) return blocked;
    const body = (asObject(await readJsonBody(request, 4 * 1024)) ?? {}) as { orthancStudyId?: unknown };
    // Fail closed, and authenticate before anything else (bad JSON without a key is still 401).
    const device = await authenticateDeviceKey(extractDeviceKey(request), 'pacs');
    const config = requirePacsConfig();
    if (!pacsServesClinic(config, device.clinicId)) throw new ForbiddenError('This PACS does not serve the device clinic');
    const orthancStudyId = body.orthancStudyId;
    if (!isOrthancId(orthancStudyId)) {
      return NextResponse.json({ error: 'orthancStudyId is required' }, { status: 400 });
    }

    if (request.nextUrl.searchParams.get('wait') === '1') {
      const result = await ingest(config, orthancStudyId, device.clinicId);
      if (!result) return NextResponse.json({ error: 'Study not found in PACS' }, { status: 404 });
      return NextResponse.json({ success: true, ...result });
    }

    const work = () => ingestWithRetry(config, orthancStudyId, device.clinicId);
    try {
      after(work);
    } catch {
      // No request scope (direct handler call in unit tests): do the work before answering.
      await ingestWithRetry(config, orthancStudyId, device.clinicId, []);
    }
    return NextResponse.json({ accepted: true }, { status: 202 });
  } catch (error) {
    if (error instanceof PacsNotConfiguredError || error instanceof PacsUpstreamError) {
      return handlePacsRouteError(error, 'pacs/orthanc/study');
    }
    return ingressErrorResponse(error, 'pacs/orthanc/study', 'Failed to process study');
  }
}
