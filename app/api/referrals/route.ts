/**
 * Referral API - FHIR via Medplum (ServiceRequest)
 *
 * All operations are scoped to the authenticated clinic via patient ownership.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  saveReferralToMedplum,
  getReferralFromMedplum,
  getPatientReferralsFromMedplum,
  updateReferralInMedplum,
  deleteReferralFromMedplum,
} from '@/lib/fhir/referral-service';
import { getPatientFromMedplum } from '@/lib/fhir/patient-service';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';

export async function POST(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const referralData = await request.json();

    if (!referralData.patientId || !referralData.specialty || !referralData.facility || !referralData.reason) {
      return NextResponse.json(
        { error: 'Missing required fields: patientId, specialty, facility, reason' },
        { status: 400 }
      );
    }

    const patient = await getPatientFromMedplum(referralData.patientId, clinicId, medplum);
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const referralId = await saveReferralToMedplum(medplum, referralData);
    return NextResponse.json({ success: true, referralId, message: 'Referral saved to FHIR successfully' });
  } catch (error) {
    return handleRouteError(error, 'POST /api/referrals');
  }
}

export async function GET(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const { searchParams } = new URL(request.url);
    const referralId = searchParams.get('id');
    const patientId = searchParams.get('patientId');

    if (referralId) {
      const referral = await getReferralFromMedplum(medplum, referralId);
      if (!referral) {
        return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
      }
      const patient = await getPatientFromMedplum(referral.patientId, clinicId, medplum);
      if (!patient) {
        return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, referral });
    }

    if (patientId) {
      const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
      if (!patient) {
        return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
      }
      const referrals = await getPatientReferralsFromMedplum(medplum, patientId);
      return NextResponse.json({ success: true, count: referrals.length, referrals });
    }

    return NextResponse.json({ error: 'Missing query parameter: id or patientId' }, { status: 400 });
  } catch (error) {
    return handleRouteError(error, 'GET /api/referrals');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const body = await request.json();
    const { referralId, ...updates } = body;

    if (!referralId) {
      return NextResponse.json({ error: 'Missing referralId' }, { status: 400 });
    }

    const referral = await getReferralFromMedplum(medplum, referralId);
    if (!referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }
    const patient = await getPatientFromMedplum(referral.patientId, clinicId, medplum);
    if (!patient) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }

    await updateReferralInMedplum(medplum, referralId, updates);
    return NextResponse.json({ success: true, message: 'Referral updated successfully' });
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/referrals');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const body = await request.json();
    const { referralId } = body;

    if (!referralId) {
      return NextResponse.json({ error: 'Missing referralId' }, { status: 400 });
    }

    const referral = await getReferralFromMedplum(medplum, referralId);
    if (!referral) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }
    const patient = await getPatientFromMedplum(referral.patientId, clinicId, medplum);
    if (!patient) {
      return NextResponse.json({ error: 'Referral not found' }, { status: 404 });
    }

    await deleteReferralFromMedplum(medplum, referralId);
    return NextResponse.json({ success: true, message: 'Referral deleted successfully' });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/referrals');
  }
}
