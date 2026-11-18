import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { rescheduleAppointment, updateAppointmentStatus } from '../../lib/fhir/appointment-service';
import { CLINIC_A, createMockMedplum, tenantResources } from './helpers/mock-medplum';

const NOW = '2030-03-05T02:15:30.000Z';
const own = [{ system: 'clinic', value: CLINIC_A }];

function setup(appt: Record<string, any> = {}) {
  return createMockMedplum([
    ...tenantResources(CLINIC_A),
    { resourceType: 'Patient', id: 'p1', identifier: own },
    {
      resourceType: 'Appointment', id: 'a1', status: 'booked', identifier: own,
      participant: [{ actor: { reference: 'Patient/p1' }, status: 'accepted' }],
      start: '2030-04-01T10:00:00.000Z', end: '2030-04-01T10:45:00.000Z', minutesDuration: 45,
      ...appt,
    },
  ]);
}
const ext = (m: ReturnType<typeof setup>, url: string) =>
  (m.stored('Appointment', 'a1') as any).extension?.filter((e: any) => e.url === url) ?? [];

beforeEach(() => setSystemTime(new Date(NOW)));
afterEach(() => setSystemTime());

describe('updateAppointmentStatus timestamp stamping', () => {
  const cases: [string, string][] = [
    ['arrived', 'urn:iatrum:appointment/checkin-at'],
    ['fulfilled', 'urn:iatrum:appointment/completed-at'],
    ['cancelled', 'urn:iatrum:appointment/cancelled-at'],
    ['noshow', 'urn:iatrum:appointment/cancelled-at'],
  ];
  for (const [status, url] of cases) {
    it(`${status} stamps ${url.split('/')[1]} with the current instant`, async () => {
      const m = setup();
      await updateAppointmentStatus(m.client, 'a1', status as any, CLINIC_A);
      expect((m.stored('Appointment', 'a1') as any).status).toBe(status);
      expect(ext(m, url)).toEqual([{ url, valueDateTime: NOW }]);
    });
  }

  for (const status of ['proposed', 'pending', 'booked']) {
    it(`${status} writes status without stamping any timestamp`, async () => {
      const m = setup();
      await updateAppointmentStatus(m.client, 'a1', status as any, CLINIC_A);
      const stored = m.stored('Appointment', 'a1') as any;
      expect(stored.status).toBe(status);
      expect(stored.extension).toBeUndefined();
    });
  }

  it('does not overwrite an existing timestamp (first check-in wins)', async () => {
    const url = 'urn:iatrum:appointment/checkin-at';
    const m = setup({ extension: [{ url, valueDateTime: '2030-03-01T00:00:00.000Z' }] });
    await updateAppointmentStatus(m.client, 'a1', 'arrived', CLINIC_A);
    expect(ext(m, url)).toEqual([{ url, valueDateTime: '2030-03-01T00:00:00.000Z' }]);
  });

  it('preserves unrelated extensions and adds the stamp after them', async () => {
    const other = { url: 'urn:fake:keep', valueString: 'x' };
    const m = setup({ extension: [other] });
    await updateAppointmentStatus(m.client, 'a1', 'fulfilled', CLINIC_A);
    const exts = (m.stored('Appointment', 'a1') as any).extension;
    expect(exts[0]).toEqual(other);
    expect(exts[1]).toEqual({ url: 'urn:iatrum:appointment/completed-at', valueDateTime: NOW });
  });

  it('keeps pre-existing extensions when moving to a non-stamping status', async () => {
    const other = { url: 'urn:fake:keep', valueString: 'x' };
    const m = setup({ extension: [other] });
    await updateAppointmentStatus(m.client, 'a1', 'booked', CLINIC_A);
    expect((m.stored('Appointment', 'a1') as any).extension).toEqual([other]);
  });

  it('noshow after cancelled keeps the original cancelled-at (shared checkpoint)', async () => {
    const m = setup();
    await updateAppointmentStatus(m.client, 'a1', 'cancelled', CLINIC_A);
    setSystemTime(new Date('2030-03-06T00:00:00.000Z'));
    await updateAppointmentStatus(m.client, 'a1', 'noshow', CLINIC_A);
    expect(ext(m, 'urn:iatrum:appointment/cancelled-at')).toEqual([
      { url: 'urn:iatrum:appointment/cancelled-at', valueDateTime: NOW },
    ]);
    expect((m.stored('Appointment', 'a1') as any).status).toBe('noshow');
  });

  it('preserves other appointment fields', async () => {
    const m = setup({ comment: 'Fake note' });
    await updateAppointmentStatus(m.client, 'a1', 'arrived', CLINIC_A);
    const s = m.stored('Appointment', 'a1') as any;
    expect(s.comment).toBe('Fake note');
    expect(s.start).toBe('2030-04-01T10:00:00.000Z');
    expect(s.identifier).toEqual(own);
  });
});

