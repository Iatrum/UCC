import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import {
  bookSlotToAppointment, ensureClinicianSchedule, findSlots, generateSlotsForSchedule, manualBookAppointmentWithSlot,
} from '../../lib/fhir/scheduling-service';
import { ForbiddenError } from '../../lib/server/route-helpers';
import { CLINIC_A, CLINIC_B, createMockMedplum, tenantResources } from './helpers/mock-medplum';

const own = [{ system: 'clinic', value: CLINIC_A }];
const SCHED_SYS = 'urn:iatrum:schedule:clinic-practitioner';

function setup(extra: any[] = []) {
  return createMockMedplum([
    ...tenantResources(CLINIC_A),
    ...tenantResources(CLINIC_B),
    { resourceType: 'Practitioner', id: 'dr1', name: [{ given: ['Fake'], family: 'Doctor' }] },
    { resourceType: 'Patient', id: 'p1', identifier: own, name: [{ text: 'Fake Patient' }] },
    {
      resourceType: 'Schedule', id: 's1', active: true,
      identifier: [{ system: SCHED_SYS, value: `${CLINIC_A}:dr1` }, ...own],
      actor: [{ reference: 'Practitioner/dr1', display: 'Dr Fake' }],
    },
    ...extra,
  ]);
}
const gen = (m: ReturnType<typeof setup>, start: string, end: string, durationMinutes: number, scheduleId = 's1') =>
  generateSlotsForSchedule(m.client, CLINIC_A, { scheduleId, start, end, durationMinutes });
const starts = (m: ReturnType<typeof setup>) => m.creates('Slot').map((s) => s.start);

afterEach(() => setSystemTime());

