import { NextRequest, NextResponse } from 'next/server';
import { getAdminStorageBucket } from '@/lib/firebase-admin';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';

export const runtime = 'nodejs';

const MAX_LOGO_BYTES = 1024 * 1024;

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'logo';
}

function storageDownloadUrl(bucketName: string, path: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}

export async function POST(request: NextRequest) {
  try {
    await requireClinicAuth(request);

    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing logo file' }, { status: 400 });
    }

    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Logo must be an image file' }, { status: 400 });
    }

    if (file.size > MAX_LOGO_BYTES) {
      return NextResponse.json({ error: 'Logo must be 1MB or smaller' }, { status: 400 });
    }

    const bucket = getAdminStorageBucket();
    const storagePath = `branding/logo-${Date.now()}-${crypto.randomUUID()}-${safeFileName(file.name)}`;
    const token = crypto.randomUUID();
    const buffer = Buffer.from(await file.arrayBuffer());

    await bucket.file(storagePath).save(buffer, {
      contentType: file.type,
      resumable: false,
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    return NextResponse.json({
      success: true,
      url: storageDownloadUrl(bucket.name, storagePath, token),
      storagePath,
    });
  } catch (error) {
    return handleRouteError(error, 'POST /api/storage/logo');
  }
}
