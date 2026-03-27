import { NextRequest, NextResponse } from 'next/server';
import {
  checkInPatientInTriage,
  getTriageQueueForToday,
  updateQueueStatusForPatient,
} from '@/lib/fhir/triage-service';
import { getMedplumForRequest } from '@/lib/server/medplum-auth';

export async function GET(req: NextRequest) {
  try {
    const medplum = await getMedplumForRequest(req);
    const patients = await getTriageQueueForToday(200, medplum);
    return NextResponse.json({ success: true, patients });
  } catch (error: any) {
    console.error('[queue] Failed to load triage queue:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to load queue' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const medplum = await getMedplumForRequest(req);
    const { patientId } = await req.json();
    if (!patientId) {
      return NextResponse.json({ success: false, error: 'patientId is required' }, { status: 400 });
    }
    await checkInPatientInTriage(patientId, undefined, medplum);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[queue] Failed to add:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Failed to add to queue' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const medplum = await getMedplumForRequest(req);
    const { patientId } = await req.json();
    if (!patientId) {
      return NextResponse.json({ success: false, error: 'patientId is required' }, { status: 400 });
    }
    await updateQueueStatusForPatient(patientId, null, medplum);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[queue] Failed to remove:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Failed to remove from queue' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const medplum = await getMedplumForRequest(req);
    const { patientId, status } = await req.json();
    if (!patientId || typeof status === 'undefined') {
      return NextResponse.json({ success: false, error: 'patientId and status are required' }, { status: 400 });
    }
    await updateQueueStatusForPatient(patientId, status, medplum);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[queue] Failed to update status:', error);
    return NextResponse.json({ success: false, error: error?.message || 'Failed to update queue status' }, { status: 500 });
  }
}
