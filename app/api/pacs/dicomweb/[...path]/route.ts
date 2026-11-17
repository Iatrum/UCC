/**
 * GET /api/pacs/dicomweb/...  - read-only, study-scoped DICOMweb proxy for the viewer (X-ray phase 3).
 *
 * Reached only through the viewer origin's /dicom-web/. Authorised by the HttpOnly viewer session
 * cookie (one clinic, one StudyInstanceUID, ~15 min) AND the clinic's `pacs` toggle being ON (re-checked, 5 s cache). Any path outside that study is refused, QIDO
 * searches are forced to that study, and Orthanc's credentials are added here, server-side.
 */
import { NextRequest } from 'next/server';
import { fetchDicomweb, getPacsConfig, pacsServesClinic, PacsUpstreamError } from '@/lib/pacs/orthanc-client';
import { isPacsEnabledForViewer } from '@/lib/pacs/viewer-guard';
import { readViewerSessions, scopeDicomwebRequest } from '@/lib/pacs/viewer-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BASE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const refuse = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), { status, headers: { ...BASE, 'Content-Type': 'application/json' } });

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const config = getPacsConfig();
  if (!config) return refuse(503, 'PACS storage is not configured');
  if (request.headers.get('x-pacs-viewer-host') !== config.viewerHost) return refuse(404, 'Not found');

  const sessions = readViewerSessions(request.headers.get('cookie'), config.viewerSecret);
  if (!sessions.length) return refuse(401, 'Viewer session missing or expired');

  const { path } = await params;
  let upstreamPath: string | undefined;
  // A study-level search names its study in the query: try the session opened for that study first.
  const wanted = request.nextUrl.searchParams.get('StudyInstanceUID');
  sessions.sort((a, b) => Number(b.studyUid === wanted) - Number(a.studyUid === wanted));
  for (const claims of sessions) {
    if (!pacsServesClinic(config, claims.clinicId) || !(await isPacsEnabledForViewer(claims.clinicId))) continue;
    upstreamPath = scopeDicomwebRequest(path, request.nextUrl.searchParams, claims.studyUid);
    if (upstreamPath) break;
  }
  if (!upstreamPath) return refuse(403, 'Outside the study this viewer session was opened for');

  try {
    const upstream = await fetchDicomweb(config, upstreamPath, request.headers.get('accept'));
    const headers = new Headers(BASE);
    const type = upstream.headers.get('content-type');
    if (type) headers.set('Content-Type', type);
    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (error) {
    if (error instanceof PacsUpstreamError) return refuse(502, 'PACS storage is unavailable');
    throw error;
  }
}
