import { NextRequest, NextResponse } from 'next/server';
import { checkInPatient } from '@/lib/models';

export async function POST(request: NextRequest) {
  try {
    const { patientId, chiefComplaint } = await request.json();

    if (!patientId) {
      return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
    }

    await checkInPatient(patientId, chiefComplaint);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[check-in] Failed to check patient in:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to check patient in' },
      { status: 500 }
    );
  }
}
