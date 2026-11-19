import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { checkInPatientInTriage, getActiveTriageEncounter, updateQueueStatusForPatient } from '../../lib/fhir/triage-service';
import { CLINIC_A, CLINIC_B, createMockMedplum, tenantResources } from './helpers/mock-medplum';

const NOW = '2030-03-05T02:15:30.000Z';
const EXT = 'https://ucc.emr/triage-encounter';
const own = [{ system: 'clinic', value: CLINIC_A }];

function triageEncounter(over: Record<string, any> = {}, queue: Record<string, any> | null = { status: 'waiting', addedAt: '2030-03-05T01:00:00.000Z' }) {
  const sub: any[] = [];
  if (queue) {
    if (queue.status) sub.push({ url: 'queueStatus', valueString: queue.status });
    if (queue.addedAt) sub.push({ url: 'queueAddedAt', valueDateTime: queue.addedAt });
  }
  sub.push({ url: 'isTriaged', valueBoolean: true });
  return {
    resourceType: 'Encounter', id: 'e1', status: 'triaged', identifier: own,
    subject: { reference: 'Patient/p1' }, period: { start: '2030-03-05T01:00:00.000Z' },
    extension: [{ url: 'urn:fake:other', valueString: 'keep' }, { url: EXT, extension: sub }],
    ...over,
  };
}
function setup(encounters: any[] = [triageEncounter()]) {
  return createMockMedplum([
    ...tenantResources(CLINIC_A), ...tenantResources(CLINIC_B),
    { resourceType: 'Patient', id: 'p1', identifier: own },
    ...encounters,
  ]);
}
const sub = (enc: any, url: string) => enc.extension.find((e: any) => e.url === EXT).extension.find((e: any) => e.url === url);
const update = (m: ReturnType<typeof setup>, status: any, clinic: string | undefined = CLINIC_A) =>
  updateQueueStatusForPatient('p1', status, m.client, clinic);

beforeEach(() => setSystemTime(new Date(NOW)));
afterEach(() => setSystemTime());

describe('updateQueueStatusForPatient: queue status -> Encounter status', () => {
  const map: [string, string][] = [
    ['arrived', 'arrived'], ['waiting', 'triaged'], ['in_consultation', 'in-progress'],
    ['completed', 'finished'], ['meds_and_bills', 'finished'],
  ];
  for (const [queue, enc] of map) {
    it(`${queue} -> Encounter.status ${enc}, queueStatus extension updated`, async () => {
      const m = setup();
      await update(m, queue);
      const stored = m.stored('Encounter', 'e1') as any;
      expect(stored.status).toBe(enc);
      expect(sub(stored, 'queueStatus').valueString).toBe(queue);
    });
  }

  it('finishing stamps period.end with now and keeps period.start', async () => {
    for (const q of ['completed', 'meds_and_bills']) {
      const m = setup();
      await update(m, q);
      expect((m.stored('Encounter', 'e1') as any).period).toEqual({ start: '2030-03-05T01:00:00.000Z', end: NOW });
    }
  });

  it('non-finishing statuses do not set period.end', async () => {
    const m = setup();
    await update(m, 'in_consultation');
    expect((m.stored('Encounter', 'e1') as any).period.end).toBeUndefined();
  });

  it('finishing creates a period when the encounter has none', async () => {
    const m = setup([triageEncounter({ period: undefined })]);
    await update(m, 'completed');
    expect((m.stored('Encounter', 'e1') as any).period).toEqual({ end: NOW });
  });

  it('keeps the original queueAddedAt; falls back to now when absent', async () => {
    const m = setup();
    await update(m, 'in_consultation');
    expect(sub(m.stored('Encounter', 'e1'), 'queueAddedAt').valueDateTime).toBe('2030-03-05T01:00:00.000Z');
  });

  it('arrived resets isTriaged to false; other statuses leave it alone', async () => {
    const m = setup();
    await update(m, 'in_consultation');
    expect(sub(m.stored('Encounter', 'e1'), 'isTriaged').valueBoolean).toBe(true);
    await update(m, 'arrived');
    expect(sub(m.stored('Encounter', 'e1'), 'isTriaged').valueBoolean).toBe(false);
  });

  it('null clears queue fields and finishes the encounter, preserving other sub-extensions', async () => {
    const m = setup();
    await update(m, null);
    const stored = m.stored('Encounter', 'e1') as any;
    expect(stored.status).toBe('finished');
    expect(sub(stored, 'queueStatus')).toBeUndefined();
    expect(sub(stored, 'queueAddedAt')).toBeUndefined();
    expect(sub(stored, 'isTriaged')).toBeDefined();
  });

  it('preserves unrelated extensions, subject and clinic identifier', async () => {
    const m = setup();
    await update(m, 'completed');
    const stored = m.stored('Encounter', 'e1') as any;
    expect(stored.extension[0]).toEqual({ url: 'urn:fake:other', valueString: 'keep' });
    expect(stored.subject).toEqual({ reference: 'Patient/p1' });
    expect(stored.identifier).toEqual(own);
  });

  it('re-asserts the tenant account on every write', async () => {
    const m = setup();
    await update(m, 'waiting');
    const posts = m.writes.filter((w) => w.op === 'post');
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe('fhir/R4/Encounter/e1/$set-accounts');
    expect(posts[0].body.parameter[0].valueReference.reference).toBe(`HealthcareService/acct-${CLINIC_A}`);
  });

  it('falls back to the Encounter status when no queueStatus sub-extension exists (legacy data)', async () => {
    const m = setup([triageEncounter({ status: 'in-progress' }, null)]);
    expect((await getActiveTriageEncounter('p1', m.client, CLINIC_A))?.queueStatus).toBe('in_consultation');
    const m2 = setup([triageEncounter({ status: 'finished' }, null)]);
    expect((await getActiveTriageEncounter('p1', m2.client, CLINIC_A))?.queueStatus).toBe('completed');
  });
});

