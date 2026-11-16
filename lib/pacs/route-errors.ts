import { NextResponse } from 'next/server';
import { handleRouteError } from '@/lib/server/route-helpers';
import { PacsNotConfiguredError, PacsUpstreamError } from './orthanc-client';

/** PACS-specific failures first (503 not configured, 502 upstream), then the shared route mapping. */
export function handlePacsRouteError(error: unknown, context: string): NextResponse {
  if (error instanceof PacsNotConfiguredError) {
    return NextResponse.json({ error: 'PACS storage is not configured' }, { status: 503 });
  }
  if (error instanceof PacsUpstreamError) {
    console.warn(`[${context}] ${error.message}`);
    return NextResponse.json({ error: 'PACS storage is unavailable' }, { status: 502 });
  }
  return handleRouteError(error, context);
}
