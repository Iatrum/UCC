import { NextRequest, NextResponse } from 'next/server';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError } from '@/lib/server/route-helpers';
import { draftScope, readDraft, writeDraft, draftValue, clearDraft } from '@/lib/fhir/consultation-draft';
import { computeTreatmentPlanSummary, normalizeTreatmentPlanEntry, type TreatmentPlanEntry } from '@/lib/treatment-plan';

async function scopeFor(request: NextRequest, body: Record<string, string>) {
  const { medplum, clinicId } = await requireClinicAuth(request);
  if (!body.patientId || !body.draftId) throw new Error('patientId and draftId are required');
  return draftScope(medplum, clinicId, body.patientId, body.draftId, body.consultationId || undefined);
}
function response(body: Record<string, string>, entries: TreatmentPlanEntry[]) {
  return NextResponse.json({ success: true, persistenceAvailable: true, plan: {
    draftId: body.draftId, patientId: body.patientId, consultationId: body.consultationId,
    entries, summary: computeTreatmentPlanSummary(entries), updatedAt: new Date().toISOString(),
  } }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function GET(request: NextRequest) {
  try {
    const body = Object.fromEntries(new URL(request.url).searchParams);
    const scope = await scopeFor(request, body);
    return response(body, draftValue(await readDraft(scope), []));
  } catch (error) { return handleRouteError(error, 'GET consultation plan'); }
}
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.entry || !['items', 'services', 'packages', 'documents'].includes(body.entry.tab)) {
      return NextResponse.json({ error: 'Invalid entry' }, { status: 400 });
    }
    const scope = await scopeFor(request, body);
    const doc = await readDraft(scope);
    const entries = draftValue<TreatmentPlanEntry[]>(doc, []);
    const match = entries.find(entry => entry.id === body.entry.id);
    const entry = normalizeTreatmentPlanEntry(body.entry, new Date().toISOString(), match);
    const next = match ? entries.map(e => e.id === entry.id ? entry : e) : [...entries, entry];
    await writeDraft(scope, next, doc);
    return response(body, next);
  } catch (error) { return handleRouteError(error, 'POST consultation plan'); }
}
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.entryId && !body.clearAll) return NextResponse.json({ error: 'entryId or clearAll required' }, { status: 400 });
    const scope = await scopeFor(request, body);
    const doc = await readDraft(scope);
    const next = body.clearAll ? [] : draftValue<TreatmentPlanEntry[]>(doc, []).filter(e => e.id !== body.entryId);
    if (body.clearAll) await clearDraft(scope);
    else if (doc) await writeDraft(scope, next, doc);
    return response(body, next);
  } catch (error) { return handleRouteError(error, 'DELETE consultation plan'); }
}
