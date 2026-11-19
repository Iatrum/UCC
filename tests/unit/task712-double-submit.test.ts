import { describe, expect, it, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import { type MedplumClient } from '@medplum/core';

// Fake data only. Stateful in-memory Medplum: lets a retry see what the first attempt wrote.
const db: any[] = [];
let seq = 0;
const identOf = (r: any, system: string) => r.identifier?.find((i: any) => i.system === system)?.value;
const matches = (r: any, q: Record<string, string>) => Object.entries(q).every(([k, v]) => {
  if (k === '_count') return true;
  if (k === 'identifier') { const [sys, val] = v.split('|'); return r.identifier?.some((i: any) => i.system === sys && i.value === val); }
  if (k === 'encounter') return r.encounter?.reference === v;
  if (k === 'target') return r.target?.some((t: any) => t.reference === v);
  if (k === '_id') return r.id === v;
  return true;
});
const clinicPatient = { resourceType: 'Patient', id: 'p-a', identifier: [{ system: 'clinic', value: 'clinic-a' }, { system: 'firebase-patient', value: 'p-a' }] };
const fake: any = {
  async readResource(type: string, id: string) {
    if (type === 'Organization') return { resourceType: 'Organization', id };
    if (type === 'Patient' && id === 'p-a') return clinicPatient;
    const r = db.find((x) => x.resourceType === type && x.id === id);
    if (!r) throw new Error('not found');
    return r;
  },
  async searchOne(type: string, q: any) {
    if (type === 'HealthcareService') return { resourceType: 'HealthcareService', id: 'hs-1' };
    if (type === 'Patient') return clinicPatient;
    return db.find((r) => r.resourceType === type && matches(r, q));
  },
  async searchResources(type: string, q: any) {
    if (type === 'Patient') return [clinicPatient];
    return db.filter((r) => r.resourceType === type && matches(r, q));
  },
  async createResource(r: any) { const c = { ...r, id: `r${++seq}` }; db.push(c); return c; },
  async createResourceIfNoneExist(r: any, query: string) {
    const q = Object.fromEntries(query.split('&').map((p) => p.split('=') as [string, string]));
    const hit = db.find((x) => x.resourceType === r.resourceType && matches(x, q));
    if (hit) return hit;
    return fake.createResource(r);
  },
  async *searchResourcePages() { yield []; },
  async getProfileAsync() { return { resourceType: 'Practitioner', id: 'pr1' }; },
  async updateResource(r: any) { return r; },
  async post() { return {}; },
};
mock.module('@/lib/server/medplum-admin', () => ({ getAdminMedplum: async () => fake }));
const { saveConsultationToMedplum, withSignLock, SIGN_KEY_PATTERN } = await import('../../lib/fhir/consultation-service');
const { signAttemptKey, clearSignAttemptKey } = await import('../../lib/sign-attempt-key');
const m = fake as MedplumClient;
const count = (type: string) => db.filter((r) => r.resourceType === type).length;
const patient = { id: 'p-a', name: 'Fake Patient' };
const base = {
  patientId: 'p-a', chiefComplaint: 'Fake cough', diagnosis: 'Fake URTI', notes: 'Fake notes',
  procedures: [{ name: 'Consultation', price: 30 }, { name: 'Dressing', price: 10 }],
  prescriptions: [{ medication: { id: 'm1', name: 'Fake Paracetamol' }, frequency: 'TDS', duration: '3 days' }],
};

describe('Task 712: consultation Sign is idempotent per attempt key', () => {
  it('a retry/double submit with the same key creates ONE Encounter and one of each child', async () => {
    db.length = 0;
    const key = 'attempt-0001-aaaa';
    const [a, b] = await Promise.all([
      saveConsultationToMedplum({ ...base, idempotencyKey: key }, patient, 'clinic-a', m),
      saveConsultationToMedplum({ ...base, idempotencyKey: key }, patient, 'clinic-a', m),
    ]);
    const c = await saveConsultationToMedplum({ ...base, idempotencyKey: key }, patient, 'clinic-a', m);
    expect(new Set([a, b, c]).size).toBe(1);
    expect(count('Encounter')).toBe(1);
    expect(count('Procedure')).toBe(2);
    expect(count('MedicationRequest')).toBe(1);
    expect(count('Condition')).toBe(1);
    expect(count('Observation')).toBe(2); // chief complaint + clinical notes
    expect(count('Provenance')).toBe(1);
  });

  it('a retry after a half-finished first attempt only creates the missing children', async () => {
    db.length = 0;
    const key = 'attempt-0002-bbbb';
    const realCreate = fake.createResource;
    let failed = false;
    fake.createResource = async (r: any) => {
      if (r.resourceType === 'Procedure' && db.some((x) => x.resourceType === 'Procedure') && !failed) { failed = true; throw new Error('timeout'); }
      return realCreate(r);
    };
    await expect(saveConsultationToMedplum({ ...base, idempotencyKey: key }, patient, 'clinic-a', m)).rejects.toThrow('timeout');
    fake.createResource = realCreate;
    expect(count('Procedure')).toBe(1);
    await saveConsultationToMedplum({ ...base, idempotencyKey: key }, patient, 'clinic-a', m);
    expect(count('Encounter')).toBe(1);
    expect(count('Procedure')).toBe(2);
    expect(count('MedicationRequest')).toBe(1);
    expect(count('Condition')).toBe(1);
    expect(count('Provenance')).toBe(1);
  });

  it('different keys are different visits; no key keeps the old behaviour', async () => {
    db.length = 0;
    await saveConsultationToMedplum({ ...base, idempotencyKey: 'attempt-0003-cccc' }, patient, 'clinic-a', m);
    await saveConsultationToMedplum({ ...base, idempotencyKey: 'attempt-0004-dddd' }, patient, 'clinic-a', m);
    await saveConsultationToMedplum({ ...base }, patient, 'clinic-a', m);
    expect(count('Encounter')).toBe(3);
  });

  it('rejects a malformed key and a key reused for another patient', async () => {
    db.length = 0;
    expect(SIGN_KEY_PATTERN.test('x')).toBe(false);
    await expect(saveConsultationToMedplum({ ...base, idempotencyKey: 'bad key!' }, patient, 'clinic-a', m)).rejects.toThrow();
    expect(count('Encounter')).toBe(0);
  });

  it('the same key in another clinic never matches (clinic is part of the key)', async () => {
    db.length = 0;
    await saveConsultationToMedplum({ ...base, idempotencyKey: 'attempt-0005-eeee' }, patient, 'clinic-a', m);
    const enc = db.find((r) => r.resourceType === 'Encounter');
    expect(identOf(enc, 'https://ucc.emr/consultation-sign-key')).toBe('clinic-a:attempt-0005-eeee');
  });
});

describe('Task 712: withSignLock serialises same-key work', () => {
  it('runs same-key tasks one at a time, in order, even when one fails', async () => {
    const log: string[] = [];
    const task = (name: string, ms: number, fail = false) => withSignLock('k', async () => {
      log.push(`start ${name}`); await new Promise((r) => setTimeout(r, ms)); log.push(`end ${name}`);
      if (fail) throw new Error('x');
    });
    await Promise.allSettled([task('1', 20, true), task('2', 1), task('3', 1)]);
    expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2', 'start 3', 'end 3']);
  });
});

describe('Task 712: client sign key', () => {
  const mem = () => { const s = new Map<string, string>(); return { getItem: (k: string) => s.get(k) ?? null, setItem: (k: string, v: string) => void s.set(k, v), removeItem: (k: string) => void s.delete(k) }; };
  it('is stable across retries of the same content and valid for the server pattern', () => {
    const s = mem();
    const k1 = signAttemptKey('p1', 'notes', 'dx', s);
    expect(signAttemptKey('p1', 'notes', 'dx', s)).toBe(k1);
    expect(SIGN_KEY_PATTERN.test(k1)).toBe(true);
  });
  it('changes when the content is edited, per patient, and after success', () => {
    const s = mem();
    const k1 = signAttemptKey('p1', 'notes', 'dx', s);
    expect(signAttemptKey('p1', 'notes edited', 'dx', s)).not.toBe(k1);
    expect(signAttemptKey('p2', 'notes', 'dx', s)).not.toBe(k1);
    const k2 = signAttemptKey('p1', 'same', 'dx', s);
    clearSignAttemptKey('p1', s);
    expect(signAttemptKey('p1', 'same', 'dx', s)).not.toBe(k2);
  });
  it('still returns a key when storage is unavailable', () => {
    expect(SIGN_KEY_PATTERN.test(signAttemptKey('p1', 'n', 'd', null))).toBe(true);
  });
});

describe('Task 712: wiring (source guards)', () => {
  const ws = readFileSync('app/(routes)/patients/[id]/patient-profile-workspace.tsx', 'utf8');
  it('both Sign handlers use a synchronous ref guard and the consult Sign sends the key', () => {
    expect(ws).toContain('consultSubmitRef.current');
    expect(ws).toContain('treatmentSubmitRef.current');
    expect(ws).toContain('idempotencyKey: signAttemptKey(');
    expect(ws).toContain('clearSignAttemptKey(patientId)');
  });
  it('/api/orders POST read-merge-write runs under the per-consultation lock; routes pass the key', () => {
    expect(readFileSync('app/api/orders/route.ts', 'utf8')).toContain('withSignLock(`orders|${clinicId}|${consultationId}`');
    expect(readFileSync('app/api/consultations/route.ts', 'utf8')).toContain('idempotencyKey,');
  });
});
