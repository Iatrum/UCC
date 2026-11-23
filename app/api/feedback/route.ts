import { isIP } from 'node:net';
import { NextRequest, NextResponse } from 'next/server';
import { requireClinicAuth, getCurrentProfile } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';
import { asObject, PayloadTooLargeError, readJsonBody } from '@/lib/server/device-ingress-http';
import { isModuleEnabledForClinic } from '@/lib/module-registry';
import { isRateLimited } from '@/lib/rate-limit';
import { sanitizeFeedback } from '@/lib/feedback/sanitize';
import { getFeedbackMedplum, attachScreenshot, parseScreenshot, saveBugRecord, storeFeatureRequest, submitBug } from '@/lib/feedback/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 1_600_000;

function clientIp(request: NextRequest): string {
  // Vercel sets its own client-IP header. On self-hosted ingress, use the hop
  // appended by the trusted proxy closest to the app.
  const ip = (process.env.VERCEL === '1'
    ? request.headers.get('x-vercel-forwarded-for')
    : request.headers.get('x-forwarded-for')?.split(',').at(-1))?.trim();
  return ip && isIP(ip) ? ip : 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    // Coarse per-IP cap before any auth/Medplum work (generous: clinics share one NAT address).
    if (isRateLimited(`feedback-ip:${clientIp(request)}`, 30, 60_000)) {
      return NextResponse.json({ error: 'Too many submissions. Try again in a minute.' }, { status: 429 });
    }
    const profile = await getCurrentProfile(request);
    const { clinicId } = await requireClinicAuth(request);
    // Feature is opt-in per clinic: behave as if the route does not exist when the toggle is off.
    if (!(await isModuleEnabledForClinic('feedback', clinicId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (isRateLimited(`feedback:${clinicId}:${profile.id}`, 5, 60_000)) {
      return NextResponse.json({ error: 'Too many submissions. Try again in a minute.' }, { status: 429 });
    }

    // Allow a 1 MB screenshot encoded as base64 plus text. The reader enforces
    // the byte limit independently of Content-Length.
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
      throw new PayloadTooLargeError();
    }
    const raw = asObject(await readJsonBody(request, MAX_BODY_BYTES));
    if (!raw || (raw.kind !== 'bug' && raw.kind !== 'feature')) {
      return NextResponse.json({ error: 'kind must be "bug" or "feature"' }, { status: 400 });
    }
    const clean = sanitizeFeedback({
      kind: raw.kind,
      title: raw.title,
      description: raw.description,
      page: raw.page,
      browser: asObject(raw.browser),
      lastError: raw.lastError,
    });
    if (clean.title.length < 3) {
      return NextResponse.json({ error: 'Please add a short title.' }, { status: 400 });
    }

    let shot: ReturnType<typeof parseScreenshot> = null;
    if (raw.screenshot) {
      shot = parseScreenshot(raw.screenshot);
      if (!shot) return NextResponse.json({ error: 'Screenshot must be a PNG/JPEG under 1 MB.' }, { status: 400 });
      if (raw.screenshotNoPatientData !== true) {
        return NextResponse.json({ error: 'Confirm the screenshot shows no patient information.' }, { status: 400 });
      }
    }

    // Feedback is product data, not clinical data: staff policies grant no Basic access, so use the
    // server directory client, always scoped by the authenticated clinicId.
    const admin = await getFeedbackMedplum();
    const result =
      clean.kind === 'feature'
        ? await storeFeatureRequest(admin, clinicId, profile.id!, clean)
        : await submitBug(admin, clinicId, clean, Boolean(shot));

    // Screenshots are never sent to GitHub; they live only on a clinic-scoped record.
    if (shot) {
      const recordId =
        'recordId' in result
          ? result.recordId
          : await saveBugRecord(admin, clinicId, clean, 'issue-created', result.issueUrl);
      await attachScreenshot(admin, recordId, shot);
    }

    return NextResponse.json({ ok: true, result }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
    }
    const res = handleRouteError(error, 'Feedback');
    // handleRouteError echoes error.message on unhandled 500s; never expose internals from this route.
    if (res.status === 500) return NextResponse.json({ error: 'Could not send feedback. Please try again.' }, { status: 500 });
    return res;
  }
}
