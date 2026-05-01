import { NextRequest, NextResponse } from 'next/server';
import { writeServerAuditLog } from '@/lib/server/logging';
import { getMedplumForRequest } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';

export async function POST(request: NextRequest) {
  try {
    await getMedplumForRequest(request);
    const entry = await request.json();
    await writeServerAuditLog(entry);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleRouteError(error, 'POST /api/audit-log');
  }
}
