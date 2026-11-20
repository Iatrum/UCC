import { describe, expect, it, spyOn } from 'bun:test';
import { OperationOutcomeError, notFound, type MedplumClient } from '@medplum/core';
import {
  getAppointmentFromMedplum,
  getUpcomingAppointments,
  getUpcomingAppointmentsForClinic,
  saveAppointmentToMedplum,
} from '../../lib/fhir/appointment-service';

// Task 744: fake data only.
const clinic = 'fake-clinic-a';
const own = { system: 'clinic', value: clinic };
const foreign = { system: 'clinic', value: 'fake-clinic-b' };
const appt = (id: string, over: Record<string, any> = {}) => ({
  resourceType: 'Appointment', id, status: 'booked', identifier: [own],
  start: '2030-01-01T10:00:00.000Z', minutesDuration: 20,
  participant: [
    { actor: { display: 'Dr Fake' }, status: 'accepted' },
    { actor: { reference: 'https://fhir.example/fhir/R4/Patient/fake-p1?x=1', display: 'Fake Patient' }, status: 'accepted' },
  ],
  reasonCode: [{ text: 'Fever' }], appointmentType: { text: 'Walk-in' }, comment: 'n',
  meta: { lastUpdated: '2029-12-31T00:00:00.000Z' },
  extension: [
    { url: 'urn:iatrum:appointment/checkin-at', valueDateTime: 'C' },
    { url: 'urn:iatrum:appointment/completed-at', valueDateTime: 'D' },
    { url: 'urn:iatrum:appointment/cancelled-at', valueDateTime: 'X' },
  ],
  ...over,
});

function fake(opts: { rows?: any[]; readError?: unknown; searchError?: boolean } = {}) {
  const searches: any[] = [];
  const created: any[] = [];
  const posts: string[] = [];
  const client = {
    async readResource(type: string, id: string) {
      if (type === 'Organization') return { resourceType: type, id };
      if (type === 'Patient') return { resourceType: type, id, identifier: [own] };
      if (opts.readError) throw opts.readError;
      return structuredClone(opts.rows?.find((r) => r.id === id));
    },
    async searchOne(type: string) { return { resourceType: type, id: 'fake-account-a' }; },
    async searchResources(type: string, params: any) {
      searches.push({ type, params });
      if (opts.searchError) throw new Error('boom');
      return structuredClone(opts.rows ?? []);
    },
    async createResource(r: any) { created.push(r); return { ...r, id: 'fake-new' }; },
    async post(url: string) { posts.push(url); return {}; },
  } as unknown as MedplumClient;
  return { client, searches, created, posts };
}

describe('saveAppointmentToMedplum', () => {
  const base = { patientId: 'fake-p1', patientName: 'Fake Patient', clinician: 'Dr Fake', reason: '', status: 'booked' as const };

  it('computes the end from the duration (default 30 min), stamps the clinic and omits blank optionals', async () => {
    const { client, created, posts } = fake();
    const id = await saveAppointmentToMedplum(client, { ...base, scheduledAt: '2030-03-01T09:00:00.000Z' }, clinic);
    expect(id).toBe('fake-new');
    const r = created[0];
    expect(r.start).toBe('2030-03-01T09:00:00.000Z');
    expect(r.end).toBe('2030-03-01T09:30:00.000Z');
    expect(r.minutesDuration).toBe(30);
    expect(r.reasonCode).toBeUndefined();
    expect(r.appointmentType).toBeUndefined();
    expect(r.identifier).toContainEqual(own);
    expect(r.participant[0].actor.reference).toBe('Patient/fake-p1');
    expect(posts).toEqual(['fhir/R4/Appointment/fake-new/$set-accounts']);
  });

  it('accepts a Date, honours duration/reason/type and uses absolute-time arithmetic', async () => {
    const { client, created } = fake();
    await saveAppointmentToMedplum(client, {
      ...base, reason: 'Review', type: 'Follow-up', notes: 'N', durationMinutes: 45, scheduledAt: new Date('2030-03-31T00:30:00.000Z'),
    }, clinic);
    expect(created[0].end).toBe('2030-03-31T01:15:00.000Z');
    expect(created[0].reasonCode).toEqual([{ text: 'Review' }]);
    expect(created[0].appointmentType).toEqual({ text: 'Follow-up' });
    expect(created[0].comment).toBe('N');
  });

  it('refuses a patient outside the clinic with zero writes', async () => {
    const { client, created } = fake();
    (client as any).readResource = async (type: string, id: string) =>
      type === 'Patient' ? { resourceType: type, id, identifier: [foreign] } : { resourceType: type, id };
    await expect(saveAppointmentToMedplum(client, { ...base, scheduledAt: '2030-03-01T09:00:00.000Z' }, clinic)).rejects.toMatchObject({ outcome: { issue: [{ code: 'forbidden' }] } });
    expect(created).toHaveLength(0);
  });

  it('fails closed with no clinic id (zero writes)', async () => {
    const { client, created } = fake();
    await expect(saveAppointmentToMedplum(client, { ...base, scheduledAt: '2030-03-01T09:00:00.000Z' }, '')).rejects.toMatchObject({ outcome: { issue: [{ code: 'forbidden' }] } });
    expect(created).toHaveLength(0);
  });
});

