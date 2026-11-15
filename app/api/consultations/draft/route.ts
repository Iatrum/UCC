import { NextRequest, NextResponse } from 'next/server';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { ConflictError, handleRouteError } from '@/lib/server/route-helpers';
import { draftScope, readDraft, writeDraft, draftValue, clearDraft } from '@/lib/fhir/consultation-draft';

export async function GET(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const patientId = new URL(request.url).searchParams.get('patientId') || '';
    const doc = await readDraft(await draftScope(medplum, clinicId, patientId, 'consult-note'));
    return NextResponse.json({ success: true, version: doc?.meta?.versionId || null,
      draft: draftValue(doc, { clinicalNotes: '', diagnosis: '' }),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return handleRouteError(error, 'GET consultation draft'); }
}
export async function POST(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const body = await request.json();
    if (typeof body.clinicalNotes !== 'string' || typeof body.diagnosis !== 'string' ||
        body.clinicalNotes.length > 200000 || body.diagnosis.length > 10000) {
      return NextResponse.json({ error: 'Invalid draft' }, { status: 400 });
    }
    const scope = await draftScope(medplum, clinicId, body.patientId, 'consult-note');
    const existing = await readDraft(scope);
    if ((existing?.meta?.versionId || null) !== body.version) {
      throw new ConflictError('Draft changed in another window. Reload before editing.');
    }
    const doc = await writeDraft(scope, { clinicalNotes: body.clinicalNotes, diagnosis: body.diagnosis }, existing);
    return NextResponse.json({ success: true, version: doc.meta?.versionId });
  } catch (error) { return handleRouteError(error, 'POST consultation draft'); }
}
export async function DELETE(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const body = await request.json();
    if (!body.version) return NextResponse.json({ error: 'version required' }, { status: 400 });
    const cleared = await clearDraft(await draftScope(medplum, clinicId, body.patientId, 'consult-note'), body.version);
    return NextResponse.json({ success: true, version: cleared?.meta?.versionId || null });
  } catch (error) { return handleRouteError(error, 'DELETE consultation draft'); }
}
