/**
 * API endpoint to receive imaging reports from radiologists
 * 
 * This endpoint accepts radiology interpretations and creates FHIR
 * DiagnosticReport resources linked to ImagingStudy.
 * 
 * POST /api/imaging/report
 */

import { NextRequest, NextResponse } from 'next/server';
import { createImagingReport } from '@/lib/fhir/imaging-service';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { authenticateDeviceKey, extractDeviceKey } from '@/lib/fhir/device-keys';
import { AuthError, ForbiddenError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

interface CreateImagingReportRequest {
  imagingStudyId: string;
  findings: string;
  impression: string;
  status?: 'preliminary' | 'final';
  radiologist?: string;
  apiKey?: string; // Per-device key (prefer the `Authorization: Bearer` / `X-Device-Key` header)
}

export async function POST(request: NextRequest) {
  try {
    // Parse leniently so authentication is always evaluated first (no key => 401, even for a bad body).
    const body: Partial<CreateImagingReportRequest> | null = await request.json().catch(() => null);

    // Fail closed: same per-device key auth as /api/imaging/receive. The Device's clinic (and the
    // PACS module toggle for that clinic) scopes the write; nothing about clinic is read from the body.
    const device = await authenticateDeviceKey(extractDeviceKey(request, body?.apiKey), 'pacs');

    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Validate required fields
    if (!body.imagingStudyId || typeof body.imagingStudyId !== 'string') {
      return NextResponse.json(
        { error: 'imagingStudyId is required' },
        { status: 400 }
      );
    }

    if (!body.findings || !body.impression) {
      return NextResponse.json(
        { error: 'findings and impression are required' },
        { status: 400 }
      );
    }

    if (body.status !== undefined && body.status !== 'preliminary' && body.status !== 'final') {
      return NextResponse.json(
        { error: "status must be 'preliminary' or 'final'" },
        { status: 400 }
      );
    }

    // Create the imaging report (refuses a study/order of another clinic with 403)
    const medplum = await getAdminMedplum();
    const reportId = await createImagingReport(
      body.imagingStudyId,
      body.findings,
      body.impression,
      body.status || 'final',
      body.radiologist,
      medplum,
      device.clinicId
    );

    return NextResponse.json({
      success: true,
      diagnosticReportId: reportId,
      message: 'Imaging report created successfully',
    });

  } catch (error: any) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 });
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    console.error('Error creating imaging report:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to create imaging report',
        details: error.message 
      },
      { status: 500 }
    );
  }
}

// Example curl request:
/*
curl -X POST http://localhost:3000/api/imaging/report \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <per-device key>" \
  -d '{
    "imagingStudyId": "imaging-study-123",
    "findings": "The lungs are clear without focal consolidation, pleural effusion, or pneumothorax. The cardiac silhouette is normal in size. The mediastinal contours are unremarkable. The osseous structures are intact.",
    "impression": "Normal chest radiograph. No acute cardiopulmonary abnormality.",
    "status": "final",
    "radiologist": "Dr. Jane Smith, MD"
  }'
*/
