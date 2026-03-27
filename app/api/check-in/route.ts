import { NextRequest, NextResponse } from 'next/server';
import { checkInPatientInTriage } from '@/lib/fhir/triage-service';
import { getMedplumForRequest } from '@/lib/server/medplum-auth';

export async function POST(request: NextRequest) {
  try {
    const { patientId, chiefComplaint } = await request.json();
    const medplum = await getMedplumForRequest(request);

    if (!patientId) {
      return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
    }

    await checkInPatientInTriage(patientId, chiefComplaint, medplum);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[check-in] Failed to check patient in:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to check patient in' },
      { status: 500 }
    );
  }
}
