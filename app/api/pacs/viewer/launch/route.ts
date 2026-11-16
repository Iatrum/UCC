/**
 * GET /api/pacs/viewer/launch?t=<launch token>  - reached ONLY through the viewer origin's /launch.
 *
 * Redeems the single-use launch token and sets the study-scoped, HttpOnly viewer session cookie on
 * the viewer origin (Path=/dicom-web), then redirects to OHIF for that one study. No UCC session is
 * involved: the token is the capability, minted for a signed-in clinic user by /api/pacs/viewer/link.
 */
import { NextRequest } from 'next/server';
import { getPacsConfig, pacsServesClinic } from '@/lib/pacs/orthanc-client';
import {
  SESSION_TTL_SECONDS, VIEWER_COOKIE_PATH, consumeLaunchToken, mintViewerToken, verifyViewerToken, viewerCookieName,
} from '@/lib/pacs/viewer-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const refuse = (status: number, message: string) =>
  new Response(message, { status, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });

export async function GET(request: NextRequest) {
  const config = getPacsConfig();
  if (!config) return refuse(503, 'PACS storage is not configured');
  // Only the viewer's reverse proxy sets this header; on any other origin the cookie would be useless anyway.
  if (request.headers.get('x-pacs-viewer-host') !== config.viewerHost) return refuse(404, 'Not found');

  const claims = verifyViewerToken(request.nextUrl.searchParams.get('t'), 'launch', config.viewerSecret);
  if (!claims || !pacsServesClinic(config, claims.clinicId) || !consumeLaunchToken(claims)) return refuse(403, 'This viewer link has expired or was already used. Reopen the study from the patient record.');

  const session = mintViewerToken({ kind: 'session', clinicId: claims.clinicId, studyUid: claims.studyUid }, config.viewerSecret);
  const cookie = [
    `${viewerCookieName(claims.studyUid)}=${session}`, `Path=${VIEWER_COOKIE_PATH}`, `Max-Age=${SESSION_TTL_SECONDS}`,
    'HttpOnly', 'SameSite=Strict', ...(config.viewerSecure ? ['Secure'] : []),
  ].join('; ');
  return new Response(null, {
    status: 303,
    headers: { ...HEADERS, 'Set-Cookie': cookie, Location: `/viewer?StudyInstanceUIDs=${claims.studyUid}` },
  });
}
