import { NextRequest, NextResponse } from 'next/server';
import { writeServerAuditLog } from '@/lib/server/logging';
import { getCurrentProfile, requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';

const MAX_FIELD = 200;
const MAX_METADATA_KEYS = 20;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_FIELD) : undefined;

/**
 * Task 645: the writer is the signed-in clinic user. The client cannot choose the actor
 * (`userId` in the body is ignored) and every entry is stamped with the caller's clinic.
 */
export async function POST(request: NextRequest) {
  try {
    const { clinicId } = await requireClinicAuth(request);
    const profile = await getCurrentProfile(request).catch(() => null);
    const entry = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const action = text(entry?.action);
    const subjectType = text(entry?.subjectType);
    if (!action || !subjectType) {
      return NextResponse.json({ error: 'action and subjectType are required' }, { status: 400 });
    }

    const metadata: Record<string, unknown> = {};
    if (entry?.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)) {
      for (const [key, value] of Object.entries(entry.metadata).slice(0, MAX_METADATA_KEYS)) {
        metadata[key.slice(0, 64)] = String(value).slice(0, MAX_FIELD);
      }
    }
    metadata.clinic = clinicId;

    await writeServerAuditLog({
      action,
      subjectType,
      subjectId: text(entry?.subjectId),
      userId: profile?.id ? `${profile.resourceType}/${profile.id}` : undefined,
      metadata,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'POST /api/audit-log');
  }
}
