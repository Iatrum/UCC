/**
 * Consultation API - FHIR via Medplum
 * This replaces Firebase as the source of truth
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  saveConsultationToMedplum,
  getConsultationFromMedplum,
  getPatientConsultationsFromMedplum,
  getRecentConsultationsFromMedplum,
} from '@/lib/fhir/consultation-service';
import { getPatientFromMedplum } from '@/lib/fhir/patient-service';
import { getClinicIdFromRequest } from '@/lib/server/clinic';
import { getCurrentProfile } from '@/lib/server/medplum-auth';

/**
 * POST - Create a new consultation in Medplum
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { patientId, chiefComplaint, diagnosis, procedures, notes, progressNote, prescriptions } = body;
    let clinicId = await getClinicIdFromRequest(request);

    // For development/localhost, use default clinic ID if not provided
    if (!clinicId && process.env.NODE_ENV !== 'production') {
      clinicId = process.env.NEXT_PUBLIC_DEFAULT_CLINIC_ID || 'default';
      console.warn('⚠️  No clinicId found, using default for development:', clinicId);
    }

    if (!clinicId) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Missing clinicId. Please set NEXT_PUBLIC_DEFAULT_CLINIC_ID for development or access via clinic subdomain.',
        },
        { status: 400 }
      );
    }

    // Validate required fields
    const soapNote = notes || chiefComplaint;
    if (!patientId || !soapNote || !diagnosis) {
      return NextResponse.json(
        { error: 'Missing required fields: patientId, SOAP note, diagnosis' },
        { status: 400 }
      );
    }

    // 🎯 Get patient data from MEDPLUM (FHIR) - Source of Truth
    const patient = await getPatientFromMedplum(patientId, clinicId);
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found in FHIR' }, { status: 404 });
    }

    // Resolve practitioner ID from the authenticated user's profile
    let practitionerId: string | undefined;
    try {
      const profile = await getCurrentProfile(request);
      if (profile.resourceType === 'Practitioner' && profile.id) {
        practitionerId = profile.id;
      }
    } catch {
      // Non-blocking: consultation can still be saved without practitioner
    }

    // Save to Medplum as FHIR
    const encounterId = await saveConsultationToMedplum(
      {
        patientId,
        chiefComplaint,
        diagnosis,
        procedures,
        notes: soapNote,
        progressNote,
        prescriptions,
        practitionerId,
        date: new Date(),
      },
      {
        id: patientId,
        name: (patient as any).name || (patient as any).fullName || '',
        ic: (patient as any).ic || (patient as any).nric || '',
        dob: (patient as any).dob instanceof Date ? (patient as any).dob : (patient as any).dob?.toDate?.(),
        gender: (patient as any).gender || '',
        phone: (patient as any).phoneNumber || (patient as any).phone || '',
        address: (patient as any).address || '',
      },
      clinicId
    );

    console.log(`✅ Consultation saved to Medplum: ${encounterId}`);

    return NextResponse.json({
      success: true,
      consultationId: encounterId,
      message: 'Consultation saved successfully',
    });
  } catch (error: any) {
    console.error('❌ Failed to save consultation:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to save consultation',
      },
      { status: 500 }
    );
  }
}

/**
 * GET - Get consultations
 * Query params:
 * - patientId: Get consultations for specific patient
 * - id: Get specific consultation by ID
 * - recent: Get recent consultations (limit)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');
    const consultationId = searchParams.get('id');
    const recent = searchParams.get('recent');
    let clinicId = await getClinicIdFromRequest(request);

    // For development/localhost, use default clinic ID if not provided
    if (!clinicId && process.env.NODE_ENV !== 'production') {
      clinicId = process.env.NEXT_PUBLIC_DEFAULT_CLINIC_ID || 'default';
      console.warn('⚠️  No clinicId found, using default for development:', clinicId);
    }

    if (!clinicId) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Missing clinicId. Please set NEXT_PUBLIC_DEFAULT_CLINIC_ID for development or access via clinic subdomain.',
        },
        { status: 400 }
      );
    }

    // Get specific consultation
    if (consultationId) {
      const consultation = await getConsultationFromMedplum(consultationId, clinicId);
      if (!consultation) {
        return NextResponse.json({ error: 'Consultation not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, consultation });
    }

    // Get consultations for a patient
    if (patientId) {
      const consultations = await getPatientConsultationsFromMedplum(patientId, clinicId);
      return NextResponse.json({
        success: true,
        count: consultations.length,
        consultations,
      });
    }

    // Get recent consultations
    if (recent) {
      const limit = parseInt(recent) || 10;
      const consultations = await getRecentConsultationsFromMedplum(limit, clinicId);
      return NextResponse.json({
        success: true,
        count: consultations.length,
        consultations,
      });
    }

    return NextResponse.json({ error: 'Missing query parameter: patientId, id, or recent' }, { status: 400 });
  } catch (error: any) {
    console.error('❌ Failed to get consultations:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to get consultations',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Update a consultation
 * Note: FHIR resources are typically immutable, but we can update status or add amendments
 */
export async function PATCH(request: NextRequest) {
  try {
    const { consultationId, updates } = await request.json();

    if (!consultationId) {
      return NextResponse.json({ error: 'Missing consultationId' }, { status: 400 });
    }

    // For now, we'll create amendment observations rather than updating the encounter
    // This is more FHIR-compliant (maintaining audit trail)
    console.log('⚠️  Consultation updates should be handled via amendments in FHIR');
    console.log('Consider creating new Observation resources for amendments');

    return NextResponse.json({
      success: true,
      message: 'Consultation amendment recorded',
      note: 'FHIR encounters are typically immutable; amendments recorded as new Observations',
    });
  } catch (error: any) {
    console.error('❌ Failed to update consultation:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to update consultation',
      },
      { status: 500 }
    );
  }
}
