/**
 * API endpoint to receive a device-reported X-ray study for a POCT-style
 * online-device order, restricted (unlike the pre-existing, unrestricted
 * POST /api/imaging/receive) to ServiceRequests tagged `xray` and gated by
 * the `pacs` module toggle.
 *
 * This is the "Bot" bridge for the X-ray device flow: translation lives in
 * lib/pacs/xray-device-bot.ts (handler kept deploy-ready as a real Medplum
 * Bot later -- see .ai/progress-task10.md for why it is not a live Bot
 * resource yet).
 *
 * POST /api/imaging/receive/message
 */

import { NextRequest, NextResponse } from 'next/server';
import { ingestXrayStudy, type XrayStudyMessage } from '@/lib/pacs/xray-device-bot';
import { guardIngressRequest, readJsonBody, asObject, ingressErrorResponse, validateStudyPayload } from '@/lib/server/device-ingress-http';
import { authenticateDeviceKey, extractDeviceKey } from '@/lib/fhir/device-keys';
import { getAdminMedplum } from '@/lib/server/medplum-admin';

export const runtime = 'nodejs';

interface ReceiveXrayStudyRequest extends XrayStudyMessage {
  apiKey?: string; // legacy body field; prefer the `Authorization: Bearer` / `X-Device-Key` header
}

export async function POST(request: NextRequest) {
  try {
    const blocked = guardIngressRequest(request, 'imaging-message');
    if (blocked) return blocked;
    const body = (asObject(await readJsonBody(request)) ?? {}) as Partial<ReceiveXrayStudyRequest>;

    // Fail closed: the calling Device is authenticated by its own key; its clinic scopes every write.
    const device = await authenticateDeviceKey(extractDeviceKey(request, body.apiKey), 'pacs');

    const invalid = validateStudyPayload(body.serviceRequestId, body.study);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const medplum = await getAdminMedplum();
    const result = await ingestXrayStudy({ serviceRequestId: body.serviceRequestId as string, study: body.study as XrayStudyMessage['study'] }, medplum, device.clinicId);

    return NextResponse.json({
      success: true,
      serviceRequestId: result.serviceRequestId,
      imagingStudyId: result.imagingStudyId,
      message: 'X-ray study received and stored successfully',
    });
  } catch (error) {
    return ingressErrorResponse(error, 'imaging/receive/message', 'X-ray study could not be processed', 400);
  }
}
