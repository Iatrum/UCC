import { NextRequest, NextResponse } from 'next/server';
import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';
import { getTemplate, saveTemplate } from '@/lib/fhir/document-template-service';

export const runtime = 'nodejs';

function isValidType(value: unknown): value is 'mc' | 'referral' {
  return value === 'mc' || value === 'referral';
}

export async function GET(req: NextRequest) {
  try {
    const { clinicId } = await requireClinicAuth(req);
    const medplum = await getAdminMedplum();
    const type = req.nextUrl.searchParams.get('type');
    if (!isValidType(type)) {
      return NextResponse.json({ error: 'type must be mc or referral' }, { status: 400 });
    }
    const html = await getTemplate(type, clinicId, medplum);
    return NextResponse.json({ html });
  } catch (error) {
    return handleRouteError(error, 'GET /api/document-templates');
  }
}

export async function POST(req: NextRequest) {
  try {
    const { clinicId } = await requireClinicAuth(req);
    const medplum = await getAdminMedplum();
    const body = await req.json().catch(() => null);
    if (!body || !isValidType(body.type) || typeof body.html !== 'string' || !body.html.trim()) {
      return NextResponse.json({ error: 'type (mc|referral) and html are required' }, { status: 400 });
    }
    await saveTemplate(body.type, body.html, clinicId, medplum);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'POST /api/document-templates');
  }
}