describe('rescheduleAppointment', () => {
  it('moves start/end using stored minutesDuration (UTC instant, TZ independent)', async () => {
    const m = setup();
    await rescheduleAppointment(m.client, 'a1', '2030-05-01T23:30:00.000Z', CLINIC_A);
    const s = m.stored('Appointment', 'a1') as any;
    expect(s.start).toBe('2030-05-01T23:30:00.000Z');
    expect(s.end).toBe('2030-05-02T00:15:00.000Z');
  });

  // Regression: end was computed with server-local Date#setMinutes, skewed across a DST fall-back (TZ=America/New_York).
  it('end is exactly minutesDuration after start across a DST boundary', async () => {
    const m = setup();
    await rescheduleAppointment(m.client, 'a1', '2030-11-03T05:30:00.000Z', CLINIC_A);
    expect((m.stored('Appointment', 'a1') as any).end).toBe('2030-11-03T06:15:00.000Z');
  });

  it('defaults to 30 minutes when duration is missing', async () => {
    const m = setup({ minutesDuration: undefined });
    await rescheduleAppointment(m.client, 'a1', new Date('2030-05-01T10:00:00.000Z'), CLINIC_A);
    expect((m.stored('Appointment', 'a1') as any).end).toBe('2030-05-01T10:30:00.000Z');
  });

  it('normalises an offset input to a UTC ISO instant', async () => {
    const m = setup();
    await rescheduleAppointment(m.client, 'a1', '2030-05-01T09:00:00+08:00', CLINIC_A);
    expect((m.stored('Appointment', 'a1') as any).start).toBe('2030-05-01T01:00:00.000Z');
  });

  for (const [from, to] of [
    ['cancelled', 'booked'], ['noshow', 'booked'],
    ['booked', 'booked'], ['arrived', 'arrived'], ['fulfilled', 'fulfilled'], ['pending', 'pending'],
  ]) {
    it(`status ${from} -> ${to}`, async () => {
      const m = setup({ status: from });
      await rescheduleAppointment(m.client, 'a1', '2030-05-01T10:00:00.000Z', CLINIC_A);
      expect((m.stored('Appointment', 'a1') as any).status).toBe(to);
    });
  }

  it('does not clear a previous cancelled-at stamp when reviving', async () => {
    const e = { url: 'urn:iatrum:appointment/cancelled-at', valueDateTime: '2030-03-01T00:00:00.000Z' };
    const m = setup({ status: 'cancelled', extension: [e] });
    await rescheduleAppointment(m.client, 'a1', '2030-05-01T10:00:00.000Z', CLINIC_A);
    expect((m.stored('Appointment', 'a1') as any).extension).toEqual([e]);
  });

  it('rejects an invalid date without writing', async () => {
    const m = setup();
    await expect(rescheduleAppointment(m.client, 'a1', 'not-a-date', CLINIC_A)).rejects.toThrow();
    expect(m.writes).toHaveLength(0);
  });
});
