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
});
