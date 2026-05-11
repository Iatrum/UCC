import { NextRequest, NextResponse } from 'next/server';
import { createPatientDocument, deletePatientDocument, listPatientDocuments, updatePatientDocument } from '@/lib/fhir/document-service';
import { getPatientFromMedplum } from '@/lib/fhir/patient-service';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';
import { getAdminStorageBucket } from '@/lib/firebase-admin';
import { STORAGE_PATH_EXTENSION_URL } from '@/lib/fhir/structure-definitions';

export const runtime = 'nodejs';

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'document.pdf';
}

function storageDownloadUrl(bucketName: string, path: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

export async function GET(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');
    if (!patientId) {
      return NextResponse.json({ error: 'Missing patientId' }, { status: 400 });
    }

    const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const docs = await listPatientDocuments(medplum, patientId);
    return NextResponse.json({ success: true, documents: docs });
  } catch (error) {
    return handleRouteError(error, 'GET /api/documents');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const contentTypeHeader = request.headers.get('content-type') || '';

    if (contentTypeHeader.includes('multipart/form-data')) {
      const form = await request.formData();
      const patientId = String(form.get('patientId') || '');
      const files = form.getAll('files').filter((item): item is File => item instanceof File);

      if (!patientId || files.length === 0) {
        return NextResponse.json({ error: 'Missing required fields: patientId and files' }, { status: 400 });
      }

      const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
      if (!patient) {
        return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
      }

      const bucket = getAdminStorageBucket();
      const documents = [];

      for (const file of files) {
        if (file.type !== 'application/pdf') {
          return NextResponse.json({ error: `${file.name} is not a PDF` }, { status: 400 });
        }

        const storagePath = `patients/${patientId}/documents/${Date.now()}-${crypto.randomUUID()}-${safeFileName(file.name)}`;
        const token = crypto.randomUUID();
        const buffer = Buffer.from(await file.arrayBuffer());
        const bucketFile = bucket.file(storagePath);

        await bucketFile.save(buffer, {
          contentType: file.type,
          resumable: false,
          metadata: {
            metadata: {
              firebaseStorageDownloadTokens: token,
            },
          },
        });

        const url = storageDownloadUrl(bucket.name, storagePath, token);
        const id = await createPatientDocument(medplum, {
          patientId,
          title: file.name,
          url,
          contentType: file.type,
          size: file.size,
          storagePath,
        });
        documents.push({ id, title: file.name, url, contentType: file.type, size: file.size, storagePath });
      }

      return NextResponse.json({ success: true, documents });
    }

    const body = await request.json();
    const { patientId, title, url, contentType, size, uploadedBy, storagePath } = body || {};

    if (!patientId || !title || !url || !contentType) {
      return NextResponse.json({ error: 'Missing required fields: patientId, title, url, contentType' }, { status: 400 });
    }

    const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const id = await createPatientDocument(medplum, { patientId, title, url, contentType, size, uploadedBy, storagePath });
    return NextResponse.json({ success: true, id });
  } catch (error) {
    return handleRouteError(error, 'POST /api/documents');
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const body = await request.json();
    const { id, title } = body || {};
    if (!id) {
      return NextResponse.json({ error: 'Missing document id' }, { status: 400 });
    }

    const doc = await medplum.readResource('DocumentReference', id).catch(() => null);
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    const patientId = (doc as any).subject?.reference?.replace('Patient/', '');
    if (!patientId) {
      return NextResponse.json({ error: 'Document has no patient reference' }, { status: 400 });
    }
    const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
    if (!patient) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    await updatePatientDocument(medplum, id, { title });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/documents');
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const body = await request.json();
    const { id } = body || {};
    if (!id) {
      return NextResponse.json({ error: 'Missing document id' }, { status: 400 });
    }

    const doc = await medplum.readResource('DocumentReference', id).catch(() => null);
    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }
    const patientId = (doc as any).subject?.reference?.replace('Patient/', '');
    if (!patientId) {
      return NextResponse.json({ error: 'Document has no patient reference' }, { status: 400 });
    }
    const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
    if (!patient) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const storagePath = (doc as any).extension?.find((ext: any) => ext.url === STORAGE_PATH_EXTENSION_URL)?.valueString;
    if (storagePath) {
      try {
        await getAdminStorageBucket().file(storagePath).delete({ ignoreNotFound: true });
      } catch (error) {
        console.warn('Failed to delete Firebase Storage object for document; removing DocumentReference anyway.', error);
      }
    }

    await deletePatientDocument(medplum, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/documents');
  }
}
