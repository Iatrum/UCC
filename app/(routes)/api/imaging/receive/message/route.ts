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
import { ForbiddenError, ConflictError } from '@/lib/server/route-helpers';
import { getAdminMedplum } from '@/lib/server/medplum-admin';

export const runtime = 'nodejs';

interface ReceiveXrayStudyRequest extends XrayStudyMessage {
  apiKey?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: ReceiveXrayStudyRequest = await request.json();

    // Device ingress must fail closed when its key has not been configured.
    const expectedApiKey = process.env.PACS_API_KEY;
    if (!expectedApiKey) {
      return NextResponse.json({ error: 'X-ray device ingestion is not configured' }, { status: 503 });
    }
    if (body.apiKey !== expectedApiKey) {
      return NextResponse.json({ error: 'Unauthorized: Invalid API key' }, { status: 401 });
    }

    if (!body.serviceRequestId) {
      return NextResponse.json({ error: 'serviceRequestId is required' }, { status: 400 });
    }
    if (!body.study?.studyUid) {
      return NextResponse.json({ error: 'study.studyUid is required' }, { status: 400 });
    }

    const medplum = await getAdminMedplum();
    const result = await ingestXrayStudy({ serviceRequestId: body.serviceRequestId, study: body.study }, medplum);

    return NextResponse.json({
      success: true,
      serviceRequestId: result.serviceRequestId,
      imagingStudyId: result.imagingStudyId,
      message: 'X-ray study received and stored successfully',
    });
  } catch (error: any) {
    if (error instanceof ForbiddenError || error instanceof ConflictError) {
      return NextResponse.json({ error: error.message }, { status: error instanceof ForbiddenError ? 403 : 409 });
    }

    return NextResponse.json(
      { error: 'Failed to receive X-ray study', details: error.message },
      { status: 400 }
    );
  }
}
