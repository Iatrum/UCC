import { NextRequest, NextResponse } from 'next/server';
import { requireClinicAuth, getCurrentProfile } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';
import { isModuleEnabledForClinic } from '@/lib/module-registry';
import { isRateLimited } from '@/lib/rate-limit';
import { sanitizeFeedback } from '@/lib/feedback/sanitize';
import { getFeedbackMedplum, attachScreenshot, parseScreenshot, saveBugRecord, storeFeatureRequest, submitBug } from '@/lib/feedback/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_CHARS = 1_600_000;

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
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

    // Whole-request cap (1 MB screenshot as base64 + text). Content-Length is only a fast path; it is
    // absent on chunked bodies, so the real length is checked on the text as well.
    if (Number(request.headers.get('content-length')) > MAX_BODY_CHARS) {
      return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
    }
    const text = await request.text().catch(() => '');
    if (text.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: 'Request too large.' }, { status: 413 });
    }
    let raw: Record<string, any> | null = null;
    try {
      const parsed = JSON.parse(text);
      raw = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      raw = null;
    }
    if (!raw || (raw.kind !== 'bug' && raw.kind !== 'feature')) {
      return NextResponse.json({ error: 'kind must be "bug" or "feature"' }, { status: 400 });
    }
    const clean = sanitizeFeedback({
      kind: raw.kind,
      title: raw.title,
      description: raw.description,
      page: raw.page,
      browser: raw.browser,
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
    const res = handleRouteError(error, 'Feedback');
    // handleRouteError echoes error.message on unhandled 500s; never expose internals from this route.
    if (res.status === 500) return NextResponse.json({ error: 'Could not send feedback. Please try again.' }, { status: 500 });
    return res;
  }
}
