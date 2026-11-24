import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from 'bun:test';
import { NextRequest } from 'next/server';
import { POST as book } from '../../app/api/scheduling/book/route';
import { POST as manualBook } from '../../app/api/scheduling/manual-book/route';
import { GET as listSchedules, POST as ensureSchedule } from '../../app/api/scheduling/schedules/route';
import { POST as generateSlots } from '../../app/api/scheduling/slots/generate/route';
import { GET as listSlots } from '../../app/api/scheduling/slots/route';
import * as auth from '@/lib/server/medplum-auth';
import { AuthError } from '@/lib/server/route-helpers';
import { CLINIC_A, CLINIC_B, createMockMedplum, tenantResources } from './helpers/mock-medplum';

const scheduleSystem = 'urn:iatrum:schedule:clinic-practitioner';
const practitionerId = 'fake-practitioner';
const practitionerName = 'Fake Practitioner';
const patientId = 'fake-patient-a';
const foreignPatientId = 'fake-patient-b';
const scheduleId = 'fake-schedule-a';
const foreignScheduleId = 'fake-schedule-b';
const slotId = 'fake-slot-a';
const foreignSlotId = 'fake-slot-b';
const start = '2030-06-03T01:00:00.000Z';
const end = '2030-06-03T01:30:00.000Z';
const windowEnd = '2030-06-03T02:00:00.000Z';
const ownIdentifier = { system: 'clinic', value: CLINIC_A };

function setup() {
  return createMockMedplum([
    ...tenantResources(CLINIC_A),
    ...tenantResources(CLINIC_B),
    ...[
      [CLINIC_A, patientId, scheduleId, slotId],
      [CLINIC_B, foreignPatientId, foreignScheduleId, foreignSlotId],
    ].flatMap(([clinicId, patient, schedule, slot]) => {
      const identifier = [{ system: 'clinic', value: clinicId }];
      return [
        { resourceType: 'Patient', id: patient, identifier, name: [{ text: 'Fake Patient' }] },
        {
          resourceType: 'Schedule',
          id: schedule,
          identifier: [...identifier, { system: scheduleSystem, value: `${clinicId}:${practitionerId}` }],
          actor: [{ reference: `Practitioner/${practitionerId}`, display: practitionerName }],
        },
        {
          resourceType: 'Slot', id: slot, identifier, status: 'free', start, end,
          schedule: { reference: `Schedule/${schedule}` },
        },
      ];
    }),
  ]);
}

function get(path: string, query: Record<string, string> = {}) {
  return new NextRequest(`http://ucc.invalid/api/scheduling/${path}?${new URLSearchParams(query)}`);
}

function post(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://ucc.invalid/api/scheduling/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

let medplum: ReturnType<typeof setup>;
let authenticate: ReturnType<typeof spyOn<typeof auth, 'requireClinicAuth'>>;
let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>>;

beforeEach(() => {
  medplum = setup();
  setSystemTime(new Date('2030-06-01T00:00:00.000Z'));
  fetchSpy = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network disabled in scheduling route tests'));
  authenticate = spyOn(auth, 'requireClinicAuth').mockResolvedValue({ medplum: medplum.client, clinicId: CLINIC_A });
});

afterEach(() => {
  try {
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    authenticate.mockRestore();
    fetchSpy.mockRestore();
    setSystemTime();
  }
});

describe('scheduling route guards', () => {
  const routes = [
    ['POST book', book, () => post('book', {})],
    ['POST manual-book', manualBook, () => post('manual-book', {})],
    ['GET schedules', listSchedules, () => get('schedules')],
    ['POST schedules', ensureSchedule, () => post('schedules', {})],
    ['GET slots', listSlots, () => get('slots')],
    ['POST slots/generate', generateSlots, () => post('slots/generate', {})],
  ] as const;

  it.each(routes)('%s returns 401 without a session', async (_route, handle, request) => {
    authenticate.mockRejectedValue(new AuthError('Missing fake session'));

    const response = await handle(request());

    expect(response.status).toBe(401);
    expect(medplum.searches).toEqual([]);
    expect(medplum.writes).toEqual([]);
  });

  it.each(routes)('%s requires clinic context', async (_route, handle, request) => {
    authenticate.mockResolvedValue({ medplum: medplum.client, clinicId: '' });

    const response = await handle(request());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Clinic context is required' });
    expect(medplum.searches).toEqual([]);
    expect(medplum.writes).toEqual([]);
  });

  it.each(routes.filter(([route]) => route !== 'GET schedules'))('%s rejects missing required fields', async (_route, handle, request) => {
    const response = await handle(request());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.stringMatching(/^Missing /) });
    expect(medplum.searches).toEqual([]);
    expect(medplum.writes).toEqual([]);
  });
});