describe('getAppointmentFromMedplum', () => {
  it('maps participants (absolute Patient URL), extensions and dates', async () => {
    const { client } = fake({ rows: [appt('a1')] });
    const a = (await getAppointmentFromMedplum(client, 'a1'))!;
    expect(a).toMatchObject({
      id: 'a1', patientId: 'fake-p1', patientName: 'Fake Patient', clinician: 'Dr Fake', reason: 'Fever',
      type: 'Walk-in', notes: 'n', durationMinutes: 20, checkinAt: 'C', completedAt: 'D', cancelledAt: 'X',
    });
    expect(a.scheduledAt.toISOString()).toBe('2030-01-01T10:00:00.000Z');
    expect(a.createdAt.toISOString()).toBe('2029-12-31T00:00:00.000Z');
  });

  it('falls back to blanks when optional parts are missing', async () => {
    const { client } = fake({ rows: [appt('a2', { participant: undefined, reasonCode: undefined, extension: undefined, meta: undefined, start: undefined })] });
    const a = (await getAppointmentFromMedplum(client, 'a2'))!;
    expect(a).toMatchObject({ patientId: '', patientName: '', clinician: '', reason: '' });
    expect(a.checkinAt).toBeUndefined();
    expect(a.scheduledAt).toBeInstanceOf(Date);
  });

  it('returns null on 404 and rethrows other errors', async () => {
    const nf = fake({ readError: new OperationOutcomeError(notFound) });
    expect(await getAppointmentFromMedplum(nf.client, 'x')).toBeNull();
    const bad = fake({ readError: new Error('db down') });
    await expect(getAppointmentFromMedplum(bad.client, 'x')).rejects.toThrow('db down');
  });
});

describe('getUpcomingAppointments (unscoped)', () => {
  it('searches from the start of today with the limit and maps rows', async () => {
    const { client, searches } = fake({ rows: [appt('a1')] });
    const out = await getUpcomingAppointments(client, 7);
    expect(out.map((a) => a.id)).toEqual(['a1']);
    expect(searches[0].params._count).toBe('7');
    expect(searches[0].params._sort).toBe('date');
    expect(searches[0].params.date).toMatch(/^ge\d{4}-/);
    expect(searches[0].params.identifier).toBeUndefined();
  });

  it('returns [] when the search fails', async () => {
    const spy = spyOn(console, 'error').mockImplementation(() => {});
    const { client } = fake({ searchError: true });
    expect(await getUpcomingAppointments(client)).toEqual([]);
    spy.mockRestore();
  });
});

describe('getUpcomingAppointmentsForClinic', () => {
  it('puts the clinic in the search, drops foreign rows and maps the rest', async () => {
    const { client, searches } = fake({ rows: [appt('mine'), appt('theirs', { identifier: [foreign] })] });
    const out = await getUpcomingAppointmentsForClinic(client, clinic, 5);
    expect(searches[0].params.identifier).toBe(`clinic|${clinic}`);
    expect(searches[0].params._count).toBe('5');
    expect(out.map((a) => a.id)).toEqual(['mine']);
    expect(out[0].patientId).toBe('fake-p1');
  });

  it('returns [] without searching when the clinic has no tenant (blank clinic id)', async () => {
    const { client, searches } = fake({ rows: [appt('mine')] });
    expect(await getUpcomingAppointmentsForClinic(client, '')).toEqual([]);
    expect(searches).toHaveLength(0);
  });
});
