import { NextRequest, NextResponse } from 'next/server';
import type { InventoryMedicationData } from '@/lib/fhir/inventory-service';
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
import { InventoryValidationError, parseInventoryInput } from '@/lib/fhir/inventory-validation';

function inventoryError(error: unknown, context: string) {
  if (error instanceof InventoryValidationError) {
    return NextResponse.json({ success: false, error: error.message }, { status: 400 });
  }
  return handleRouteError(error, context);
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
    const body = await request.json().catch(() => null);
    const data = parseInventoryInput(body, { partial: false }) as InventoryMedicationData;

    const medicationId = await createInventoryMedicationInMedplum(medplum, data, clinicId);
    return NextResponse.json({
      success: true,
      medicationId,
      message: 'Medication saved to FHIR successfully',
    });
  } catch (error) {
    return inventoryError(error, 'POST /api/inventory');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { clinicId } = await requireClinicAuth(request);
    const medplum = await getAdminMedplum();
    const body = await request.json().catch(() => null);
    const { medicationId, ...rawUpdates } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

    if (typeof medicationId !== 'string' || !medicationId) {
      return NextResponse.json({ success: false, error: 'Missing medicationId' }, { status: 400 });
    }
    const updates = parseInventoryInput(rawUpdates, { partial: true });

    await updateInventoryMedicationInMedplum(medplum, medicationId, updates, clinicId);
    return NextResponse.json({ success: true, message: 'Medication updated successfully' });
  } catch (error) {
    return inventoryError(error, 'PATCH /api/inventory');
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
