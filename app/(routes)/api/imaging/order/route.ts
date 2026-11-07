/**
 * API endpoint to order imaging studies
 * 
 * POST /api/imaging/order
 */

import { NextRequest, NextResponse } from 'next/server';
import { createImagingOrder, updateImagingOrder, deleteImagingOrder, type ImagingOrderRequest } from '@/lib/fhir/imaging-service';
import { handleRouteError } from '@/lib/server/route-helpers';
import { getCurrentProfile, requireClinicAuth } from '@/lib/server/medplum-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const body: ImagingOrderRequest = await request.json();

    // Validate required fields
    if (!body.patientId) {
      return NextResponse.json(
        { error: 'patientId is required' },
        { status: 400 }
      );
    }

    if (!body.procedures || !Array.isArray(body.procedures) || body.procedures.length === 0) {
      return NextResponse.json(
        { error: 'procedures array is required and must not be empty' },
        { status: 400 }
      );
    }

    if (!body.clinicalIndication?.trim()) {
      return NextResponse.json(
        { error: 'clinicalIndication is required for imaging orders' },
        { status: 400 }
      );
    }

    if (body.xray) {
      const profile = await getCurrentProfile(request);
      if (profile.resourceType !== 'Practitioner' || !profile.id) {
        return NextResponse.json({ error: 'Practitioner required for X-ray orders' }, { status: 403 });
      }
      body.orderedBy = `Practitioner/${profile.id}`;
    }

    // Create the imaging order
    const serviceRequestId = await createImagingOrder(body, medplum, clinicId);

    return NextResponse.json({
      success: true,
      serviceRequestId,
      message: `Imaging order created for ${body.procedures.length} procedures`,
    });

  } catch (error) {
    return handleRouteError(error, 'POST /api/imaging/order');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const body = await request.json();
    const { serviceRequestId, ...updates } = body;

    if (!serviceRequestId) {
      return NextResponse.json({ error: 'serviceRequestId is required' }, { status: 400 });
    }

    await updateImagingOrder(serviceRequestId, updates, medplum, clinicId);
    return NextResponse.json({ success: true, message: 'Imaging order updated' });
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/imaging/order');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const body = await request.json();
    const { serviceRequestId } = body;

    if (!serviceRequestId) {
      return NextResponse.json({ error: 'serviceRequestId is required' }, { status: 400 });
    }

    await deleteImagingOrder(serviceRequestId, medplum, clinicId);
    return NextResponse.json({ success: true, message: 'Imaging order deleted' });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/imaging/order');
  }
}







