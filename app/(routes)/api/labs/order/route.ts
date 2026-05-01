/**
 * API endpoint to order lab tests
 * 
 * POST /api/labs/order
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLabOrder, updateLabOrder, deleteLabOrder, type LabOrderRequest } from '@/lib/fhir/lab-service';
import { getMedplumForRequest } from '@/lib/server/medplum-auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const medplum = await getMedplumForRequest(request);
    const body: LabOrderRequest = await request.json();

    // Validate required fields
    if (!body.patientId) {
      return NextResponse.json(
        { error: 'patientId is required' },
        { status: 400 }
      );
    }

    if (!body.tests || !Array.isArray(body.tests) || body.tests.length === 0) {
      return NextResponse.json(
        { error: 'tests array is required and must not be empty' },
        { status: 400 }
      );
    }

    // Create the lab order
    const serviceRequestId = await createLabOrder(body, medplum);

    return NextResponse.json({
      success: true,
      serviceRequestId,
      message: `Lab order created for ${body.tests.length} tests`,
    });

  } catch (error: any) {
    console.error('Error creating lab order:', error);
    
    return NextResponse.json(
      {
        error: 'Failed to create lab order',
        details: error.message
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const medplum = await getMedplumForRequest(request);
    const body = await request.json();
    const { serviceRequestId, ...updates } = body;

    if (!serviceRequestId) {
      return NextResponse.json({ error: 'serviceRequestId is required' }, { status: 400 });
    }

    await updateLabOrder(serviceRequestId, updates, medplum);
    return NextResponse.json({ success: true, message: 'Lab order updated' });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to update lab order', details: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const medplum = await getMedplumForRequest(request);
    const body = await request.json();
    const { serviceRequestId } = body;

    if (!serviceRequestId) {
      return NextResponse.json({ error: 'serviceRequestId is required' }, { status: 400 });
    }

    await deleteLabOrder(serviceRequestId, medplum);
    return NextResponse.json({ success: true, message: 'Lab order deleted' });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to delete lab order', details: error.message }, { status: 500 });
  }
}