describe('updateQueueStatusForPatient: no / foreign encounter', () => {
  it('throws for non-arrived status when there is no active triage encounter, writing nothing', async () => {
    const m = setup([]);
    await expect(update(m, 'waiting')).rejects.toThrow('No active triage encounter found');
    expect(m.writes).toHaveLength(0);
  });

  it('ignores a consultation Encounter without the triage extension', async () => {
    const m = setup([{ resourceType: 'Encounter', id: 'consult', status: 'finished', identifier: own, subject: { reference: 'Patient/p1' } }]);
    await expect(update(m, 'in_consultation')).rejects.toThrow('No active triage encounter found');
  });

  it("'arrived' with no encounter checks the patient in (creates an arrived encounter)", async () => {
    const m = setup([]);
    await update(m, 'arrived');
    const [enc] = m.creates('Encounter');
    expect(enc).toMatchObject({ status: 'arrived', subject: { reference: 'Patient/p1' }, period: { start: NOW }, identifier: own });
    expect(sub(enc, 'queueStatus').valueString).toBe('arrived');
    expect(sub(enc, 'isTriaged').valueBoolean).toBe(false);
  });

  it("never reads another clinic's encounter", async () => {
    const m = setup([triageEncounter({ identifier: [{ system: 'clinic', value: CLINIC_B }] })]);
    await expect(update(m, 'completed')).rejects.toThrow('No active triage encounter found');
    expect(m.updates()).toHaveLength(0);
  });
});

describe('checkInPatientInTriage transitions', () => {
  const checkIn = (m: ReturnType<typeof setup>, complaint?: string) =>
    checkInPatientInTriage('p1', complaint, undefined, m.client, CLINIC_A);

  it('creates a new arrived encounter with queue + metadata extensions', async () => {
    const m = setup([]);
    const id = await checkInPatientInTriage('p1', 'Fake cough', { visitIntent: 'consult', payerType: 'self', performedBy: 'Fake Nurse' }, m.client, CLINIC_A);
    const enc = m.creates('Encounter')[0];
    expect(id).toBe('encounter-1');
    expect(enc.class.code).toBe('AMB');
    const urls = enc.extension.map((e: any) => e.url);
    expect(urls).toEqual([EXT, 'visitIntent', 'payerType', 'performedBy']);
    expect(sub(enc, 'queueAddedAt').valueDateTime).toBe(NOW);
    expect(m.creates('Observation')).toHaveLength(1);
  });

  it('does not create a chief-complaint Observation when none is given', async () => {
    const m = setup([]);
    await checkIn(m);
    expect(m.creates('Observation')).toHaveLength(0);
  });

  for (const status of ['arrived', 'waiting', 'in_consultation']) {
    it(`reuses an active ${status} visit and resets it to arrived (no new encounter)`, async () => {
      const m = setup([triageEncounter({}, { status, addedAt: '2030-03-05T01:00:00.000Z' })]);
      expect(await checkIn(m)).toBe('e1');
      expect(m.creates('Encounter')).toHaveLength(0);
      expect(sub(m.stored('Encounter', 'e1'), 'queueStatus').valueString).toBe('arrived');
      expect((m.stored('Encounter', 'e1') as any).status).toBe('arrived');
    });
  }

  it('returns a meds_and_bills visit untouched', async () => {
    const m = setup([triageEncounter({ status: 'finished' }, { status: 'meds_and_bills' })]);
    expect(await checkIn(m)).toBe('e1');
    expect(m.writes).toHaveLength(0);
  });

  it('does not resurrect a completed visit: a new encounter is created', async () => {
    const m = setup([triageEncounter({ status: 'finished' }, { status: 'completed' })]);
    const id = await checkIn(m);
    expect(id).not.toBe('e1');
    expect(m.creates('Encounter')).toHaveLength(1);
    expect((m.stored('Encounter', 'e1') as any).status).toBe('finished');
  });

  it('rejects a patient from another clinic before writing', async () => {
    const m = setup([]);
    m.db.set('Patient/p1', { resourceType: 'Patient', id: 'p1', identifier: [{ system: 'clinic', value: CLINIC_B }] });
    await expect(checkIn(m)).rejects.toThrow();
    expect(m.writes).toHaveLength(0);
  });

  it('fails closed without a clinic id', async () => {
    const m = setup([]);
    await expect(checkInPatientInTriage('p1', undefined, undefined, m.client, undefined)).rejects.toThrow();
    expect(m.writes).toHaveLength(0);
  });
});
