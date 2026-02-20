/**
 * Patient API - FHIR via Medplum
 * Replaces Firebase as source of truth
 */

import { NextRequest, NextResponse } from 'next/server';
import { getClinicIdFromRequest } from '@/lib/server/clinic';
import {
  savePatientToMedplum,
  getPatientFromMedplum,
  getAllPatientsFromMedplum,
  searchPatientsInMedplum,
  updatePatientInMedplum,
} from '@/lib/fhir/patient-service';

/**
 * POST - Create a new patient in Medplum
 */
export async function POST(request: NextRequest) {
  try {
    const patientData = await request.json();
    let clinicId = await getClinicIdFromRequest(request);

    // For development/localhost, use default clinic ID if not provided
    if (!clinicId && process.env.NODE_ENV !== 'production') {
      clinicId = process.env.NEXT_PUBLIC_DEFAULT_CLINIC_ID || 'default';
      console.warn('⚠️  No clinicId found, using default for development:', clinicId);
    }

    const identifierValue = patientData.identifierValue ?? patientData.nric;
    // Validate required fields
    if (!patientData.fullName || !identifierValue || !patientData.dateOfBirth || !patientData.gender) {
      return NextResponse.json(
        { error: 'Missing required fields: fullName, identifierValue, dateOfBirth, gender' },
        { status: 400 }
      );
    }

    if (!clinicId) {
      return NextResponse.json({ 
        success: false,
        error: 'Missing clinicId. Please set NEXT_PUBLIC_DEFAULT_CLINIC_ID for development or access via clinic subdomain.' 
      }, { status: 400 });
    }

    const patientId = await savePatientToMedplum(patientData, clinicId);

    return NextResponse.json({
      success: true,
      patientId,
      message: 'Patient saved to FHIR successfully',
    });
  } catch (error: any) {
    console.error('❌ Failed to save patient:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to save patient',
      },
      { status: 500 }
    );
  }
}

/**
 * GET - Get patients
 * Query params:
 * - id: Get specific patient by ID
 * - search: Search patients by name/NRIC
 * - limit: Get all patients (default 100)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('id');
    const searchQuery = searchParams.get('search');
    const limit = searchParams.get('limit');
    let clinicId = await getClinicIdFromRequest(request);

    // For development/localhost, use default clinic ID if not provided
    if (!clinicId && process.env.NODE_ENV !== 'production') {
      clinicId = process.env.NEXT_PUBLIC_DEFAULT_CLINIC_ID || 'default';
      console.warn('⚠️  No clinicId found, using default for development:', clinicId);
    }

    if (!clinicId) {
      console.error('❌ Missing clinicId in request:', {
        headers: Object.fromEntries(request.headers.entries()),
        url: request.url,
      });
      return NextResponse.json({ 
        success: false,
        error: 'Missing clinicId. Please ensure you are accessing the application via a clinic subdomain or set NEXT_PUBLIC_DEFAULT_CLINIC_ID for development.' 
      }, { status: 400 });
    }

    // Get specific patient
    if (patientId) {
      const patient = await getPatientFromMedplum(patientId, clinicId);
      if (!patient) {
        return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true, patient });
    }

    // Search patients
    if (searchQuery) {
      const patients = await searchPatientsInMedplum(searchQuery, clinicId);
      return NextResponse.json({
        success: true,
        count: patients.length,
        patients,
      });
    }

    // Get all patients
    const limitNum = limit ? parseInt(limit) : 100;
    const patients = await getAllPatientsFromMedplum(limitNum, clinicId);
    return NextResponse.json({
      success: true,
      count: patients.length,
      patients,
    });
  } catch (error: any) {
    console.error('❌ Failed to get patients:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to get patients',
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH - Update a patient
 */
export async function PATCH(request: NextRequest) {
  try {
    const { patientId, ...updates } = await request.json();
    let clinicId = await getClinicIdFromRequest(request);

    // For development/localhost, use default clinic ID if not provided
    if (!clinicId && process.env.NODE_ENV !== 'production') {
      clinicId = process.env.NEXT_PUBLIC_DEFAULT_CLINIC_ID || 'default';
      console.warn('⚠️  No clinicId found, using default for development:', clinicId);
    }

    if (!patientId) {
      return NextResponse.json({ error: 'Missing patientId' }, { status: 400 });
    }

    if (!clinicId) {
      return NextResponse.json({ 
        success: false,
        error: 'Missing clinicId. Please set NEXT_PUBLIC_DEFAULT_CLINIC_ID for development or access via clinic subdomain.' 
      }, { status: 400 });
    }

    await updatePatientInMedplum(patientId, updates, clinicId);

    return NextResponse.json({
      success: true,
      message: 'Patient updated successfully',
    });
  } catch (error: any) {
    console.error('❌ Failed to update patient:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to update patient',
      },
      { status: 500 }
    );
  }
}





