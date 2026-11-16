import { NextRequest, NextResponse } from 'next/server';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';
import { getPatientFromMedplum } from '@/lib/fhir/patient-service';
import { belongsToClinic, ISSUED_DOCUMENT_SYSTEM } from '@/lib/fhir/issued-document-service';

export async function GET(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const params = request.nextUrl.searchParams;
    const id = params.get('id');
    if (id) {
      const matches = await medplum.searchResources('DocumentReference', { _id: id, identifier: `clinic|${clinicId}`, _count: '1' });
      const doc = matches[0];
      if (!doc || !belongsToClinic(doc, clinicId) || !doc.identifier?.some(i => i.system === ISSUED_DOCUMENT_SYSTEM)) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      }
      const patientId = doc.subject?.reference?.replace(/^Patient\//, '');
      if (!patientId || !await getPatientFromMedplum(patientId, clinicId, medplum)) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
      const attachment = doc.content[0]?.attachment;
      if (!attachment?.data || attachment.contentType !== 'text/html') return NextResponse.json({ error: 'Document content unavailable' }, { status: 404 });
      return new NextResponse(Buffer.from(attachment.data, 'base64').toString('utf8'), { headers: {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox allow-modals",
        'X-Content-Type-Options': 'nosniff',
      } });
    }
    const patientId = params.get('patientId');
    if (!patientId) return NextResponse.json({ error: 'patientId is required' }, { status: 400 });
    if (!await getPatientFromMedplum(patientId, clinicId, medplum)) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    const docs = await medplum.searchResources('DocumentReference', { subject: `Patient/${patientId}`, identifier: `clinic|${clinicId}`, _sort: '-date', _count: '1000' });
    return NextResponse.json({ documents: docs.filter(d => belongsToClinic(d, clinicId) && d.identifier?.some(i => i.system === ISSUED_DOCUMENT_SYSTEM)).map(d => ({ id: d.id, title: d.content[0]?.attachment.title || d.type?.text, date: d.date, status: d.docStatus, encounter: d.context?.encounter?.[0]?.reference })) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return handleRouteError(error, 'GET /api/issued-documents'); }
}
