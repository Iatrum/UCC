#!/usr/bin/env bun
/**
 * Smoke test: the clinic-filtered purchase-order search against the DEV Medplum.
 * Creates fake purchase-order Basics in two fake clinics (tagged, unique run id),
 * runs listClinicPurchaseOrders, asserts only the right clinic's orders come
 * back (more than one page), then deletes everything it created.
 *
 * Usage: bun scripts/dev/smoke-purchases-scope.ts
 * Env (optional): MEDPLUM_URL (local only, default http://127.0.0.1:8113/),
 *                 MEDPLUM_ADMIN_EMAIL / MEDPLUM_ADMIN_PASSWORD (dev defaults as in e2e/scripts/seed-clinics.ts)
 * Fake data only; never point this at production.
 */
import { MedplumClient } from '@medplum/core';
import type { Basic } from '@medplum/fhirtypes';
import {
  PURCHASE_CLINIC_SYSTEM,
  PURCHASE_CODE_SYSTEM,
  PURCHASE_CODE_VALUE,
  PURCHASE_DATA_EXT,
  listClinicPurchaseOrders,
} from '@/lib/server/purchase-orders';

const RUN = `smoke390-${Date.now()}`;
const SMOKE_SYSTEM = 'urn:iatrum:smoke-run';
const CLINIC_A = `${RUN}-a`;
const CLINIC_B = `${RUN}-b`;
const COUNT_A = 105; // > one page of 100
const COUNT_B = 5;

const url = new URL(process.env.MEDPLUM_URL || 'http://127.0.0.1:8113/');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '8113') {
  throw new Error('Refusing: only the dev Medplum on localhost/127.0.0.1:8113 is allowed');
}

function fakePo(clinic: string, i: number): Basic {
  return {
    resourceType: 'Basic',
    code: { coding: [{ system: PURCHASE_CODE_SYSTEM, code: PURCHASE_CODE_VALUE }] },
    identifier: [
      { system: PURCHASE_CLINIC_SYSTEM, value: clinic },
      { system: SMOKE_SYSTEM, value: RUN },
    ],
    extension: [{ url: PURCHASE_DATA_EXT, valueString: JSON.stringify({ supplierName: `Fake ${i}`, status: 'draft' }) }],
  };
}

async function main() {
  const medplum = new MedplumClient({ baseUrl: url.href, fetch: globalThis.fetch.bind(globalThis) });
  const login = await medplum.startLogin({
    email: process.env.MEDPLUM_ADMIN_EMAIL || 'admin@example.com',
    password: process.env.MEDPLUM_ADMIN_PASSWORD || 'medplum_admin',
  });
  if (!login.code) throw new Error('Admin login did not return a code');
  await medplum.processCode(login.code);

  const created: string[] = [];
  let failed = false;
  try {
    for (let i = 0; i < COUNT_A; i++) created.push((await medplum.createResource(fakePo(CLINIC_A, i))).id!);
    for (let i = 0; i < COUNT_B; i++) created.push((await medplum.createResource(fakePo(CLINIC_B, i))).id!);

    const a = await listClinicPurchaseOrders(medplum, CLINIC_A);
    const b = await listClinicPurchaseOrders(medplum, CLINIC_B);
    const check = (ok: boolean, msg: string) => {
      console.log(`${ok ? 'PASS' : 'FAIL'}: ${msg}`);
      if (!ok) failed = true;
    };
    check(a.length === COUNT_A, `clinic A returns all ${COUNT_A} orders across pages (got ${a.length})`);
    check(b.length === COUNT_B, `clinic B returns exactly ${COUNT_B} orders (got ${b.length})`);
    check(a.every((r) => r.identifier?.some((x) => x.system === PURCHASE_CLINIC_SYSTEM && x.value === CLINIC_A)), 'clinic A results contain no foreign clinic');
    check(b.every((r) => r.identifier?.some((x) => x.system === PURCHASE_CLINIC_SYSTEM && x.value === CLINIC_B)), 'clinic B results contain no foreign clinic');
  } finally {
    for (const id of created) await medplum.deleteResource('Basic', id).catch(() => {});
    console.log(`cleaned up ${created.length} fake resources`);
  }
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error('smoke failed:', e instanceof Error ? e.message : 'unknown error');
  process.exit(1);
});
