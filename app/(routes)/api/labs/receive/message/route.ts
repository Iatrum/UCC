/**
 * API endpoint to receive a raw analyser message (HL7 ORU^R01 or ASTM E1394)
 * for a POCT order and translate it into the same Observation/DiagnosticReport
 * pipeline `/api/labs/receive` uses for JSON results.
 *
 * This is the "Bot" bridge for Task 10's simulated analyser: parsing lives in
 * lib/poct/analyser-bot.ts (handler shape kept deploy-ready as a real Medplum
 * Bot — see .ai/progress-task10.md for why it is not a live Bot resource yet).
 *
 * POST /api/labs/receive/message
 */

import { NextRequest, NextResponse } from 'next/server';
import { ingestAnalyserMessage, type AnalyserMessageFormat } from '@/lib/poct/analyser-bot';
import { getAdminMedplum } from '@/lib/server/medplum-admin';

export const runtime = 'nodejs';

interface ReceiveAnalyserMessageRequest {
  format: AnalyserMessageFormat;
  message: string;
  apiKey?: string; // Same auth contract as /api/labs/receive.
}

export async function POST(request: NextRequest) {
  try {
    const body: ReceiveAnalyserMessageRequest = await request.json();

    // Same contract as /api/labs/receive: optional key, only enforced when POCT_API_KEY is set.
    const expectedApiKey = process.env.POCT_API_KEY;
    if (expectedApiKey && body.apiKey !== expectedApiKey) {
      return NextResponse.json({ error: 'Unauthorized: Invalid API key' }, { status: 401 });
    }

    if (body.format !== 'hl7' && body.format !== 'astm') {
      return NextResponse.json({ error: "format must be 'hl7' or 'astm'" }, { status: 400 });
    }
    if (!body.message || typeof body.message !== 'string') {
      return NextResponse.json({ error: 'message (raw analyser text) is required' }, { status: 400 });
    }

    const medplum = await getAdminMedplum();
    const result = await ingestAnalyserMessage({ format: body.format, message: body.message }, medplum);

    return NextResponse.json({
      success: true,
      serviceRequestId: result.serviceRequestId,
      diagnosticReportId: result.diagnosticReportId,
      message: 'Analyser message received and stored successfully',
    });
  } catch (error: any) {
    console.error('Error receiving analyser message:', error);

    return NextResponse.json(
      { error: 'Failed to receive analyser message', details: error.message },
      { status: 400 }
    );
  }
}
