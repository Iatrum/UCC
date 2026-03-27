import { NextRequest, NextResponse } from 'next/server';
import { getConsultationFromMedplum } from '@/lib/fhir/consultation-service';
import { getPatientFromMedplum } from '@/lib/fhir/patient-service';
import { getClinicIdFromRequest } from '@/lib/server/clinic';
import { getMedplumForRequest } from '@/lib/server/medplum-auth';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const consultationId = searchParams.get('consultationId');
    const patientId = searchParams.get('patientId');
    const clinicId = await getClinicIdFromRequest(req);

    if (!consultationId || !patientId) {
      return NextResponse.json({ success: false, error: 'consultationId and patientId are required' }, { status: 400 });
    }

    if (!clinicId) {
      return NextResponse.json({ success: false, error: 'Missing clinicId' }, { status: 400 });
    }

    const medplum = await getMedplumForRequest(req);

    const [patient, consultation] = await Promise.all([
      getPatientFromMedplum(patientId, clinicId, medplum),
      getConsultationFromMedplum(consultationId, clinicId, medplum),
    ]);

    if (!patient || !consultation) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, patient, consultation });
  } catch (error: any) {
    console.error('[orders] Failed to load details:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Failed to load details' }, { status: 500 });
  }
}
