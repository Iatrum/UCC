/**
 * API endpoint to receive lab results from POCT systems
 * 
 * This endpoint accepts lab results in JSON format and creates FHIR
 * DiagnosticReport and Observation resources in Medplum.
 * 
 * POST /api/labs/receive
 */

import { NextRequest, NextResponse } from 'next/server';
import { receiveLabResults, type LabResult } from '@/lib/fhir/lab-service';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { authenticateDeviceKey, extractDeviceKey } from '@/lib/fhir/device-keys';
import { validateLabReceiveResults } from '@/lib/fhir/lab-receive-validation';
import { guardIngressRequest, readJsonBody, asObject, ingressErrorResponse } from '@/lib/server/device-ingress-http';

export const runtime = 'nodejs';

interface ReceiveLabResultsRequest {
  serviceRequestId: string;
  results: LabResult[];
  conclusion?: string;
  apiKey?: string; // Per-device key (prefer the `Authorization: Bearer` / `X-Device-Key` header)
}

export async function POST(request: NextRequest) {
  try {
    // Parse leniently so authentication still runs first; a bad body is reported as 400 after auth.
    const blocked = guardIngressRequest(request, 'labs-receive');
    if (blocked) return blocked;
    const parsed = await readJsonBody(request);
    const body = (asObject(parsed) ?? {}) as Partial<ReceiveLabResultsRequest>;

    // Fail closed: the calling analyser Device is authenticated by its own key; its clinic scopes every write.
    const device = await authenticateDeviceKey(extractDeviceKey(request, body.apiKey), 'poct');

    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }

    // Validate required fields
    if (typeof body.serviceRequestId !== 'string' || !body.serviceRequestId.trim()) {
      return NextResponse.json(
        { error: 'serviceRequestId is required' },
        { status: 400 }
      );
    }

    const validated = validateLabReceiveResults(body.results);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    // Process the lab results
    const medplum = await getAdminMedplum();
    const reportId = await receiveLabResults(
      body.serviceRequestId!.trim(),
      validated.results,
      typeof body.conclusion === 'string' ? body.conclusion : undefined,
      medplum,
      device.clinicId
    );

    return NextResponse.json({
      success: true,
      diagnosticReportId: reportId,
      message: 'Lab results received and stored successfully',
    });

  } catch (error) {
    return ingressErrorResponse(error, 'labs/receive', 'Failed to receive lab results');
  }
}

// Example curl request:
/*
curl -X POST http://localhost:3000/api/labs/receive \
  -H "Content-Type: application/json" \
  -d '{
    "serviceRequestId": "service-request-123",
    "apiKey": "<per-device key>",
    "results": [
      {
        "testCode": "2339-0",
        "testName": "Glucose",
        "value": 95,
        "unit": "mg/dL",
        "referenceRange": "70-100 mg/dL",
        "interpretation": "normal",
        "status": "final"
      },
      {
        "testCode": "4548-4",
        "testName": "Hemoglobin A1c",
        "value": 5.6,
        "unit": "%",
        "referenceRange": "< 5.7%",
        "interpretation": "normal",
        "status": "final"
      }
    ],
    "conclusion": "All tests within normal limits"
  }'
*/








