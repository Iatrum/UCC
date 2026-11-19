import { describe, expect, test } from 'bun:test';
import type { MedplumClient } from '@medplum/core';
import { getPatientConsultationsFromMedplum, patientEncounterSearchParams } from '../../lib/fhir/consultation-service';

describe('patient consultation search (Task 591)', () => {
  test('filters by clinic AND patient identifier server-side with a large page', () => {
    expect(patientEncounterSearchParams('fake-p1', 'fake-clinic')).toEqual([
      ['identifier', 'clinic|fake-clinic'],
      ['identifier', 'firebase-patient|fake-p1'],
      ['_sort', '-date'],
      ['_count', '1000'],
    ]);
    expect(patientEncounterSearchParams('fake-p1', null).map(([k]) => k)).toEqual(['identifier', '_sort', '_count']);
  });

  test('an old consultation is not lost behind newer clinic-wide encounters', async () => {
    const enc = (id: string, patient: string, day: number) => ({
      resourceType: 'Encounter', id, status: 'finished', period: { start: `2026-01-${String(day).padStart(2, '0')}T00:00:00Z` },
      subject: { reference: `Patient/${patient}` },
      identifier: [{ system: 'clinic', value: 'fake-clinic' }, { system: 'firebase-patient', value: patient }],
    });
    // 30 newer encounters of another patient, one old one for fake-p1.
    const all = [...Array.from({ length: 30 }, (_, i) => enc(`o${i}`, 'fake-other', 28 - (i % 20))), enc('mine', 'fake-p1', 1)];
    const seen: string[][][] = [];
    const client = {
      searchResources: async (type: string, params: string[][] | Record<string, string>) => {
        if (type !== 'Encounter') return [];
        const pairs = Array.isArray(params) ? params : Object.entries(params);
        seen.push(pairs);
        const idents = pairs.filter(([k]) => k === 'identifier').map(([, v]) => v);
        const count = Number(pairs.find(([k]) => k === '_count')?.[1] ?? 20); // Medplum default page
        return all.filter((e) => idents.every((v) => { const [s, val] = v.split('|'); return e.identifier.some((i) => i.system === s && i.value === val); })).slice(0, count);
      },
    } as unknown as MedplumClient;
    const result = await getPatientConsultationsFromMedplum('fake-p1', 'fake-clinic', client);
    expect(result.map((c) => c.id)).toEqual(['mine']);
    expect(seen).toHaveLength(1);
  });

  const mkEnc = (id: string, clinic: string, patient: string, n: number) => ({
    resourceType: 'Encounter', id, status: 'finished',
    period: { start: new Date(Date.UTC(2026, 0, 1) + n * 60000).toISOString() },
    identifier: [{ system: 'clinic', value: clinic }, { system: 'firebase-patient', value: patient }],
  });

  test('pages past 1000 encounters and batches child searches (<=100 refs per URL)', async () => {
    const all = Array.from({ length: 1150 }, (_, i) => mkEnc(`e${i}`, 'fake-clinic', 'fake-p1', i));
    const encCalls: number[] = [];
    const refCounts: number[] = [];
    const client = {
      searchResources: async (type: string, params: any) => {
        if (type === 'Encounter') {
          const pairs: string[][] = Array.isArray(params) ? params : Object.entries(params);
          const off = Number(pairs.find(([k]) => k === '_offset')?.[1] ?? 0);
          encCalls.push(off);
          return all.slice(off, off + 1000);
        }
        refCounts.push(String(params.encounter).split(',').length);
        return [];
      },
    } as unknown as MedplumClient;
    const result = await getPatientConsultationsFromMedplum('fake-p1', 'fake-clinic', client);
    expect(result).toHaveLength(1150);
    expect(encCalls).toEqual([0, 1000]);
    expect(Math.max(...refCounts)).toBeLessThanOrEqual(100);
  });

  test('never returns another clinic or patient even if the server returns it', async () => {
    const client = {
      searchResources: async (type: string) =>
        type === 'Encounter'
          ? [mkEnc('ok', 'fake-clinic', 'fake-p1', 1), mkEnc('other-clinic', 'fake-clinic-b', 'fake-p1', 2), mkEnc('other-pt', 'fake-clinic', 'fake-p2', 3)]
          : [],
    } as unknown as MedplumClient;
    const result = await getPatientConsultationsFromMedplum('fake-p1', 'fake-clinic', client);
    expect(result.map((c) => c.id)).toEqual(['ok']);
  });
});
