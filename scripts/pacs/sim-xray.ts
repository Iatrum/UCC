#!/usr/bin/env bun
/**
 * Simulated POCT X-ray device: a demo/dev-only device that
 *   1. keeps a Device resource's heartbeat fresh (or lets it go stale/offline)
 *   2. sends a synthetic study (the same ImagingStudyData JSON shape
 *      /api/imaging/receive already accepts) for a signed X-ray
 *      ServiceRequest to /api/imaging/receive/message
 *
 * Mirrors the Device contract lib/fhir/xray-device.ts enforces
 * (status=active + last-heartbeat age <=90s = online) and the `simulated`
 * tag e2e/tests/xray.spec.ts uses, so devices created here behave exactly
 * like the ones the composer/Lab tab already expect. Only allowed outside
 * production, in the same fake demo clinics as POCT's simulated analysers.
 *
 * Ingress is authenticated per Device: issue a key for the Device, keep it OUTSIDE git (e.g. e2e/.secrets/),
 * and pass it with --key-file <path> or the UCC_DEVICE_KEY env var when sending. The key is never printed.
 *
 * Usage:
 *   bun scripts/pacs/sim-xray.ts device <clinicId> [--name "Fake X-ray"]
 *   bun scripts/pacs/sim-xray.ts issue-key <deviceId> --key-file <path>   # per-device key; hash stored on the Device, plaintext only in <path> (0600)
 *   bun scripts/pacs/sim-xray.ts heartbeat <deviceId> [--once] [--offline] [--interval 30000]
 *   bun scripts/pacs/sim-xray.ts send-study <serviceRequestId> --study-uid <uid> \
 *     [--modality DX] [--description "Chest PA"] [--series 1] [--instances 2] \
 *     [--base-url http://localhost:3210]
 */

import { getAdminMedplum } from '@/lib/server/medplum-admin';
import { XRAY_TYPE_SYSTEM, XRAY_PROPERTY_SYSTEM, XRAY_TAG_SYSTEM, XRAY_HEARTBEAT_MAX_AGE } from '@/lib/fhir/xray-device';
import { issueDeviceKey } from '@/lib/fhir/device-keys';
import { readFileSync, writeFileSync } from 'node:fs';
import type { Device } from '@medplum/fhirtypes';
import type { ImagingStudyData } from '@/lib/fhir/imaging-constants';

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

async function cmdDevice(clinicId: string, name?: string) {
  if (!SIMULATED_CLINICS.includes(clinicId)) {
    throw new Error(`Simulated devices are only allowed in ${SIMULATED_CLINICS.join(', ')}, got "${clinicId}"`);
  }
  const medplum = await getAdminMedplum();
  const device = await medplum.createResource<Device>({
    resourceType: 'Device',
    status: 'active',
    identifier: [{ system: 'clinic', value: clinicId }],
    meta: { tag: [{ system: XRAY_TAG_SYSTEM, code: 'simulated' }] },
    deviceName: [{ name: name || 'Sim X-ray device', type: 'user-friendly-name' }],
    type: { coding: [{ system: XRAY_TYPE_SYSTEM, code: 'xray' }] },
    property: [{ type: { coding: [{ system: XRAY_PROPERTY_SYSTEM, code: 'last-heartbeat' }] }, valueCode: [{ text: new Date().toISOString() }] }],
  });
  console.log(`Created Device/${device.id} (clinic=${clinicId})`);
  return device.id;
}

async function beat(deviceId: string, online: boolean) {
  const medplum = await getAdminMedplum();
  const device = await medplum.readResource('Device', deviceId);
  await medplum.updateResource<Device>({
    ...device,
    status: online ? 'active' : 'inactive',
    property: [{ type: { coding: [{ system: XRAY_PROPERTY_SYSTEM, code: 'last-heartbeat' }] }, valueCode: [{ text: new Date().toISOString() }] }],
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
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || intervalMs >= XRAY_HEARTBEAT_MAX_AGE) {
    throw new Error(`--interval must be a positive number under ${XRAY_HEARTBEAT_MAX_AGE}ms`);
  }
  console.log(`Device/${deviceId} heartbeat loop every ${intervalMs}ms (Ctrl-C to stop)`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await beat(deviceId, true);
    console.log(`  beat ${new Date().toISOString()}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function cmdSendStudy(serviceRequestId: string, flags: Record<string, string>) {
  const { 'study-uid': studyUid, modality, description, series, instances, 'base-url': baseUrl } = flags;
  if (!studyUid) {
    throw new Error('send-study requires --study-uid');
  }
  const numberOfSeries = Number(series || 1);
  const numberOfInstances = Number(instances || 2);
  const study: ImagingStudyData = {
    studyUid,
    modality: modality || 'DX',
    description: description || 'Simulated X-ray study',
    numberOfSeries,
    numberOfInstances,
    started: new Date(),
    series: Array.from({ length: numberOfSeries }, (_, i) => ({
      uid: `${studyUid}.${i + 1}`,
      number: i + 1,
      modality: modality || 'DX',
      description: description || 'Simulated series',
      numberOfInstances,
      started: new Date(),
    })),
  };

  const url = `${baseUrl || process.env.UCC_BASE_URL || 'http://localhost:3210'}/api/imaging/receive/message`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${loadDeviceKey(flags['key-file'])}` },
    body: JSON.stringify({ serviceRequestId, study }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`send-study failed (${response.status}): ${JSON.stringify(body)}`);
  console.log(`Sent study for ServiceRequest/${serviceRequestId}:`, body);
}

async function cmdIssueKey(deviceId: string, flags: Record<string, string>) {
  const keyFile = flags['key-file'];
  if (!deviceId || !keyFile || keyFile === 'true') throw new Error('issue-key requires <deviceId> and --key-file <path> (the key is never printed)');
  const key = await issueDeviceKey(deviceId);
  writeFileSync(keyFile, `${key}\n`, { mode: 0o600 });
  console.log(`Issued a new API key for Device/${deviceId}; written to ${keyFile} (previous key, if any, is now invalid)`);
}

function loadDeviceKey(keyFile?: string): string {
  const key = keyFile ? readFileSync(keyFile, 'utf8').trim() : process.env.UCC_DEVICE_KEY;
  if (!key) throw new Error('Device API key required: pass --key-file <path> or set UCC_DEVICE_KEY');
  return key;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);

  switch (command) {
    case 'device':
      await cmdDevice(positional[0], flags.name);
      break;
    case 'issue-key':
      await cmdIssueKey(positional[0], flags);
      break;
    case 'heartbeat':
      await cmdHeartbeat(positional[0], flags);
      break;
    case 'send-study':
      await cmdSendStudy(positional[0], flags);
      break;
    default:
      console.error('Usage: sim-xray.ts <device|issue-key|heartbeat|send-study> ...');
      process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
