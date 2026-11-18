import { describe, expect, test } from 'bun:test';
import type { MedplumClient } from '@medplum/core';
import { getRecentConsultationsFromMedplum } from '../../lib/fhir/consultation-service';
import { CLINIC_IDENTIFIER_SYSTEM } from '../../lib/fhir/clinic-tenancy';

// Fake data only. Pins the /api/consultations?recent= mapping (UX-FINDINGS Part 1 #18).
const clinic = { system: CLINIC_IDENTIFIER_SYSTEM, value: 'fake-clinic-a' };
const other = { system: CLINIC_IDENTIFIER_SYSTEM, value: 'fake-clinic-b' };

function client(calls: Array<[string, Record<string, string>]>) {
  const encs = [
    { resourceType: 'Encounter', id: 'e1', identifier: [clinic], subject: { reference: 'Patient/p1', display: 'Fake One' } },
    { resourceType: 'Encounter', id: 'e2', identifier: [other], subject: { reference: 'Patient/p2' } },
  ];
  return {
    searchResources: async (type: string, params: Record<string, string>) => {
      calls.push([type, params]);
      if (type === 'Encounter') return encs;
      if (type === 'Observation') return [{ resourceType: 'Observation', encounter: { reference: 'Encounter/e1' }, code: { text: 'Chief Complaint' }, valueString: 'Fake cough' }];
      if (type === 'Condition') return [{ resourceType: 'Condition', encounter: { reference: 'Encounter/e1' }, code: { text: 'Fake URTI' } }];
      return [];
    },
  } as unknown as MedplumClient;
}

describe('getRecentConsultationsFromMedplum', () => {
  test('maps patientId/complaint/diagnosis, stays clinic scoped, uses bulk _count', async () => {
    const calls: Array<[string, Record<string, string>]> = [];
    const rows = await getRecentConsultationsFromMedplum(10, 'fake-clinic-a', client(calls));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'e1', patientId: 'p1', chiefComplaint: 'Fake cough', diagnosis: 'Fake URTI' });
    const enc = calls.find(([t]) => t === 'Encounter')![1];
    expect(enc.identifier).toBe(`${CLINIC_IDENTIFIER_SYSTEM}|fake-clinic-a`);
    for (const [t, p] of calls.filter(([t]) => t !== 'Encounter')) expect(p._count, t).toBe('1000');
  });
});
