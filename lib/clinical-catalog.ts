import { LAB_TESTS } from '@/lib/fhir/lab-constants';
import { IMAGING_PROCEDURES } from '@/lib/fhir/imaging-constants';
import type { ClinicalCatalogItem, ClinicalCatalogType } from '@/lib/fhir/catalog-service';

export type { ClinicalCatalogItem, ClinicalCatalogType };

export const DEFAULT_DOCUMENT_CATALOG: ClinicalCatalogItem[] = [
  {
    id: 'letter-mc',
    type: 'document',
    name: 'Medical certificate (MC)',
    code: 'letter-mc',
    display: 'Medical certificate (MC)',
    category: 'Letter',
    defaultPrice: 0,
    active: true,
  },
  {
    id: 'letter-referral',
    type: 'document',
    name: 'Referral letter',
    code: 'letter-referral',
    display: 'Referral letter',
    category: 'Letter',
    defaultPrice: 0,
    active: true,
  },
];

export function defaultCatalogItems(type: ClinicalCatalogType): ClinicalCatalogItem[] {
  if (type === 'lab') {
    return Object.entries(LAB_TESTS).map(([key, test]) => ({
      id: key,
      type,
      name: test.display,
      code: test.code,
      system: test.system,
      display: test.display,
      category: 'Panels',
      defaultPrice: 0,
      active: true,
    }));
  }

  if (type === 'imaging') {
    return Object.entries(IMAGING_PROCEDURES).map(([key, procedure]) => ({
      id: key,
      type,
      name: procedure.display,
      code: procedure.code,
      system: procedure.system,
      display: procedure.display,
      category: modalityCategory(procedure.modality),
      modality: procedure.modality,
      defaultPrice: 0,
      active: true,
    }));
  }

  return DEFAULT_DOCUMENT_CATALOG;
}

export async function getClinicalCatalog(type: ClinicalCatalogType): Promise<ClinicalCatalogItem[]> {
  try {
    const response = await fetch(`/api/catalogs?type=${encodeURIComponent(type)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Catalog request failed');
    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items as ClinicalCatalogItem[] : [];
    return items.length ? items : defaultCatalogItems(type);
  } catch {
    return defaultCatalogItems(type);
  }
}

function modalityCategory(modality: string): string {
  switch (modality) {
    case 'DX':
      return 'X-Ray';
    case 'CT':
      return 'CT Scan';
    case 'MR':
      return 'MRI';
    case 'US':
      return 'Ultrasound';
    case 'MG':
      return 'Mammography';
    default:
      return modality;
  }
}
