/**
 * Signed, short-lived tokens for the DICOM viewer (X-ray phase 3). Pure: no Next/Medplum imports.
 *
 * Two kinds, both HMAC-SHA256 over a JSON payload and both bound to ONE clinic and ONE study:
 *  - `launch`  : single-use, ~60 s. Travels once in the viewer URL (/launch?t=...).
 *  - `session` : ~15 min. Lives only in an HttpOnly cookie on the viewer origin; authorises the
 *                read-only DICOMweb proxy for that one StudyInstanceUID.
 * The kinds use different derived keys, so one can never be replayed as the other.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const LAUNCH_TTL_SECONDS = 60;
export const SESSION_TTL_SECONDS = 15 * 60;
/** One cookie per open study (`ucc_pacs_viewer_<hash>`), so two studies can be open in two tabs. */
export const VIEWER_COOKIE = 'ucc_pacs_viewer';
/** The cookie is only ever sent to the DICOMweb proxy path on the viewer origin. */
export const VIEWER_COOKIE_PATH = '/dicom-web';

export type ViewerTokenKind = 'launch' | 'session';

export interface ViewerClaims {
  kind: ViewerTokenKind;
  clinicId: string;
  studyUid: string;
  /** Expiry, epoch seconds. */
  exp: number;
  /** Unique id; single-use enforcement for launch tokens. */
  jti: string;
}

const DICOM_UID = /^[0-9]+(\.[0-9]+)*$/;
export function isDicomUid(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && DICOM_UID.test(value);
}

function keyFor(secret: string, kind: ViewerTokenKind): Buffer {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('PACS viewer secret must be at least 32 characters');
  return createHmac('sha256', secret).update(`ucc-pacs-viewer:${kind}:v1`).digest();
}

function sign(body: string, secret: string, kind: ViewerTokenKind): string {
  return createHmac('sha256', keyFor(secret, kind)).update(body).digest('base64url');
}

export function mintViewerToken(
  input: { kind: ViewerTokenKind; clinicId: string; studyUid: string },
  secret: string,
  nowMs = Date.now()
): string {
  if (!input.clinicId || !isDicomUid(input.studyUid)) throw new Error('Invalid viewer token claims');
  const ttl = input.kind === 'launch' ? LAUNCH_TTL_SECONDS : SESSION_TTL_SECONDS;
  const claims: ViewerClaims = {
    kind: input.kind, clinicId: input.clinicId, studyUid: input.studyUid,
    exp: Math.floor(nowMs / 1000) + ttl, jti: randomBytes(16).toString('base64url'),
  };
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${sign(body, secret, input.kind)}`;
}

/** Returns the claims only for a well-formed, correctly signed, unexpired token of the expected kind. */
export function verifyViewerToken(
  token: unknown,
  kind: ViewerTokenKind,
  secret: string,
  nowMs = Date.now()
): ViewerClaims | undefined {
  if (typeof token !== 'string' || token.length > 1024) return undefined;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return undefined;
  let expected: Buffer;
  try {
    expected = Buffer.from(sign(parts[0], secret, kind));
  } catch {
    return undefined;
  }
  const given = Buffer.from(parts[1]);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as ViewerClaims;
    if (claims.kind !== kind || typeof claims.clinicId !== 'string' || !claims.clinicId) return undefined;
    if (!isDicomUid(claims.studyUid) || typeof claims.jti !== 'string' || !claims.jti) return undefined;
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs) return undefined;
    return claims;
  } catch {
    return undefined;
  }
}

/**
 * Single-use guard for launch tokens. In-memory (per server process): with several app instances a
 * token could be redeemed once per instance within its 60 s life; see .ai/PLAN-xray-phase3.md.
 */
const usedLaunchTokens: Map<string, number> =
  ((globalThis as Record<string, unknown>).__uccPacsUsedLaunch as Map<string, number> | undefined) ??
  ((globalThis as Record<string, unknown>).__uccPacsUsedLaunch = new Map<string, number>()) as Map<string, number>;

export function consumeLaunchToken(claims: ViewerClaims, nowMs = Date.now()): boolean {
  for (const [jti, expMs] of usedLaunchTokens) if (expMs <= nowMs) usedLaunchTokens.delete(jti);
  if (usedLaunchTokens.has(claims.jti)) return false;
  usedLaunchTokens.set(claims.jti, claims.exp * 1000);
  return true;
}

export function viewerCookieName(studyUid: string): string {
  return `${VIEWER_COOKIE}_${createHash('sha256').update(studyUid).digest('hex').slice(0, 16)}`;
}

/** Every valid, unexpired viewer session in a Cookie header (at most 8 are considered). */
export function readViewerSessions(cookieHeader: string | null | undefined, secret: string, nowMs = Date.now()): ViewerClaims[] {
  const sessions: ViewerClaims[] = [];
  for (const part of (cookieHeader || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || !part.slice(0, eq).trim().startsWith(`${VIEWER_COOKIE}_`)) continue;
    const claims = verifyViewerToken(part.slice(eq + 1).trim(), 'session', secret, nowMs);
    if (claims && viewerCookieName(claims.studyUid) === part.slice(0, eq).trim()) sessions.push(claims);
    if (sessions.length >= 8) break;
  }
  return sessions;
}

const SEGMENT = /^[A-Za-z0-9._-]{1,128}$/;
/** QIDO filters a caller may keep; the StudyInstanceUID filter is always forced to the token's study. */
const PASS_THROUGH_QUERY = new Set(['includefield', 'limit', 'offset', 'accept']);

/**
 * Map a viewer request (path segments after /dicom-web/ + query) to the upstream DICOMweb path, or
 * undefined when the request is outside the token's study. Only `studies...` is reachable:
 *  - `studies`                -> QIDO search forced to `StudyInstanceUID=<token study>`
 *  - `studies/<uid>[/...]`    -> only when <uid> is exactly the token's study
 */
export function scopeDicomwebRequest(
  segments: readonly string[],
  query: URLSearchParams,
  studyUid: string
): string | undefined {
  if (!isDicomUid(studyUid) || !segments.length || segments[0] !== 'studies') return undefined;
  if (!segments.every((s) => SEGMENT.test(s) && s !== '.' && s !== '..')) return undefined;
  const out = new URLSearchParams();
  for (const [key, value] of query) {
    if (PASS_THROUGH_QUERY.has(key.toLowerCase())) out.append(key, value);
  }
  if (segments.length === 1) {
    out.set('StudyInstanceUID', studyUid);
  } else if (segments[1] !== studyUid) {
    return undefined;
  }
  const qs = out.toString();
  return `${segments.join('/')}${qs ? `?${qs}` : ''}`;
}
