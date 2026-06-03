import { NextRequest, NextResponse } from 'next/server';
import {
  createProcedureInMedplum,
  deleteProcedureInMedplum,
  getProcedureByIdFromMedplum,
  getProceduresFromMedplum,
  updateProcedureInMedplum,
} from '@/lib/fhir/procedure-service';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';

export async function GET(request: NextRequest) {
  try {
    const { clinicId } = await requireClinicAuth(request);
    const medplum = await getAdminMedplum();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      const procedure = await getProcedureByIdFromMedplum(medplum, id, clinicId);
      if (!procedure) {
        return NextResponse.json({ success: false, error: 'Procedure not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, procedure });
    }

    const procedures = await getProceduresFromMedplum(medplum, clinicId);
    return NextResponse.json({ success: true, procedures, count: procedures.length });
  } catch (error) {
    return handleRouteError(error, 'GET /api/procedures');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { clinicId } = await requireClinicAuth(request);
    const medplum = await getAdminMedplum();
    const data = await request.json();

    if (!data?.name) {
      return NextResponse.json({ success: false, error: 'Missing required field: name' }, { status: 400 });
    }

    const procedureId = await createProcedureInMedplum(medplum, data, clinicId);
    return NextResponse.json({
      success: true,
      procedureId,
      message: 'Procedure saved to FHIR successfully',
    });
  } catch (error) {
    return handleRouteError(error, 'POST /api/procedures');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { clinicId } = await requireClinicAuth(request);
    const medplum = await getAdminMedplum();
    const { procedureId, ...updates } = await request.json();

    if (!procedureId) {
      return NextResponse.json({ success: false, error: 'Missing procedureId' }, { status: 400 });
    }

    await updateProcedureInMedplum(medplum, procedureId, updates, clinicId);
    return NextResponse.json({ success: true, message: 'Procedure updated successfully' });
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/procedures');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { clinicId } = await requireClinicAuth(request);
    const medplum = await getAdminMedplum();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing procedure id' }, { status: 400 });
    }

    await deleteProcedureInMedplum(medplum, id, clinicId);
    return NextResponse.json({ success: true, message: 'Procedure deleted successfully' });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/procedures');
  }
}
