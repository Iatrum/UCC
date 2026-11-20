import { describe, expect, it } from 'bun:test';
import type { MedplumClient } from '@medplum/core';
import {
  createClinicalCatalogItem,
  deleteClinicalCatalogItem,
  deleteClinicalCatalogItemForClinic,
  getClinicalCatalogItems,
  updateClinicalCatalogItem,
} from '../../lib/fhir/catalog-service';
import { NotFoundError } from '../../lib/server/route-helpers';

// Task 744: fake data only. A fake Medplum client records every call.
const clinic = 'fake-clinic-a';
const own = { system: 'clinic', value: clinic };
const foreign = { system: 'clinic', value: 'fake-clinic-b' };
const typeExt = (v: string) => ({ url: 'https://ucc.emr/catalog-type', valueString: v });
const def = (id: string, over: Record<string, any> = {}) => ({
  resourceType: 'ChargeItemDefinition', id, status: 'active', identifier: [own],
  title: `Item ${id}`, extension: [typeExt('lab')],
  propertyGroup: [{ priceComponent: [{ type: 'base', amount: { value: 12.5, currency: 'MYR' } }] }],
  ...over,
});

function fake(rows: any[] = []) {
  const calls = { search: [] as any[], create: [] as any[], update: [] as any[], del: [] as any[], post: [] as any[] };
  const client = {
    async *searchResourcePages(type: string, q: URLSearchParams) {
      calls.search.push({ type, q: q.toString() });
      yield rows;
    },
    async readResource(type: string, id: string) {
      if (type === 'Organization') return { resourceType: type, id };
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error('not found');
      return structuredClone(row);
    },
    async searchOne(type: string) { return { resourceType: type, id: 'fake-account-a' }; },
    async createResource(r: any) { calls.create.push(r); return { ...r, id: 'fake-new' }; },
    async updateResource(r: any) { calls.update.push(r); return r; },
    async deleteResource(type: string, id: string) { calls.del.push({ type, id }); },
    async post(url: string, body: any) { calls.post.push({ url, body }); return {}; },
  } as unknown as MedplumClient;
  return { client, calls };
}

describe('getClinicalCatalogItems', () => {
  it('scopes the search to the clinic, drops foreign / untyped rows, filters by type and sorts by name', async () => {
    const { client, calls } = fake([
      def('1', { title: 'Zinc', extension: [typeExt('lab')] }),
      def('2', { title: 'Albumin', extension: [typeExt('lab'), { url: 'https://ucc.emr/catalog-category', valueString: 'Chem' }] }),
      def('3', { title: 'Foreign', identifier: [foreign] }),
      def('4', { title: 'No type', extension: [] }),
      def('5', { title: 'Bad type', extension: [typeExt('pharmacy')] }),
      def('6', { title: 'Chest', extension: [typeExt('imaging'), { url: 'https://ucc.emr/catalog-modality', valueString: 'XR' }] }),
    ]);
    const all = await getClinicalCatalogItems(client, clinic);
    expect(calls.search[0].q).toContain(`identifier=clinic%7C${clinic}`);
    expect(all.map((i) => i.name)).toEqual(['Albumin', 'Chest', 'Zinc']);
    expect(all[0].category).toBe('Chem');
    expect(all[1].modality).toBe('XR');
    const labs = await getClinicalCatalogItems(client, clinic, 'lab');
    expect(labs.map((i) => i.id)).toEqual(['2', '1']);
  });

  it('maps naming fallbacks, price default, retired status and notes', async () => {
    const { client } = fake([
      def('a', { title: undefined, code: { text: 'Code text' }, propertyGroup: undefined, status: 'retired', description: 'Note' }),
      def('b', { title: undefined, code: { coding: [{ system: 's', code: 'c', display: 'Disp' }] } }),
      def('c', { title: undefined, code: undefined }),
    ]);
    const items = Object.fromEntries((await getClinicalCatalogItems(client, clinic)).map((i) => [i.id, i]));
    expect(items.a).toMatchObject({ name: 'Code text', defaultPrice: 0, active: false, notes: 'Note' });
    expect(items.b).toMatchObject({ name: 'Disp', code: 'c', system: 's', defaultPrice: 12.5, active: true });
    expect(items.c.name).toBe('Unnamed catalog item');
  });
});

