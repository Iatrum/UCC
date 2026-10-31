/**
 * API endpoint to receive lab results from POCT systems
 * 
 * This endpoint accepts lab results in JSON format and creates FHIR
 * DiagnosticReport and Observation resources in Medplum.
 * 
 * POST /api/labs/receive
 */

import { NextRequest, NextResponse } from 'next/server';
import { receiveLabResults, type ReceivedLabResult } from '@/lib/fhir/lab-service';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { verifyDeviceApiKey } from '@/lib/server/device-api-key';

export const runtime = 'nodejs';

interface ReceiveLabResultsRequest {
  serviceRequestId: string;
  results: ReceivedLabResult[];
  conclusion?: string;
  // Legacy back-compat only: body keys may be logged; use the supported x-api-key header.
  apiKey?: string;
}

const OBSERVATION_STATUSES = new Set([
  'registered', 'preliminary', 'final', 'amended', 'corrected',
  'cancelled', 'entered-in-error', 'unknown',
]);

export async function POST(request: NextRequest) {
  try {
    const body: ReceiveLabResultsRequest | null = await request.json().catch(() => null);

    const auth = verifyDeviceApiKey(request, body, 'POCT_API_KEY');
    if (!auth.ok) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: auth.status }
      );
    }

    // Validate required fields
    if (!body?.serviceRequestId) {
      return NextResponse.json(
        { error: 'serviceRequestId is required' },
        { status: 400 }
      );
    }

    if (!body.results || !Array.isArray(body.results) || body.results.length === 0) {
      return NextResponse.json(
        { error: 'results array is required and must not be empty' },
        { status: 400 }
      );
    }

    // Validate each result
    for (const result of body.results) {
      if (!result?.testCode || !result.testName || result.value === undefined) {
        return NextResponse.json(
          { error: 'Each result must have testCode, testName, and value' },
          { status: 400 }
        );
      }
      if (result.status !== undefined && !OBSERVATION_STATUSES.has(result.status)) {
        return NextResponse.json(
          { error: 'Invalid result.status: must be a FHIR R4 Observation status' },
          { status: 400 }
        );
      }
    }

    // Process the lab results
    const medplum = await getAdminMedplum();
    const reportId = await receiveLabResults(
      body.serviceRequestId,
      body.results,
      body.conclusion,
      medplum
    );

    return NextResponse.json({
      success: true,
      diagnosticReportId: reportId,
      message: 'Lab results received and stored successfully',
    });

  } catch (error) {
    console.error('Error receiving lab results:', error);
    
    return NextResponse.json(
      { error: 'Failed to receive lab results' },
      { status: 500 }
    );
  }
}

// Example curl request:
/*
curl -X POST http://localhost:3000/api/labs/receive \
  -H "Content-Type: application/json" \
  -d '{
    "serviceRequestId": "service-request-123",
    "apiKey": "your-api-key",
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








