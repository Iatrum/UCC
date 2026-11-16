import type { Basic } from '@medplum/fhirtypes';
import type { MedplumClient } from '@medplum/core';

export const PURCHASE_CODE_SYSTEM = 'urn:iatrum:resource-type';
export const PURCHASE_CODE_VALUE = 'purchase-order';
export const PURCHASE_CLINIC_SYSTEM = 'clinic';
export const PURCHASE_DATA_EXT = 'urn:iatrum:purchase-order/data';

const PAGE_SIZE = '100';

export function belongsToClinic(resource: Basic, clinicId: string): boolean {
  return Boolean(
    resource.identifier?.some((i) => i.system === PURCHASE_CLINIC_SYSTEM && i.value === clinicId)
  );
}

export function isPurchaseOrder(resource: Basic): boolean {
  return Boolean(
    resource.code?.coding?.some(
      (c) => c.system === PURCHASE_CODE_SYSTEM && c.code === PURCHASE_CODE_VALUE
    )
  );
}

/** True only for a purchase-order Basic owned by this clinic. */
export function isClinicPurchaseOrder(resource: Basic, clinicId: string): boolean {
  return isPurchaseOrder(resource) && belongsToClinic(resource, clinicId);
}

export function fromBasic(resource: Basic): any {
  const raw = resource.extension?.find((e) => e.url === PURCHASE_DATA_EXT)?.valueString;
  if (!raw) throw new Error('Malformed purchase order resource');
  return { ...JSON.parse(raw), id: resource.id };
}

/**
 * Lists all purchase orders of ONE clinic. The clinic filter is part of the
 * server-side search (so other clinics' orders can never crowd out results),
 * and every page is followed. The in-memory check is defence in depth only.
 */
export async function listClinicPurchaseOrders(
  medplum: MedplumClient,
  clinicId: string
): Promise<Basic[]> {
  const out: Basic[] = [];
  for await (const page of medplum.searchResourcePages(
    'Basic',
    {
      code: `${PURCHASE_CODE_SYSTEM}|${PURCHASE_CODE_VALUE}`,
      identifier: `${PURCHASE_CLINIC_SYSTEM}|${clinicId}`,
      _count: PAGE_SIZE,
      _sort: '-_lastUpdated',
    },
    { cache: 'no-cache' }
  )) {
    for (const r of page as Basic[]) {
      if (isClinicPurchaseOrder(r, clinicId)) out.push(r);
    }
  }
  return out;
}
