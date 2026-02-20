/**
 * API endpoint to register FHIR StructureDefinitions
 * 
 * POST /api/fhir/register-extensions
 * 
 * Registers custom extensions (storage-path, triage) in Medplum.
 * Safe to call multiple times - checks if already registered.
 */

import { NextRequest, NextResponse } from 'next/server';
import { initializeFhirExtensions } from '@/lib/fhir/register-extensions';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    await initializeFhirExtensions();
    return NextResponse.json({ 
      success: true, 
      message: 'StructureDefinitions registered successfully' 
    });
  } catch (error: any) {
    console.error('Failed to register extensions:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to register StructureDefinitions',
        details: error.message 
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  // Allow GET for easy testing
  return POST(request);
}

