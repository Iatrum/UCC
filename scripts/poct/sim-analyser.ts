#!/usr/bin/env bun
/**
 * Simulated POCT analyser: a demo/dev-only device that
 *   1. keeps a Device resource's heartbeat fresh (or lets it go stale/offline)
 *   2. sends a synthetic HL7 ORU^R01 or ASTM E1394 result for a signed POCT
 *      ServiceRequest to /api/labs/receive/message
 *
 * Mirrors the Device contract `lib/fhir/poct-device.ts` already enforces
 * (status=active + last-heartbeat age <=90s = online) and the `simulated`
 * tag e2e/tests/poct.spec.ts uses, so devices created here behave exactly
 * like the ones the composer/`/poct` worklist already expect. Only allowed
 * outside production, in the same fake demo clinics as the rest of POCT's
 * simulated-device support (demo/clinicb/clinicc/clinicd).
 *
 * Usage:
 *   bun scripts/poct/sim-analyser.ts device <clinicId> <analyserType> [--name "Fake Glucose"]
 *   bun scripts/poct/sim-analyser.ts heartbeat <deviceId> [--once] [--offline] [--interval 30000]
 *   bun scripts/poct/sim-analyser.ts send-result <serviceRequestId> --code <loinc> --name <name> \
 *     --value <v> [--unit u] [--range text] [--interpretation normal|high|low|critical] \
 *     [--status final|preliminary|corrected] [--format hl7|astm] [--base-url http://localhost:3210]
 */

import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { POCT_TYPE_SYSTEM, POCT_PROPERTY_SYSTEM, POCT_TAG_SYSTEM, POCT_HEARTBEAT_MAX_AGE } from '@/lib/fhir/poct-device';
import { buildOruMessage, labResultsToOru } from '@/lib/poct/hl7';
import { buildAstmResult, labResultsToAstm } from '@/lib/poct/astm';
import type { Device } from '@medplum/fhirtypes';
import type { LabResult } from '@/lib/fhir/lab-constants';

const SIMULATED_CLINICS = ['demo', 'clinicb', 'clinicc', 'clinicd'];

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function cmdDevice(clinicId: string, analyserType: string, name?: string) {
  if (!SIMULATED_CLINICS.includes(clinicId)) {
    throw new Error(`Simulated devices are only allowed in ${SIMULATED_CLINICS.join(', ')}, got "${clinicId}"`);
  }
  const medplum = await getAdminMedplum();
  const device = await medplum.createResource<Device>({
    resourceType: 'Device',
    status: 'active',
    identifier: [{ system: 'clinic', value: clinicId }],
    meta: { tag: [{ system: POCT_TAG_SYSTEM, code: 'simulated' }] },
    deviceName: [{ name: name || `Sim ${analyserType} analyser`, type: 'user-friendly-name' }],
    type: { coding: [{ system: POCT_TYPE_SYSTEM, code: analyserType }] },
    property: [{ type: { coding: [{ system: POCT_PROPERTY_SYSTEM, code: 'last-heartbeat' }] }, valueCode: [{ text: new Date().toISOString() }] }],
  });
  console.log(`Created Device/${device.id} (clinic=${clinicId}, type=${analyserType})`);
  return device.id;
}

async function beat(deviceId: string, online: boolean) {
  const medplum = await getAdminMedplum();
  const device = await medplum.readResource('Device', deviceId);
  await medplum.updateResource<Device>({
    ...device,
    status: online ? 'active' : 'inactive',
    property: [{ type: { coding: [{ system: POCT_PROPERTY_SYSTEM, code: 'last-heartbeat' }] }, valueCode: [{ text: new Date().toISOString() }] }],
  });
}

async function cmdHeartbeat(deviceId: string, flags: Record<string, string>) {
  const offline = flags.offline === 'true';
  if (offline) {
    await beat(deviceId, false);
    console.log(`Device/${deviceId} marked offline (status=inactive)`);
    return;
  }
  if (flags.once === 'true') {
    await beat(deviceId, true);
    console.log(`Device/${deviceId} heartbeat sent once`);
    return;
  }
  const intervalMs = Number(flags.interval || 30_000);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs >= POCT_HEARTBEAT_MAX_AGE) {
    throw new Error(`--interval must be a positive number under ${POCT_HEARTBEAT_MAX_AGE}ms`);
  }
  console.log(`Device/${deviceId} heartbeat loop every ${intervalMs}ms (Ctrl-C to stop)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await beat(deviceId, true);
    console.log(`  beat ${new Date().toISOString()}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function cmdSendResult(serviceRequestId: string, flags: Record<string, string>) {
  const { code, name, value, unit, range, interpretation, status, format, 'base-url': baseUrl } = flags;
  if (!code || !name || value === undefined) {
    throw new Error('send-result requires --code, --name and --value');
  }
  const result: LabResult = {
    testCode: code,
    testName: name,
    value: Number.isNaN(Number(value)) ? value : Number(value),
    unit,
    referenceRange: range,
    interpretation: interpretation as LabResult['interpretation'],
    status: (status as LabResult['status']) || 'final',
  };

  const msgFormat = format === 'astm' ? 'astm' : 'hl7';
  const message = msgFormat === 'astm'
    ? buildAstmResult({ placerOrderNumber: serviceRequestId, producedAt: new Date(), results: labResultsToAstm([result]) })
    : buildOruMessage({ placerOrderNumber: serviceRequestId, messageControlId: `SIM-${Date.now()}`, producedAt: new Date(), results: labResultsToOru([result]) });

  const url = `${baseUrl || process.env.UCC_BASE_URL || 'http://localhost:3210'}/api/labs/receive/message`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ format: msgFormat, message, apiKey: process.env.POCT_API_KEY }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`send-result failed (${response.status}): ${JSON.stringify(body)}`);
  console.log(`Sent ${msgFormat.toUpperCase()} result for ServiceRequest/${serviceRequestId}:`, body);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);

  switch (command) {
    case 'device':
      await cmdDevice(positional[0], positional[1], flags.name);
      break;
    case 'heartbeat':
      await cmdHeartbeat(positional[0], flags);
      break;
    case 'send-result':
      await cmdSendResult(positional[0], flags);
      break;
    default:
      console.error('Usage: sim-analyser.ts <device|heartbeat|send-result> ...');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