describe('createClinicalCatalogItem', () => {
  it('stamps clinic identifier + account, trims inputs, sanitises a non-finite price and assigns accounts', async () => {
    const { client, calls } = fake();
    const id = await createClinicalCatalogItem(client, clinic, {
      type: 'lab', name: '  CBC  ', category: ' Haem ', modality: '  ', defaultPrice: Number.NaN, active: false, notes: '  n  ',
    });
    expect(id).toBe('fake-new');
    const r = calls.create[0];
    expect(r.status).toBe('retired');
    expect(r.title).toBe('CBC');
    expect(r.description).toBe('n');
    expect(r.url).toBe(`https://ucc.emr/catalog/${clinic}/lab/CBC`);
    expect(r.identifier).toContainEqual(own);
    expect(r.meta.accounts).toEqual([{ reference: 'HealthcareService/fake-account-a' }]);
    expect(r.propertyGroup[0].priceComponent[0].amount).toEqual({ value: 0, currency: 'MYR' });
    expect(r.extension.map((e: any) => e.url)).toEqual(['https://ucc.emr/catalog-type', 'https://ucc.emr/catalog-category']);
    expect(r.code.coding).toBeUndefined();
    expect(calls.post[0].url).toBe('fhir/R4/ChargeItemDefinition/fake-new/$set-accounts');
  });

  it('writes a coding when a code is supplied and uses the type as slug for a blank name', async () => {
    const { client, calls } = fake();
    await createClinicalCatalogItem(client, clinic, { type: 'imaging', name: ' ', code: 'X1', defaultPrice: 30, active: true });
    expect(calls.create[0].code.coding).toEqual([{ system: undefined, code: 'X1', display: '' }]);
    expect(calls.create[0].url).toBe(`https://ucc.emr/catalog/${clinic}/imaging/imaging`);
  });

  it('rejects without a clinic tenant', async () => {
    const { client, calls } = fake();
    await expect(createClinicalCatalogItem(client, '', { type: 'lab', name: 'x', defaultPrice: 1, active: true })).rejects.toThrow('Clinic tenant is required');
    expect(calls.create).toHaveLength(0);
  });
});

describe('updateClinicalCatalogItem', () => {
  it('merges updates, keeps untouched fields and the clinic identifier', async () => {
    const { client, calls } = fake([def('1', { title: 'Old' })]);
    await updateClinicalCatalogItem(client, clinic, '1', { name: '  New ', active: false, defaultPrice: 0 });
    const u = calls.update[0];
    expect(u.title).toBe('New');
    expect(u.status).toBe('retired');
    expect(u.propertyGroup[0].priceComponent[0].amount.value).toBe(0);
    expect(u.identifier).toContainEqual(own);
  });

  it('keeps the current name and price when the update is blank / non-numeric', async () => {
    const { client, calls } = fake([def('1', { title: 'Keep' })]);
    await updateClinicalCatalogItem(client, clinic, '1', { name: '   ', defaultPrice: undefined });
    expect(calls.update[0].title).toBe('Keep');
    expect(calls.update[0].propertyGroup[0].priceComponent[0].amount.value).toBe(12.5);
    expect(calls.update[0].status).toBe('active');
  });

  it('404s (zero writes) for a missing, foreign or untyped item', async () => {
    const { client, calls } = fake([def('f', { identifier: [foreign] }), def('u', { extension: [] })]);
    for (const id of ['missing', 'f', 'u']) {
      await expect(updateClinicalCatalogItem(client, clinic, id, { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
    }
    expect(calls.update).toHaveLength(0);
  });
});

describe('delete', () => {
  it('deleteClinicalCatalogItemForClinic deletes only own items', async () => {
    const { client, calls } = fake([def('1'), def('f', { identifier: [foreign] })]);
    await deleteClinicalCatalogItemForClinic(client, clinic, '1');
    expect(calls.del).toEqual([{ type: 'ChargeItemDefinition', id: '1' }]);
    await expect(deleteClinicalCatalogItemForClinic(client, clinic, 'f')).rejects.toBeInstanceOf(NotFoundError);
    await expect(deleteClinicalCatalogItemForClinic(client, clinic, 'nope')).rejects.toBeInstanceOf(NotFoundError);
    expect(calls.del).toHaveLength(1);
  });

  it('deleteClinicalCatalogItem is a plain delete', async () => {
    const { client, calls } = fake();
    await deleteClinicalCatalogItem(client, 'x');
    expect(calls.del).toEqual([{ type: 'ChargeItemDefinition', id: 'x' }]);
  });
});
