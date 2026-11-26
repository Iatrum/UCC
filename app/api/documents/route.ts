import { NextRequest, NextResponse } from 'next/server';
import { createPatientDocument, deletePatientDocument, listPatientDocuments, updatePatientDocument } from '@/lib/fhir/document-service';
import { assertStoredResourceInClinic } from '@/lib/fhir/write-containment';
import { getPatientFromMedplum } from '@/lib/fhir/patient-service';
import { getCurrentProfile, requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';
import { isSafeFhirId } from '@/lib/server/clinic-id';
import { STORAGE_PATH_EXTENSION_URL } from '@/lib/fhir/structure-definitions';
import { isPatientDocumentStoragePath } from '@/lib/fhir/document-storage-path';

export const runtime = 'nodejs';

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'document.pdf';
}

function storageDownloadUrl(bucketName: string, path: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

function profileDisplayName(profile: any): string | undefined {
  return profile?.name?.[0]?.text || profile?.telecom?.find((item: any) => item.system === 'email')?.value || profile?.id;
}

function provenancePractitionerId(profile: any): string | undefined {
  if (profile?.resourceType !== 'Practitioner' || !profile.id || profile.id === 'local-auth-bypass') {
    return undefined;
  }
  return profile.id;
}

export async function GET(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('patientId');
    if (!patientId) {
      return NextResponse.json({ error: 'Missing patientId' }, { status: 400 });
    }

    if (!isSafeFhirId(patientId)) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    const patient = await getPatientFromMedplum(patientId, clinicId, medplum, { includeMedicalHistory: false });
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    try {
      const documents = await listPatientDocuments(medplum, patientId, clinicId);
      return NextResponse.json({ success: true, documents });
    } catch {
      console.warn('[GET /api/documents] Document metadata search failed');
      return NextResponse.json({ error: 'Uploaded files are temporarily unavailable. Please try again.' }, { status: 503 });
    }
  } catch (error) {
    return handleRouteError(error, 'GET /api/documents');
  }
}

export async function POST(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    const profile = await getCurrentProfile(request).catch(() => null);
    const contentTypeHeader = request.headers.get('content-type') || '';
    const uploadedBy = profileDisplayName(profile);
    const practitionerId = provenancePractitionerId(profile);

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

      const bucket = await import('@/lib/firebase-admin')
        .then(({ getAdminStorageBucket }) => getAdminStorageBucket())
        .catch(() => null);
      if (!bucket) {
        console.warn('[POST /api/documents] Firebase Storage initialization failed');
        return NextResponse.json({ error: 'File uploads are temporarily unavailable.' }, { status: 503 });
      }
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
          uploadedBy,
          practitionerId,
          clinicId,
          storagePath,
        });
        documents.push({ id, title: file.name, url, contentType: file.type, size: file.size, storagePath });
      }

      return NextResponse.json({ success: true, documents });
    }

    const body = await request.json();
    const { patientId, title, url, contentType, size, uploadedBy: bodyUploadedBy, storagePath } = body || {};

    if (!patientId || !title || !url || !contentType) {
      return NextResponse.json({ error: 'Missing required fields: patientId, title, url, contentType' }, { status: 400 });
    }

    // Task 797: the path is later deleted with the Admin SDK, so a client may only name a file in this patient's folder.
    if (storagePath !== undefined && storagePath !== null && !isPatientDocumentStoragePath(String(patientId), storagePath)) {
      return NextResponse.json({ error: 'Invalid storagePath' }, { status: 400 });
    }

    const patient = await getPatientFromMedplum(patientId, clinicId, medplum);
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const id = await createPatientDocument(medplum, {
      patientId,
      title,
      url,
      contentType,
      size,
      uploadedBy: bodyUploadedBy || uploadedBy,
      practitionerId,
      clinicId,
      storagePath,
    });
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

    const doc = await medplum.readResource('DocumentReference', id, { cache: 'no-cache', headers: { 'X-Medplum': 'extended' } }).catch(() => null);
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

    await updatePatientDocument(medplum, id, { title, clinicId });
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

    // Authorize the stored ownership BEFORE the irreversible Storage delete.
    await assertStoredResourceInClinic(medplum, doc as any, clinicId, 'Document');

    const storagePath = (doc as any).extension?.find((ext: any) => ext.url === STORAGE_PATH_EXTENSION_URL)?.valueString;
    // Defence in depth (Task 797): records saved before the POST check may carry a foreign path; never delete outside this patient's folder.
    if (storagePath && !isPatientDocumentStoragePath(patientId, storagePath)) {
      console.warn('Refusing to delete a Storage object outside the patient documents folder; removing DocumentReference only.');
    } else if (storagePath) {
      try {
        const { getAdminStorageBucket } = await import('@/lib/firebase-admin');
        await getAdminStorageBucket().file(storagePath).delete({ ignoreNotFound: true });
      } catch {
        console.warn('Failed to delete Firebase Storage object for document; removing DocumentReference anyway.');
      }
    }

    await deletePatientDocument(medplum, id, clinicId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/documents');
  }
}
