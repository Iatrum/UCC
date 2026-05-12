import type { MedplumClient } from '@medplum/core';
import type { ChargeItemDefinition, Money } from '@medplum/fhirtypes';

export type ClinicalCatalogType = 'lab' | 'imaging' | 'document';

export interface ClinicalCatalogItem {
  id: string;
  type: ClinicalCatalogType;
  name: string;
  code?: string;
  system?: string;
  display?: string;
  category?: string;
  modality?: string;
  defaultPrice: number;
  active: boolean;
  notes?: string;
}

const CLINIC_IDENTIFIER_SYSTEM = 'clinic';
const CATALOG_TYPE_IDENTIFIER_SYSTEM = 'https://ucc.emr/catalog-type';
const CATALOG_TYPE_EXTENSION_URL = 'https://ucc.emr/catalog-type';
const CATALOG_CATEGORY_EXTENSION_URL = 'https://ucc.emr/catalog-category';
const CATALOG_MODALITY_EXTENSION_URL = 'https://ucc.emr/catalog-modality';
const PRICE_CURRENCY = 'MYR';

function getStringExtension(definition: ChargeItemDefinition, url: string): string | undefined {
  const ext = definition.extension?.find((item) => item.url === url);
  return (ext as { valueString?: string } | undefined)?.valueString || undefined;
}

function getDefaultPrice(definition: ChargeItemDefinition): number {
  const priceComponent = definition.propertyGroup?.[0]?.priceComponent?.[0];
  const amount = priceComponent?.amount as Money | undefined;
  return typeof amount?.value === 'number' ? amount.value : 0;
}

function buildExtensions(item: Pick<ClinicalCatalogItem, 'type' | 'category' | 'modality'>): ChargeItemDefinition['extension'] {
  return [
    { url: CATALOG_TYPE_EXTENSION_URL, valueString: item.type },
    ...(item.category?.trim() ? [{ url: CATALOG_CATEGORY_EXTENSION_URL, valueString: item.category.trim() }] : []),
    ...(item.modality?.trim() ? [{ url: CATALOG_MODALITY_EXTENSION_URL, valueString: item.modality.trim() }] : []),
  ];
}

function buildPrice(defaultPrice: number): ChargeItemDefinition['propertyGroup'] {
  return [
    {
      priceComponent: [
        {
          type: 'base',
          amount: {
            value: Number.isFinite(defaultPrice) ? defaultPrice : 0,
            currency: PRICE_CURRENCY,
          },
        },
      ],
    },
  ];
}

function buildUrl(type: ClinicalCatalogType, name: string, clinicId: string): string {
  const slug = encodeURIComponent(name.trim() || type);
  return `https://ucc.emr/catalog/${clinicId}/${type}/${slug}`;
}

function mapDefinition(definition: ChargeItemDefinition): ClinicalCatalogItem | null {
  const type = getStringExtension(definition, CATALOG_TYPE_EXTENSION_URL) as ClinicalCatalogType | undefined;
  if (type !== 'lab' && type !== 'imaging' && type !== 'document') return null;

  const coding = definition.code?.coding?.[0];
  const name = definition.title || definition.code?.text || coding?.display || 'Unnamed catalog item';

  return {
    id: definition.id || '',
    type,
    name,
    code: coding?.code,
    system: coding?.system,
    display: coding?.display || definition.code?.text || name,
    category: getStringExtension(definition, CATALOG_CATEGORY_EXTENSION_URL),
    modality: getStringExtension(definition, CATALOG_MODALITY_EXTENSION_URL),
    defaultPrice: getDefaultPrice(definition),
    active: definition.status !== 'retired',
    notes: definition.description || undefined,
  };
}

async function readDefinition(medplum: MedplumClient, id: string): Promise<ChargeItemDefinition | null> {
  try {
    return await medplum.readResource('ChargeItemDefinition', id);
  } catch {
    return null;
  }
}

export async function getClinicalCatalogItems(
  medplum: MedplumClient,
  clinicId: string,
  type?: ClinicalCatalogType
): Promise<ClinicalCatalogItem[]> {
  const definitions = await medplum.searchResources('ChargeItemDefinition', {
    identifier: `${CLINIC_IDENTIFIER_SYSTEM}|${clinicId}`,
  });

  return definitions
    .map(mapDefinition)
    .filter((item): item is ClinicalCatalogItem => Boolean(item))
    .filter((item) => !type || item.type === type)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createClinicalCatalogItem(
  medplum: MedplumClient,
  clinicId: string,
  item: Omit<ClinicalCatalogItem, 'id'>
): Promise<string> {
  const name = item.name.trim();
  const definition: ChargeItemDefinition = {
    resourceType: 'ChargeItemDefinition',
    status: item.active === false ? 'retired' : 'active',
    url: buildUrl(item.type, name, clinicId),
    title: name,
    description: item.notes?.trim() || undefined,
    code: {
      text: item.display?.trim() || name,
      coding: item.code || item.system || item.display
        ? [{ system: item.system || undefined, code: item.code || undefined, display: item.display || name }]
        : undefined,
    },
    identifier: [
      { system: CLINIC_IDENTIFIER_SYSTEM, value: clinicId },
      { system: CATALOG_TYPE_IDENTIFIER_SYSTEM, value: item.type },
    ],
    extension: buildExtensions(item),
    propertyGroup: buildPrice(item.defaultPrice),
  };

  const created = await medplum.createResource(definition);
  if (!created.id) throw new Error('Failed to create catalog item');
  return created.id;
}

export async function updateClinicalCatalogItem(
  medplum: MedplumClient,
  id: string,
  updates: Partial<ClinicalCatalogItem>
): Promise<void> {
  const existing = await readDefinition(medplum, id);
  if (!existing) throw new Error('Catalog item not found');

  const current = mapDefinition(existing);
  if (!current) throw new Error('Catalog item not found');

  const next: ClinicalCatalogItem = {
    ...current,
    ...updates,
    id,
    name: updates.name?.trim() || current.name,
    defaultPrice: typeof updates.defaultPrice === 'number' ? updates.defaultPrice : current.defaultPrice,
    active: updates.active ?? current.active,
  };

  await medplum.updateResource({
    ...existing,
    status: next.active ? 'active' : 'retired',
    title: next.name,
    description: next.notes?.trim() || undefined,
    code: {
      text: next.display?.trim() || next.name,
      coding: next.code || next.system || next.display
        ? [{ system: next.system || undefined, code: next.code || undefined, display: next.display || next.name }]
        : undefined,
    },
    extension: buildExtensions(next),
    propertyGroup: buildPrice(next.defaultPrice),
  });
}

export async function deleteClinicalCatalogItem(medplum: MedplumClient, id: string): Promise<void> {
  await medplum.deleteResource('ChargeItemDefinition', id);
}