describe('scheduling schedule and slot routes', () => {
  it('lists only schedules in the authenticated clinic', async () => {
    const response = await listSchedules(get('schedules', { clinicId: CLINIC_B }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true, count: 1, schedules: [{ id: scheduleId, practitionerId, practitionerName }],
    });
    expect(medplum.searches.find(({ type }) => type === 'Schedule')?.params)
      .toContainEqual(['identifier', `clinic|${CLINIC_A}`]);
  });

  it('creates a schedule in the authenticated clinic despite a different clinic in the body', async () => {
    const newPractitionerId = 'fake-new-practitioner';
    const response = await ensureSchedule(post('schedules', {
      practitionerId: newPractitionerId, practitionerName, clinicId: CLINIC_B,
    }));

    expect(response.status).toBe(200);
    const [created] = medplum.creates('Schedule');
    expect(created).toMatchObject({
      identifier: [{ system: scheduleSystem, value: `${CLINIC_A}:${newPractitionerId}` }, ownIdentifier],
      actor: [{ reference: `Practitioner/${newPractitionerId}`, display: practitionerName }],
    });
    expect(await response.json()).toEqual({
      success: true, schedule: { id: created.id, practitionerId: newPractitionerId, practitionerName },
    });
  });

  it('lists free slots only for the authenticated clinic and returns no slots for a foreign schedule', async () => {
    const response = await listSlots(get('slots', { start, end }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      count: 1,
      slots: [{ id: slotId, scheduleId, practitionerId, practitionerName, start, end, status: 'free' }],
    });
    const slotSearches = medplum.searches.filter(({ type }) => type === 'Slot');
    expect(slotSearches).toHaveLength(1);
    expect(slotSearches[0].params).toEqual(expect.arrayContaining([
      ['schedule', `Schedule/${scheduleId}`], ['identifier', `clinic|${CLINIC_A}`],
    ]));

    const foreign = await listSlots(get('slots', { start, end, scheduleId: foreignScheduleId }));
    expect(foreign.status).toBe(200);
    expect(await foreign.json()).toEqual({ success: true, count: 0, slots: [] });
    expect(medplum.searches.filter(({ type }) => type === 'Slot')).toEqual(slotSearches);
  });

  it('denies slot generation for another clinic’s schedule without writing', async () => {
    const response = await generateSlots(post('slots/generate', {
      scheduleId: foreignScheduleId, start, end,
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'You do not have permission to perform this action.' });
    expect(medplum.writes).toEqual([]);
  });

  it('generates only missing slots and tags them with the authenticated clinic', async () => {
    const response = await generateSlots(post('slots/generate', {
      scheduleId, start, end: windowEnd, clinicId: CLINIC_B,
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, scheduleId, created: 1, existing: 1 });
    expect(medplum.creates('Slot')).toEqual([
      expect.objectContaining({
        identifier: [ownIdentifier], status: 'free', start: end, end: windowEnd,
        schedule: { reference: `Schedule/${scheduleId}` },
      }),
    ]);
  });

  it('requires a schedule or practitioner before doing any writes', async () => {
    const response = await generateSlots(post('slots/generate', { start, end }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Missing practitionerId or scheduleId' });
    expect(medplum.writes).toEqual([]);
  });

  it('creates a schedule for a practitioner before generating slots', async () => {
    const newPractitionerId = 'fake-new-practitioner';
    const response = await generateSlots(post('slots/generate', {
      practitionerId: newPractitionerId, practitionerName, start, end,
    }));

    expect(response.status).toBe(200);
    const [schedule] = medplum.creates('Schedule');
    expect(schedule.identifier).toContainEqual(ownIdentifier);
    expect(await response.json()).toEqual({ success: true, scheduleId: schedule.id, created: 1, existing: 0 });
    expect(medplum.creates('Slot')).toEqual([
      expect.objectContaining({ identifier: [ownIdentifier], schedule: { reference: `Schedule/${schedule.id}` } }),
    ]);
  });

  it.each([
    ['an invalid date', { start: 'not-a-date' }, 'Invalid slot generation window'],
    ['a reversed time range', { start: end, end: start }, 'Invalid slot generation window'],
    ['a zero duration', { durationMinutes: 0 }, 'durationMinutes must be a positive number'],
    ['a duration outside the Date range', { durationMinutes: Number.MAX_VALUE }, 'durationMinutes is out of range'],
  ] as const)('rejects %s before creating a schedule or slots', async (_label, invalid, message) => {
    const response = await generateSlots(post('slots/generate', {
      practitionerId: 'fake-new-practitioner', start, end, ...invalid,
    }));

    expect(medplum.writes).toEqual([]);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: message });
  });
});

describe('scheduling booking routes', () => {
  const booking = { slotId, patientId, reason: 'Fake reason' };
  const manual = { patientId, practitionerId, scheduledAt: start, reason: 'Fake reason' };

  it.each([
    ['book', book, booking],
    ['manual-book', manualBook, manual],
  ] as const)('%s denies booking a patient from another clinic without writing', async (path, handle, input) => {
    const response = await handle(post(path, { ...input, patientId: foreignPatientId, clinicId: CLINIC_B }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Patient not found in clinic scope' });
    expect(medplum.writes).toEqual([]);
  });

  it('denies booking a slot in another clinic without writing', async () => {
    const response = await book(post('book', { ...booking, slotId: foreignSlotId }));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'You do not have permission to perform this action.' });
    expect(medplum.writes).toEqual([]);
  });

  it.each([
    ['book', book, booking],
    ['manual-book', manualBook, manual],
  ] as const)('%s books the clinic slot and creates a clinic-scoped appointment', async (path, handle, input) => {
    const response = await handle(post(path, { ...input, clinicId: CLINIC_B }));

    expect(response.status).toBe(200);
    const [appointment] = medplum.creates('Appointment');
    expect(await response.json()).toEqual({ success: true, appointmentId: appointment.id, slotId });
    expect(appointment).toMatchObject({
      identifier: [ownIdentifier], status: 'booked', start, end,
      slot: [{ reference: `Slot/${slotId}` }],
      participant: expect.arrayContaining([
        expect.objectContaining({ actor: expect.objectContaining({ reference: `Patient/${patientId}` }) }),
      ]),
    });
    expect(medplum.stored('Slot', slotId)).toMatchObject({ identifier: [ownIdentifier], status: 'busy' });
    expect(medplum.stored('Slot', foreignSlotId)?.status).toBe('free');
    expect(medplum.creates('Communication')).toEqual([
      expect.objectContaining({
        identifier: expect.arrayContaining([ownIdentifier]),
        subject: expect.objectContaining({ reference: `Patient/${patientId}` }),
      }),
    ]);
  });

  it('creates its own slot for manual booking when only another clinic has a slot at that time', async () => {
    medplum.db.delete(`Slot/${slotId}`);
    const foreignSlot = medplum.stored('Slot', foreignSlotId);

    const response = await manualBook(post('manual-book', manual));

    expect(response.status).toBe(200);
    expect(medplum.creates('Slot')).toEqual([
      expect.objectContaining({
        identifier: [ownIdentifier], status: 'busy', start, end,
        schedule: { reference: `Schedule/${scheduleId}` },
      }),
    ]);
    const [created] = medplum.creates('Slot');
    const [appointment] = medplum.creates('Appointment');
    expect(await response.json()).toEqual({ success: true, appointmentId: appointment.id, slotId: created.id });
    expect(medplum.stored('Slot', foreignSlotId)).toEqual(foreignSlot);
  });

  it('returns 409 when a manual booking overlaps a busy slot', async () => {
    medplum.db.set(`Slot/${slotId}`, { ...medplum.stored('Slot', slotId), resourceType: 'Slot', status: 'busy' });

    const response = await manualBook(post('manual-book', manual));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Selected time overlaps an unavailable slot for this clinician' });
    expect(medplum.writes).toEqual([]);
  });
});
