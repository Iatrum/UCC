/**
 * Shared HTTP hardening for device-key ingress routes (POCT analysers, X-ray devices; Task 690).
 *
 * - `guardIngressRequest`: per-IP rate limit and Content-Length cap BEFORE any Medplum call.
 * - `readJsonBody`: streams the body with a hard byte cap (a lying/absent Content-Length cannot bypass it).
 * - `ingressErrorResponse`: fixed client messages; never `error.message` of an unexpected error.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isRateLimited } from '@/lib/rate-limit';
import { AuthError, ConflictError, ForbiddenError, NotFoundError } from '@/lib/server/route-helpers';

/** Largest legitimate payload is a multi-series imaging study or a full analyser panel. */
export const INGRESS_MAX_BODY_BYTES = 256 * 1024;
const INGRESS_MAX_PER_MINUTE = 120;

export class PayloadTooLargeError extends Error {}
export class InvalidBodyError extends Error {}

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

/** Returns a response to send immediately (429/413), or null to continue. */
export function guardIngressRequest(request: NextRequest, scope: string, maxBytes = INGRESS_MAX_BODY_BYTES): NextResponse | null {
  if (isRateLimited(`ingress:${scope}:${clientIp(request)}`, INGRESS_MAX_PER_MINUTE, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '60' } });
  }
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  }
  return null;
}

/**
 * Reads and parses a JSON body with a byte cap. Throws PayloadTooLargeError (413).
 * Returns `null` for an empty/invalid JSON body so callers can still authenticate first (401 before 400).
 */
export async function readJsonBody(request: NextRequest, maxBytes = INGRESS_MAX_BODY_BYTES): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLargeError('Request body too large');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/** Plain JSON object (not null/array), else null. */
export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Maps known error classes to their status. Anything else is a generic 500 (logged server-side only):
 * `error.message` of an unexpected error can carry Medplum URLs, resource ids or stack-adjacent text.
 */
export function ingressErrorResponse(error: unknown, context: string, fallbackMessage: string, fallbackStatus = 500): NextResponse {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof PayloadTooLargeError) return NextResponse.json({ error: 'Request body too large' }, { status: 413 });
  if (error instanceof InvalidBodyError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof NotFoundError) return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof ConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  console.error(`[${context}]`, error instanceof Error ? error.message : 'unknown error');
  return NextResponse.json({ error: fallbackMessage }, { status: fallbackStatus });
}

const MAX_SERIES = 200;
const MAX_UID = 128;

/** Shape check for the device-supplied study (serviceRequestId + study.studyUid + series[]); returns an error message or null. */
export function validateStudyPayload(serviceRequestId: unknown, study: unknown): string | null {
  if (typeof serviceRequestId !== 'string' || !serviceRequestId.trim() || serviceRequestId.length > 64) {
    return 'serviceRequestId is required';
  }
  const s = asObject(study);
  if (!s) return 'study data is required';
  if (typeof s.studyUid !== 'string' || !s.studyUid.trim() || s.studyUid.length > MAX_UID) {
    return 'study.studyUid is required';
  }
  if (!Array.isArray(s.series) || s.series.length > MAX_SERIES || s.series.some((x) => !asObject(x))) {
    return `study.series must be an array of at most ${MAX_SERIES} objects`;
  }
  return null;
}

/** Free-text report fields: strings only, bounded. */
export function validateReportText(findings: unknown, impression: unknown, radiologist: unknown): string | null {
  if (typeof findings !== 'string' || !findings.trim() || typeof impression !== 'string' || !impression.trim()) {
    return 'findings and impression are required';
  }
  if (findings.length > 50_000 || impression.length > 50_000) return 'findings and impression must be at most 50000 characters';
  if (radiologist !== undefined && (typeof radiologist !== 'string' || radiologist.length > 200)) {
    return 'radiologist must be a string of at most 200 characters';
  }
  return null;
}
