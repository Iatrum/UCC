import { NextRequest, NextResponse } from 'next/server';
import {
  createInventoryMedicationInMedplum,
  deleteInventoryMedicationInMedplum,
  getInventoryMedicationByIdFromMedplum,
  getInventoryMedicationsFromMedplum,
  updateInventoryMedicationInMedplum,
} from '@/lib/fhir/inventory-service';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';

const FHIR_INTEGER_MAX = 2147483647;

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= FHIR_INTEGER_MAX;
}

function isNonNegativeFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

export async function GET(request: NextRequest) {
  try {
    const { clinicId } = await requireClinicAuth(request);
    const medplum = await getAdminMedplum();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (id) {
      const medication = await getInventoryMedicationByIdFromMedplum(medplum, id, clinicId);
      if (!medication) {
        return NextResponse.json({ success: false, error: 'Medication not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, medication });
    }

    const medications = await getInventoryMedicationsFromMedplum(medplum, clinicId);
    return NextResponse.json({ success: true, medications, count: medications.length });
  } catch (error) {
    return handleRouteError(error, 'GET /api/inventory');
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

    if (
      data.strengths !== undefined &&
      (!Array.isArray(data.strengths) || !data.strengths.every((strength: unknown) => typeof strength === 'string'))
    ) {
      return NextResponse.json({ success: false, error: 'strengths must be an array of strings' }, { status: 400 });
    }

    if (data.stock !== undefined && !isNonNegativeInteger(data.stock)) {
      return NextResponse.json({ success: false, error: 'stock must be a non-negative integer' }, { status: 400 });
    }

    if (data.minimumStock !== undefined && !isNonNegativeInteger(data.minimumStock)) {
      return NextResponse.json({ success: false, error: 'minimumStock must be a non-negative integer' }, { status: 400 });
    }

    if (data.unitPrice !== undefined && !isNonNegativeFiniteNumber(data.unitPrice)) {
      return NextResponse.json({ success: false, error: 'unitPrice must be a non-negative number' }, { status: 400 });
    }

    data.strengths = data.strengths ?? [];

    const medicationId = await createInventoryMedicationInMedplum(medplum, data, clinicId);
    return NextResponse.json({
      success: true,
      medicationId,
      message: 'Medication saved to FHIR successfully',
    });
  } catch (error) {
    return handleRouteError(error, 'POST /api/inventory');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { clinicId } = await requireClinicAuth(request);
    const medplum = await getAdminMedplum();
    const { medicationId, ...updates } = await request.json();

    if (!medicationId) {
      return NextResponse.json({ success: false, error: 'Missing medicationId' }, { status: 400 });
    }

    await updateInventoryMedicationInMedplum(medplum, medicationId, updates, clinicId);
    return NextResponse.json({ success: true, message: 'Medication updated successfully' });
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/inventory');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { clinicId } = await requireClinicAuth(request);
    const medplum = await getAdminMedplum();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing medication id' }, { status: 400 });
    }

    await deleteInventoryMedicationInMedplum(medplum, id, clinicId);
    return NextResponse.json({ success: true, message: 'Medication deleted successfully' });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/inventory');
  }
}
