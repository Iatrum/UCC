import type { Encounter, Extension } from '@medplum/fhirtypes';
import type { ProcedureRecord } from '@/lib/models';

export const INVESTIGATION_BILLING_URL = 'https://ucc.emr/encounter/investigation-billing';
export interface InvestigationBillItem extends ProcedureRecord { id: string }

export function investigationBillItems(encounter: Encounter): InvestigationBillItem[] {
  return (encounter.extension || []).filter((e) => e.url === INVESTIGATION_BILLING_URL).flatMap((e) => {
    try { const item = JSON.parse(e.valueString || ''); return item.id && typeof item.name === 'string' ? [item] : []; }
    catch { return []; }
  });
}

export function investigationBillingExtensions(items: InvestigationBillItem[]): Extension[] {
  return items.map((item) => ({ url: INVESTIGATION_BILLING_URL, valueString: JSON.stringify(item) }));
}
