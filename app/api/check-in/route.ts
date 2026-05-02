import { NextRequest, NextResponse } from 'next/server';
import { checkInPatientInTriage } from '@/lib/fhir/triage-service';
import { getPatientFromMedplum } from '@/lib/fhir/patient-service';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';

export async function POST(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const body = await request.json();

    const {
      patientId,
      chiefComplaint,
      visitIntent,
      payerType,
      paymentMethod,
      assignedClinician,
      billingPerson,
      dependentName,
      dependentRelationship,
      dependentPhone,
      registrationSource,
      registrationAt,
      performedBy,
    } = body;

    if (!patientId) {
      return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
    }

    const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    await checkInPatientInTriage(
      patientId,
      chiefComplaint,
      {
        visitIntent,
        payerType,
        paymentMethod,
        assignedClinician,
        billingPerson,
        dependentName,
        dependentRelationship,
        dependentPhone,
        registrationSource,
        registrationAt,
        performedBy,
      },
      medplum,
      clinicId
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'POST /api/check-in');
  }
}
