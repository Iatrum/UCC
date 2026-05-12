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

export async function getClinicalCatalog(type: ClinicalCatalogType): Promise<ClinicalCatalogItem[]> {
  try {
    const response = await fetch(`/api/catalogs?type=${encodeURIComponent(type)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Catalog request failed');
    const data = await response.json();
    const items = Array.isArray(data.items) ? data.items as ClinicalCatalogItem[] : [];
    return items.length || type !== 'document' ? items : DEFAULT_DOCUMENT_CATALOG;
  } catch {
    return type === 'document' ? DEFAULT_DOCUMENT_CATALOG : [];
  }
}
