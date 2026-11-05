import { NextRequest, NextResponse } from 'next/server';
import type { Parameters, Subscription } from '@medplum/fhirtypes';
import { requireClinicAuth } from '@/lib/server/medplum-auth';
import { handleRouteError, ForbiddenError } from '@/lib/server/route-helpers';
import { isModuleEnabledForClinic } from '@/lib/module-registry';

export const runtime = 'nodejs';

/** Patient + clinic scoped WebSocket binding, using the authenticated staff client. */
export async function POST(request: NextRequest) {
  try {
    const { medplum, clinicId } = await requireClinicAuth(request);
    if (!(await isModuleEnabledForClinic('poct', clinicId))) {
      throw new ForbiddenError('POCT module is disabled for this clinic');
    }
    const { patientId, encounterId } = await request.json();
    if (typeof patientId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(patientId) ||
      (encounterId !== undefined && (typeof encounterId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(encounterId)))) {
      return NextResponse.json({ error: 'Invalid patient or encounter' }, { status: 400 });
    }
    const patient = await medplum.searchOne('Patient', { _id: patientId, identifier: `clinic|${clinicId}` }, { cache: 'no-cache' });
    if (!patient) throw new ForbiddenError('Patient unavailable in current clinic');
    if (encounterId) {
      const encounter = await medplum.searchOne('Encounter', { _id: encounterId, identifier: `clinic|${clinicId}` }, { cache: 'no-cache' });
      if (encounter?.subject?.reference !== `Patient/${patientId}`) throw new ForbiddenError('Encounter unavailable in current clinic');
    }
    const params = new URLSearchParams({ subject: `Patient/${patientId}`, identifier: `clinic|${clinicId}` });
    if (encounterId) params.set('encounter', `Encounter/${encounterId}`);
    // Uses Medplum's in-memory WebSocket Subscription flow (verified in pinned SDK).
    // The browser renews its lease after rechecking authorization. Medplum 5.2.8
    // binding JWTs expire after one hour; end is also set on the FHIR resource.
    const end = new Date(Date.now() + 90_000).toISOString();
    try {
      const subscription = await medplum.createResource<Subscription>({
        resourceType: 'Subscription', status: 'active', reason: 'Lab tab live updates',
        criteria: `DiagnosticReport?${params}`, channel: { type: 'websocket' }, end,
      });
      const binding = await medplum.get<Parameters>(`fhir/R4/Subscription/${subscription.id}/$get-ws-binding-token`, { cache: 'no-cache' });
      const token = binding.parameter?.find((p) => p.name === 'token')?.valueString;
      const url = binding.parameter?.find((p) => p.name === 'websocket-url')?.valueUrl;
      const expiration = binding.parameter?.find((p) => p.name === 'expiration')?.valueDateTime;
      if (!token || !url || !expiration || !/^wss?:\/\//.test(url)) throw new Error('Invalid binding');
      return NextResponse.json({ token, url, subscriptionId: subscription.id,
        expiresAt: Math.min(Date.parse(expiration), Date.parse(end)) }, { headers: { 'Cache-Control': 'no-store' } });
    } catch {
      // Unsupported project flag or unavailable socket service: the Lab tab polls.
      // Binding responses/errors can contain credentials; never log them.
      return NextResponse.json({ error: 'Live updates unavailable' }, { status: 503 });
    }
  } catch (error) {
    return handleRouteError(error, 'POST /api/labs/subscription');
  }
}
