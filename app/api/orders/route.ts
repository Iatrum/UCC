import { assertTimeChitMutationAllowed } from '@/lib/fhir/time-chit-guard';
import { investigationBillItems, investigationBillingExtensions, INVESTIGATION_BILLING_URL } from '@/lib/fhir/investigation-billing';
import { NextRequest, NextResponse } from 'next/server';
import { getConsultationFromMedplum, updateConsultationInMedplum } from '@/lib/fhir/consultation-service';
import { getPatientFromMedplum } from '@/lib/fhir/patient-service';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';

function procedureKey(p: { procedureId?: string; name: string; price?: number; category?: string }): string {
  return `${p.procedureId ?? p.name}|${p.price ?? ''}|${p.category ?? ''}`;
}

function prescriptionKey(rx: { medication?: { id?: string; name?: string }; frequency?: string; duration?: string }): string {
  return `${rx.medication?.id ?? rx.medication?.name}|${rx.frequency ?? ''}|${rx.duration ?? ''}`;
}

export async function GET(req: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(req);
    const { searchParams } = new URL(req.url);
    const consultationId = searchParams.get('consultationId');
    const patientId = searchParams.get('patientId');

    if (!consultationId || !patientId) {
      return NextResponse.json({ success: false, error: 'consultationId and patientId are required' }, { status: 400 });
    }

    const [patient, consultation] = await Promise.all([
      getPatientFromMedplum(patientId, clinicId, medplum),
      getConsultationFromMedplum(consultationId, clinicId, medplum),
    ]);

    if (!patient || !consultation) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    if (consultation.patientId !== patientId) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, patient, consultation });
  } catch (error) {
    return handleRouteError(error, 'GET /api/orders');
  }
}

/**
 * POST - Add procedures/prescriptions to an existing consultation
 * Body: { consultationId, procedures?, prescriptions? }
 */
export async function POST(req: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(req);
    const body = await req.json();
    const { consultationId, procedures, prescriptions, billingItems } = body;

    if (!consultationId) {
      return NextResponse.json({ success: false, error: 'consultationId is required' }, { status: 400 });
    }

    const consultation = await getConsultationFromMedplum(consultationId, clinicId, medplum);
    if (!consultation) {
      return NextResponse.json({ success: false, error: 'Consultation not found' }, { status: 404 });
    }

    if (procedures !== undefined) {
      await assertTimeChitMutationAllowed(procedures, consultation.procedures || [], clinicId);
    }
    if (billingItems !== undefined) {
      if (!Array.isArray(billingItems) || billingItems.some((item: any) =>
        typeof item.id !== 'string' || typeof item.name !== 'string' || !Number.isFinite(item.price) || item.price < 0 ||
        !Number.isFinite(item.quantity) || item.quantity <= 0)) {
        return NextResponse.json({ error: 'Invalid investigation bill lines' }, { status: 400 });
      }
      const encounter = await medplum.searchOne('Encounter', { _id: consultationId, identifier: `clinic|${clinicId}` }, { cache: 'no-cache' });
      if (!encounter) return NextResponse.json({ error: 'Consultation not found' }, { status: 404 });
      const merged = new Map(investigationBillItems(encounter).map((item) => [item.id, item]));
      for (const item of billingItems) merged.set(item.id, { id: item.id, name: item.name, price: item.price,
        quantity: item.quantity, orderIndex: item.orderIndex, category: 'services' });
      await medplum.updateResource({ ...encounter, extension: [
        ...(encounter.extension || []).filter((e) => e.url !== INVESTIGATION_BILLING_URL),
        ...investigationBillingExtensions([...merged.values()]),
      ] });
    }

    const existingProcKeys = new Set((consultation.procedures || []).map(procedureKey));
    const updatedProcedures = procedures !== undefined
      ? [...(consultation.procedures || []), ...(procedures as any[]).filter(p => !existingProcKeys.has(procedureKey(p)))]
      : undefined;

    const existingRxKeys = new Set((consultation.prescriptions || []).map(prescriptionKey));
    const updatedPrescriptions = prescriptions !== undefined
      ? [...(consultation.prescriptions || []), ...(prescriptions as any[]).filter(rx => !existingRxKeys.has(prescriptionKey(rx)))]
      : undefined;

    await updateConsultationInMedplum(
      consultationId,
      {
        ...(updatedProcedures !== undefined ? { procedures: updatedProcedures } : {}),
        ...(updatedPrescriptions !== undefined ? { prescriptions: updatedPrescriptions } : {}),
      },
      clinicId,
      medplum
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'POST /api/orders');
  }
}

/**
 * PATCH - Replace procedures/prescriptions on a consultation
 * Body: { consultationId, procedures?, prescriptions? }
 */
export async function PATCH(req: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(req);
    const body = await req.json();
    const { consultationId, ...updates } = body;

    if (!consultationId) {
      return NextResponse.json({ success: false, error: 'consultationId is required' }, { status: 400 });
    }

    const consultation = await getConsultationFromMedplum(consultationId, clinicId, medplum);
    if (!consultation) {
      return NextResponse.json({ success: false, error: 'Consultation not found' }, { status: 404 });
    }

    await updateConsultationInMedplum(consultationId, updates, clinicId, medplum);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/orders');
  }
}

/**
 * DELETE - Clear procedures/prescriptions from a consultation
 * Body: { consultationId, clearProcedures?: boolean, clearPrescriptions?: boolean }
 */
export async function DELETE(req: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(req);
    const body = await req.json();
    const { consultationId, clearProcedures, clearPrescriptions } = body;

    if (!consultationId) {
      return NextResponse.json({ success: false, error: 'consultationId is required' }, { status: 400 });
    }

    const consultation = await getConsultationFromMedplum(consultationId, clinicId, medplum);
    if (!consultation) {
      return NextResponse.json({ success: false, error: 'Consultation not found' }, { status: 404 });
    }

    await updateConsultationInMedplum(
      consultationId,
      {
        ...(clearProcedures ? { procedures: [] } : {}),
        ...(clearPrescriptions ? { prescriptions: [] } : {}),
      },
      clinicId,
      medplum
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/orders');
  }
}
