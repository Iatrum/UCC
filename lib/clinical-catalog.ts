import type { ClinicalCatalogItem, ClinicalCatalogType } from '@/lib/fhir/catalog-service';

export type { ClinicalCatalogItem, ClinicalCatalogType };

export async function getClinicalCatalog(type: ClinicalCatalogType): Promise<ClinicalCatalogItem[]> {
  try {
    const response = await fetch(`/api/catalogs?type=${encodeURIComponent(type)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Catalog request failed');
    const data = await response.json();
    return Array.isArray(data.items) ? data.items as ClinicalCatalogItem[] : [];
  } catch {
    return [];
  }
}
