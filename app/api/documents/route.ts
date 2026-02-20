import { NextRequest, NextResponse } from 'next/server';
import { createPatientDocument, deletePatientDocument, listPatientDocuments } from '@/lib/fhir/document-service';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');
    if (!patientId) {
      return NextResponse.json({ error: 'Missing patientId' }, { status: 400 });
    }

    const docs = await listPatientDocuments(patientId);
    return NextResponse.json({ success: true, documents: docs });
  } catch (error: any) {
    console.error('Failed to list documents:', error);
    return NextResponse.json({ error: error?.message || 'Failed to list documents' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { patientId, title, url, contentType, size, uploadedBy, storagePath } = body || {};

    if (!patientId || !title || !url || !contentType) {
      return NextResponse.json({ error: 'Missing required fields: patientId, title, url, contentType' }, { status: 400 });
    }

    const id = await createPatientDocument({
      patientId,
      title,
      url,
      contentType,
      size,
      uploadedBy,
      storagePath,
    });

    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    console.error('Failed to save document:', error);
    return NextResponse.json({ error: error?.message || 'Failed to save document' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body || {};
    if (!id) {
      return NextResponse.json({ error: 'Missing document id' }, { status: 400 });
    }

    await deletePatientDocument(id);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to delete document:', error);
    return NextResponse.json({ error: error?.message || 'Failed to delete document' }, { status: 500 });
  }
}