describe('generateSlotsForSchedule', () => {
  it('creates back-to-back slots filling the window exactly', async () => {
    const m = setup();
    const r = await gen(m, '2030-06-03T01:00:00.000Z', '2030-06-03T02:30:00.000Z', 30);
    expect(r).toEqual({ created: 3, existing: 0 });
    expect(m.creates('Slot').map((s) => [s.start, s.end])).toEqual([
      ['2030-06-03T01:00:00.000Z', '2030-06-03T01:30:00.000Z'],
      ['2030-06-03T01:30:00.000Z', '2030-06-03T02:00:00.000Z'],
      ['2030-06-03T02:00:00.000Z', '2030-06-03T02:30:00.000Z'],
    ]);
  });

  it('drops a trailing partial slot', async () => {
    const m = setup();
    const r = await gen(m, '2030-06-03T01:00:00.000Z', '2030-06-03T02:20:00.000Z', 30);
    expect(r.created).toBe(2);
    expect(starts(m)).toEqual(['2030-06-03T01:00:00.000Z', '2030-06-03T01:30:00.000Z']);
  });

  it('creates nothing when the window is shorter than one slot', async () => {
    const m = setup();
    expect(await gen(m, '2030-06-03T01:00:00.000Z', '2030-06-03T01:10:00.000Z', 15)).toEqual({ created: 0, existing: 0 });
    expect(m.writes).toHaveLength(0);
  });

  it('stamps free status, schedule ref, clinic identifier and tenant account on each slot', async () => {
    const m = setup();
    await gen(m, '2030-06-03T01:00:00.000Z', '2030-06-03T01:30:00.000Z', 30);
    const slot = m.creates('Slot')[0];
    expect(slot).toMatchObject({ status: 'free', schedule: { reference: 'Schedule/s1' }, identifier: own });
    expect(slot.meta.accounts).toEqual([{ reference: `HealthcareService/acct-${CLINIC_A}` }]);
    const posts = m.writes.filter((w) => w.op === 'post');
    expect(posts).toHaveLength(1);
    expect(posts[0].path).toBe('fhir/R4/Slot/slot-1/$set-accounts');
  });

  it('is idempotent: re-running over existing starts creates only the missing ones', async () => {
    const m = setup();
    await gen(m, '2030-06-03T01:00:00.000Z', '2030-06-03T02:00:00.000Z', 30);
    const again = await gen(m, '2030-06-03T01:00:00.000Z', '2030-06-03T03:00:00.000Z', 30);
    expect(again).toEqual({ created: 2, existing: 2 });
    expect(m.creates('Slot')).toHaveLength(4);
  });

  it('rejects invalid windows and durations without writing', async () => {
    const m = setup();
    const ok = ['2030-06-03T01:00:00.000Z', '2030-06-03T02:00:00.000Z'] as const;
    await expect(gen(m, 'nope', ok[1], 30)).rejects.toThrow('Invalid slot generation window');
    await expect(gen(m, ok[0], 'nope', 30)).rejects.toThrow('Invalid slot generation window');
    await expect(gen(m, ok[1], ok[0], 30)).rejects.toThrow('Invalid slot generation window');
    await expect(gen(m, ok[0], ok[0], 30)).rejects.toThrow('Invalid slot generation window');
    for (const d of [0, -5, NaN, Infinity]) await expect(gen(m, ok[0], ok[1], d)).rejects.toThrow('durationMinutes');
    expect(m.writes).toHaveLength(0);
  });

  it('refuses a schedule that belongs to another clinic', async () => {
    const m = setup([{
      resourceType: 'Schedule', id: 's-foreign',
      identifier: [{ system: SCHED_SYS, value: `${CLINIC_B}:dr1` }],
    }]);
    // Task 645/422: a caller-supplied foreign reference is a 403 (ForbiddenError), not a generic 500 Error.
    const err = await gen(m, '2030-06-03T01:00:00.000Z', '2030-06-03T02:00:00.000Z', 30, 's-foreign').catch((e) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect(err.message).toBe('Schedule unavailable in current clinic');
    expect(m.writes).toHaveLength(0);
  });

  it('refuses a schedule whose practitioner identifier is ours but carries no clinic tenant marker (Task 728)', async () => {
    const m = setup([{
      resourceType: 'Schedule', id: 's-untenanted',
      identifier: [{ system: SCHED_SYS, value: `${CLINIC_A}:dr1` }],
    }]);
    await expect(gen(m, '2030-06-03T01:00:00.000Z', '2030-06-03T02:00:00.000Z', 30, 's-untenanted')).rejects.toBeInstanceOf(ForbiddenError);
    expect(m.writes).toHaveLength(0);
  });

  it('refuses a schedule with no clinic identifier at all', async () => {
    const m = setup([{ resourceType: 'Schedule', id: 's-bare', actor: [{ reference: 'Practitioner/dr1' }] }]);
    await expect(gen(m, '2030-06-03T01:00:00.000Z', '2030-06-03T02:00:00.000Z', 30, 's-bare')).rejects.toBeInstanceOf(ForbiddenError);
    expect(m.writes).toHaveLength(0);
  });

  it('exact instants are timezone independent (whole-hour offsets)', async () => {
    const m = setup();
    await gen(m, '2030-06-03T16:00:00.000Z', '2030-06-03T17:00:00.000Z', 20);
    expect(starts(m)).toEqual(['2030-06-03T16:00:00.000Z', '2030-06-03T16:20:00.000Z', '2030-06-03T16:40:00.000Z']);
  });

  // Regression: duration was added with local-time Date#setMinutes, which skews slot ends across a DST
  // fall-back in a non-UTC server TZ (e.g. TZ=America/New_York, 2030-11-03). Instants must be absolute.
  it('keeps every slot exactly durationMinutes long across a DST boundary', async () => {
    const m = setup();
    await gen(m, '2030-11-03T05:00:00.000Z', '2030-11-03T08:00:00.000Z', 30);
    const slots = m.creates('Slot');
    expect(slots).toHaveLength(6);
    for (const s of slots) expect(Date.parse(s.end) - Date.parse(s.start)).toBe(30 * 60000);
    expect(slots.at(-1)!.end).toBe('2030-11-03T08:00:00.000Z');
  });

  it('keeps slots absolute across the spring-forward boundary too', async () => {
    const m = setup();
    await gen(m, '2030-03-10T06:00:00.000Z', '2030-03-10T09:00:00.000Z', 45);
    const slots = m.creates('Slot');
    expect(slots).toHaveLength(4);
    for (const s of slots) expect(Date.parse(s.end) - Date.parse(s.start)).toBe(45 * 60000);
  });
});

describe('findSlots', () => {
  const slot = (id: string, start: string, end: string, status = 'free', schedule = 's1') => ({
    resourceType: 'Slot', id, status, start, end, schedule: { reference: `Schedule/${schedule}` }, identifier: own,
  });
  const find = (m: ReturnType<typeof setup>, input: any) => findSlots(m.client, CLINIC_A, input);
  const W = { start: '2030-06-03T00:00:00.000Z', end: '2030-06-03T12:00:00.000Z' };

  it('returns slots inside the window sorted by start, with practitioner mapping', async () => {
    const m = setup([
      slot('b', '2030-06-03T03:00:00.000Z', '2030-06-03T03:30:00.000Z'),
      slot('a', '2030-06-03T01:00:00.000Z', '2030-06-03T01:30:00.000Z'),
    ]);
    const r = await find(m, W);
    expect(r.map((s) => s.id)).toEqual(['a', 'b']);
    expect(r[0]).toMatchObject({ scheduleId: 's1', practitionerId: 'dr1', practitionerName: 'Dr Fake', status: 'free' });
  });

  it('requires slots to lie fully inside the window (boundaries inclusive)', async () => {
    const m = setup([
      slot('in', '2030-06-03T00:00:00.000Z', '2030-06-03T00:30:00.000Z'),
      slot('edge', '2030-06-03T11:30:00.000Z', '2030-06-03T12:00:00.000Z'),
      slot('straddle-end', '2030-06-03T11:45:00.000Z', '2030-06-03T12:15:00.000Z'),
      slot('straddle-start', '2030-06-02T23:45:00.000Z', '2030-06-03T00:15:00.000Z'),
    ]);
    expect((await find(m, W)).map((s) => s.id)).toEqual(['in', 'edge']);
  });

  it('filters by status and drops slots with missing or invalid times', async () => {
    const m = setup([
      slot('free', '2030-06-03T01:00:00.000Z', '2030-06-03T01:30:00.000Z'),
      slot('busy', '2030-06-03T02:00:00.000Z', '2030-06-03T02:30:00.000Z', 'busy'),
      { ...slot('bad', 'x', 'y') },
      { resourceType: 'Slot', id: 'nostart', status: 'free', schedule: { reference: 'Schedule/s1' }, identifier: own },
    ]);
    expect((await find(m, { ...W, status: 'busy' })).map((s) => s.id)).toEqual(['busy']);
    expect((await find(m, W)).map((s) => s.id)).toEqual(['free', 'busy']);
  });

  it('filters by schedule/practitioner and returns [] when none selected', async () => {
    const m = setup([slot('a', '2030-06-03T01:00:00.000Z', '2030-06-03T01:30:00.000Z')]);
    expect(await find(m, { ...W, practitionerId: 'someone-else' })).toEqual([]);
    expect(await find(m, { ...W, scheduleId: 'nope' })).toEqual([]);
    expect((await find(m, { ...W, practitionerId: 'dr1', scheduleId: 's1' }))).toHaveLength(1);
  });

  it('rejects an invalid or inverted search window', async () => {
    const m = setup();
    await expect(find(m, { start: 'x', end: W.end })).rejects.toThrow('Invalid slot search window');
    await expect(find(m, { start: W.end, end: W.start })).rejects.toThrow('Invalid slot search window');
  });

  it('never returns slots lacking this clinic identifier', async () => {
    const m = setup([{ ...slot('foreign', '2030-06-03T01:00:00.000Z', '2030-06-03T01:30:00.000Z'), identifier: [{ system: 'clinic', value: CLINIC_B }] }]);
    expect(await find(m, W)).toEqual([]);
  });
});

describe('ensureClinicianSchedule / bookSlotToAppointment / manualBook', () => {
  it('ensureClinicianSchedule reuses an own-clinic schedule and creates a missing one', async () => {
    const m = setup();
    expect((await ensureClinicianSchedule(m.client, { clinicId: CLINIC_A, practitionerId: 'dr1' })).id).toBe('s1');
    expect(m.writes).toHaveLength(0);
    const created = await ensureClinicianSchedule(m.client, { clinicId: CLINIC_A, practitionerId: 'dr2', practitionerName: 'Dr Two' });
    expect(created).toMatchObject({ practitionerId: 'dr2', practitionerName: 'Dr Two' });
    const sched = m.creates('Schedule')[0];
    expect(sched.identifier).toContainEqual({ system: SCHED_SYS, value: `${CLINIC_A}:dr2` });
    expect(sched.identifier).toContainEqual({ system: 'clinic', value: CLINIC_A });
  });

  it('bookSlotToAppointment books a free slot and marks it busy', async () => {
    const m = setup([{ resourceType: 'Slot', id: 'sl1', status: 'free', start: '2030-06-03T01:00:00.000Z', end: '2030-06-03T01:30:00.000Z', schedule: { reference: 'Schedule/s1' }, identifier: own }]);
    const r = await bookSlotToAppointment(m.client, CLINIC_A, { slotId: 'sl1', patientId: 'p1', reason: 'Fake reason' });
    expect(r.slotId).toBe('sl1');
    const appt = m.creates('Appointment')[0];
    expect(appt).toMatchObject({ status: 'booked', start: '2030-06-03T01:00:00.000Z', minutesDuration: 30, slot: [{ reference: 'Slot/sl1' }] });
    expect(appt.participant[0].actor.display).toBe('Fake Patient');
    expect((m.stored('Slot', 'sl1') as any).status).toBe('busy');
  });

  it('bookSlotToAppointment refuses a non-free slot and a foreign schedule without writing', async () => {
    const m = setup([
      { resourceType: 'Slot', id: 'busy', status: 'busy', schedule: { reference: 'Schedule/s1' }, identifier: own },
      { resourceType: 'Schedule', id: 'sf', identifier: [{ system: SCHED_SYS, value: `${CLINIC_B}:dr1` }] },
      { resourceType: 'Slot', id: 'fs', status: 'free', schedule: { reference: 'Schedule/sf' } },
    ]);
    await expect(bookSlotToAppointment(m.client, CLINIC_A, { slotId: 'busy', patientId: 'p1', reason: '' })).rejects.toThrow('no longer available');
    await expect(bookSlotToAppointment(m.client, CLINIC_A, { slotId: 'fs', patientId: 'p1', reason: '' })).rejects.toThrow();
    expect(m.writes).toHaveLength(0);
  });

  describe('manualBookAppointmentWithSlot', () => {
    beforeEach(() => setSystemTime(new Date('2030-06-01T00:00:00.000Z')));
    const input = { patientId: 'p1', practitionerId: 'dr1', scheduledAt: '2030-06-03T01:00:00.000Z', durationMinutes: 30, reason: 'Fake' };

    it('creates a busy slot + booked appointment when no free slot matches', async () => {
      const m = setup();
      await manualBookAppointmentWithSlot(m.client, CLINIC_A, input);
      expect(m.creates('Slot')[0]).toMatchObject({ status: 'busy', start: input.scheduledAt, end: '2030-06-03T01:30:00.000Z' });
      expect(m.creates('Appointment')[0]).toMatchObject({ status: 'booked', end: '2030-06-03T01:30:00.000Z' });
    });

    it('reuses an exact free slot instead of creating one', async () => {
      const m = setup([{ resourceType: 'Slot', id: 'free1', status: 'free', start: input.scheduledAt, end: '2030-06-03T01:30:00.000Z', schedule: { reference: 'Schedule/s1' }, identifier: own }]);
      await manualBookAppointmentWithSlot(m.client, CLINIC_A, input);
      expect(m.creates('Slot')).toHaveLength(0);
      expect((m.stored('Slot', 'free1') as any).status).toBe('busy');
    });

    it('rejects past/invalid times and bad durations before any write', async () => {
      const m = setup();
      await expect(manualBookAppointmentWithSlot(m.client, CLINIC_A, { ...input, scheduledAt: 'x' })).rejects.toThrow('Invalid appointment');
      await expect(manualBookAppointmentWithSlot(m.client, CLINIC_A, { ...input, scheduledAt: '2030-06-01T00:00:00.000Z' })).rejects.toThrow('future');
      await expect(manualBookAppointmentWithSlot(m.client, CLINIC_A, { ...input, durationMinutes: 0 })).rejects.toThrow('durationMinutes');
      expect(m.writes).toHaveLength(0);
    });

    it('rejects overlap with an unavailable slot or an active appointment, allows touching intervals', async () => {
      const busy = { resourceType: 'Slot', id: 'b', status: 'busy', start: '2030-06-03T01:15:00.000Z', end: '2030-06-03T01:45:00.000Z', schedule: { reference: 'Schedule/s1' }, identifier: own };
      await expect(manualBookAppointmentWithSlot(setup([busy]).client, CLINIC_A, input)).rejects.toThrow('unavailable slot');

      const active = { resourceType: 'Appointment', id: 'ap', status: 'booked', identifier: own, start: '2030-06-03T00:45:00.000Z', end: '2030-06-03T01:15:00.000Z', participant: [{ actor: { reference: 'Practitioner/dr1' } }] };
      await expect(manualBookAppointmentWithSlot(setup([active]).client, CLINIC_A, input)).rejects.toThrow('active appointment');

      const cancelled = { ...active, status: 'cancelled' };
      const touching = { ...active, id: 'ap2', start: '2030-06-03T00:30:00.000Z', end: '2030-06-03T01:00:00.000Z' };
      const m = setup([cancelled, touching]);
      await manualBookAppointmentWithSlot(m.client, CLINIC_A, input);
      expect(m.creates('Appointment')).toHaveLength(1);
    });
  });
});
