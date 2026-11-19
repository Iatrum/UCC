/**
 * API endpoint to register FHIR StructureDefinitions
 *
 * POST /api/fhir/register-extensions
 *
 * Registers custom extensions (storage-path, triage) in Medplum using the service account.
 * Safe to call multiple times - checks if already registered.
 *
 * Task 645: platform-admin only (was unauthenticated and echoed error details). Task 720: GET no longer
 * runs the registration (a GET with side effects is CSRF-able via top-level navigation under SameSite=Lax).
 */

import { NextRequest, NextResponse } from 'next/server';
import { initializeFhirExtensions } from '@/lib/fhir/register-extensions';
import { requirePlatformAdmin } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    await requirePlatformAdmin(request);
    await initializeFhirExtensions();
    return NextResponse.json({
      success: true,
      message: 'StructureDefinitions registered successfully',
    });
  } catch (error) {
    return handleRouteError(error, 'POST /api/fhir/register-extensions');
  }
}

export async function GET() {
  return NextResponse.json({ error: 'Use POST' }, { status: 405, headers: { Allow: 'POST' } });
}
