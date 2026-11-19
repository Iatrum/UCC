import { afterEach, beforeEach, describe, expect, it, setSystemTime, spyOn } from 'bun:test';
import { NextRequest } from 'next/server';
import type { Encounter, Extension } from '@medplum/fhirtypes';
import * as appointments from '../../app/api/appointments/route';
import * as patients from '../../app/api/patients/route';
import * as queue from '../../app/api/queue/route';
import * as triage from '../../app/api/triage/route';
import * as admin from '@/lib/server/medplum-admin';
import * as auth from '@/lib/server/medplum-auth';
import { CLINIC_A, CLINIC_B, createMockMedplum, tenantResources } from './helpers/mock-medplum';

const TRIAGE_ENCOUNTER_EXTENSION_URL = 'https://ucc.emr/triage-encounter';
const own = { system: 'clinic', value: CLINIC_A };
const foreign = { system: 'clinic', value: CLINIC_B };
const patientId = 'fake-own-patient';
const foreignPatientId = 'fake-foreign-patient';
const registration = {
  fullName: 'Fake Registration',
  nric: '000000000000',
  dateOfBirth: '2000-02-29',
  gender: 'other',
};
const booking = {
  patientId,
  patientName: 'Fake Patient',
  clinician: 'Fake Clinician',
  reason: 'Fake follow-up',
  status: 'booked',
  scheduledAt: '2099-03-05T02:00:00.000Z',
  reminderDaysBefore: 2,
};

function request(route: string, body: Record<string, unknown>, method = 'POST') {
  return new NextRequest(`http://ucc.invalid/api/${route}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, clinicId: CLINIC_B }),
  });
}

function setup() {
  const fake = createMockMedplum([
    ...tenantResources(CLINIC_A),
    ...tenantResources(CLINIC_B),
    { resourceType: 'Patient', id: patientId, identifier: [own], name: [{ text: 'Fake Patient' }] },
    { resourceType: 'Patient', id: foreignPatientId, identifier: [foreign] },
  ]);
  Object.assign(fake.client, {
    getProfileAsync: async () => ({ resourceType: 'Practitioner', id: 'fake-registration-staff' }),
  });
  return fake;
}

let medplum: ReturnType<typeof setup>;
let spies: Array<{ mockRestore(): void }>;

beforeEach(() => {
  medplum = setup();
  setSystemTime(new Date('2030-03-05T02:15:30.000Z'));
  spies = [
    spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network calls are disabled in Task 700')),
    spyOn(auth, 'requireClinicAuth').mockResolvedValue({ medplum: medplum.client, clinicId: CLINIC_A }),
    spyOn(auth, 'getCurrentProfile').mockResolvedValue({
      resourceType: 'Practitioner', id: 'fake-triage-staff', name: [{ text: 'Fake Triage Staff' }],
    }),
    spyOn(admin, 'getAdminMedplum').mockResolvedValue(medplum.client),
  ];
});

afterEach(() => {
  try {
    expect(globalThis.fetch).not.toHaveBeenCalled();
  } finally {
    for (const spy of spies) spy.mockRestore();
    setSystemTime();
  }
});

describe('POST /api/patients registration', () => {
  it.each(['fullName', 'nric', 'dateOfBirth', 'gender'])('rejects missing %s before using the admin client', async (field: string) => {
    const response = await patients.POST(request('patients', { ...registration, [field]: undefined }));

    expect(response.status).toBe(400);
    expect(admin.getAdminMedplum).not.toHaveBeenCalled();
    expect(medplum.writes).toEqual([]);
  });

  it.each(['nric', 'ic'])('returns a conflict for a same-clinic duplicate in the %s identifier system', async (system: string) => {
    medplum.db.set(`Patient/${patientId}`, {
      resourceType: 'Patient', id: patientId,
      identifier: [own, { system, value: registration.nric }],
      name: [{ text: 'Fake Existing Registration' }],
    });

    const response = await patients.POST(request('patients', registration));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: 'DUPLICATE_NRIC',
      existingPatientId: patientId,
      existingPatientName: 'Fake Existing Registration',
    });
    expect(medplum.writes).toEqual([]);
  });

  it('registers in the authenticated clinic when only another clinic has the same identifier', async () => {
    const foreignPatient = {
      resourceType: 'Patient', id: foreignPatientId,
      identifier: [foreign, { system: 'nric', value: registration.nric }],
    };
    medplum.db.set(`Patient/${foreignPatientId}`, foreignPatient);

    const response = await patients.POST(request('patients', registration));

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toEqual({
      success: true,
      patientId: 'patient-1',
      message: 'Patient saved to FHIR successfully',
    });
    expect(medplum.creates('Patient')).toEqual([
      expect.objectContaining({
        id: result.patientId,
        identifier: [{ system: 'nric', value: registration.nric }, own],
        name: [{ text: registration.fullName, family: 'Registration', given: ['Fake'] }],
        birthDate: registration.dateOfBirth,
        managingOrganization: { reference: `Organization/org-${CLINIC_A}` },
      }),
    ]);
    expect(medplum.stored('Patient', foreignPatientId)).toEqual(foreignPatient);
  });
});

function queueExtension(encounter: Encounter): Extension[] {
  return encounter.extension?.find(({ url }) => url === TRIAGE_ENCOUNTER_EXTENSION_URL)?.extension ?? [];
}

describe('queue check-in and triage routes', () => {
  it('reuses the checked-in encounter for triage and advances it into consultation', async () => {
    const checkIn = await queue.POST(request('queue', { patientId }));
    expect(checkIn.status).toBe(200);
    expect(await checkIn.json()).toEqual({ success: true });
    const [encounter] = medplum.creates('Encounter');
    expect(encounter).toMatchObject({ status: 'arrived', subject: { reference: `Patient/${patientId}` } });
    const encounterId = encounter.id!;
    const foreignVisit = { ...encounter, id: 'fake-foreign-visit', status: 'finished', identifier: [foreign] };
    medplum.db.set(`Encounter/${foreignVisit.id}`, foreignVisit);
    const search = spyOn(medplum.client, 'searchResources');
    spies.push(search);

    const triaged = await triage.POST(request('triage', { patientId, triageLevel: 3, chiefComplaint: 'Fake complaint' }));
    expect(triaged.status).toBe(200);
    expect(await triaged.json()).toEqual({ success: true, encounterId });
    const triagedVisit = await medplum.client.readResource('Encounter', encounterId);
    expect(triagedVisit.status).toBe('triaged');
    expect(queueExtension(triagedVisit)).toEqual(expect.arrayContaining([
      { url: 'queueStatus', valueString: 'waiting' },
      { url: 'triageBy', valueString: 'Fake Triage Staff' },
      { url: 'isTriaged', valueBoolean: true },
    ]));
    expect(medplum.creates('Observation')).toEqual([
      expect.objectContaining({
        identifier: [own],
        subject: { reference: `Patient/${patientId}` },
        encounter: { reference: `Encounter/${encounterId}` },
        valueString: 'Fake complaint',
      }),
    ]);

    const update = await queue.PATCH(request('queue', { patientId, status: 'in_consultation' }, 'PATCH'));
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({ success: true, patientId, finalQueueStatus: 'in_consultation' });
    const visit = await medplum.client.readResource('Encounter', encounterId);
    expect(visit).toMatchObject({ status: 'in-progress', identifier: [own], period: encounter.period });
    expect(queueExtension(visit)).toContainEqual({ url: 'queueStatus', valueString: 'in_consultation' });
    expect(medplum.creates('Encounter')).toHaveLength(1);

    const clear = await queue.PATCH(request('queue', { patientId, status: null }, 'PATCH'));
    expect(clear.status).toBe(200);
    expect(await clear.json()).toEqual({ success: true, patientId, finalQueueStatus: null });
    const clearedVisit = await medplum.client.readResource('Encounter', encounterId);
    expect(clearedVisit.status).toBe('finished');
    expect(queueExtension(clearedVisit).map(({ url }) => url)).not.toContain('queueStatus');
    expect(medplum.updates('Encounter').map(({ id }) => id)).toEqual([
      encounterId, encounterId, encounterId,
    ]);
    const encounterSearches = search.mock.calls.filter(([type]) => type === 'Encounter');
    expect(encounterSearches).toHaveLength(3);
    for (const [, params] of encounterSearches) {
      expect(params).toMatchObject({ subject: `Patient/${patientId}`, identifier: `clinic|${CLINIC_A}` });
    }
    expect(medplum.stored('Encounter', foreignVisit.id)).toEqual(foreignVisit);
  });

  it('rejects check-in to another clinic’s patient even if the body names that clinic', async () => {
    const response = await queue.POST(request('queue', { patientId: foreignPatientId }));

    expect(response.status).toBe(403);
    expect(medplum.writes).toEqual([]);
  });

  it('rejects an out-of-range triage level without writing', async () => {
    const response = await triage.POST(request('triage', {
      patientId, triageLevel: 6, chiefComplaint: 'Fake complaint',
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid triage level' });
    expect(medplum.writes).toEqual([]);
  });

  it('rejects triage for a foreign patient without writing an encounter or observation', async () => {
    const response = await triage.POST(request('triage', {
      patientId: foreignPatientId, triageLevel: 3, chiefComplaint: 'Fake complaint',
    }));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Patient not found' });
    expect(medplum.writes).toEqual([]);
  });

  it.each([
    ['an unknown string', 'unknown-status'],
    ['a boolean', false],
  ] as const)('rejects %s as a queue status without changing the active visit', async (_case, status) => {
    const checkIn = await queue.POST(request('queue', { patientId }));
    expect(checkIn.status).toBe(200);
    const [encounter] = medplum.creates('Encounter');
    medplum.writes.length = 0;

    const response = await queue.PATCH(request('queue', { patientId, status }, 'PATCH'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Invalid queue status' });
    expect(medplum.writes).toEqual([]);
    expect(medplum.stored('Encounter', encounter.id!)).toEqual(encounter);
  });
});

describe('appointment booking and cancellation routes', () => {
  it('creates a clinic-scoped booking and records its reminder', async () => {
    const response = await appointments.POST(request('appointments', booking));

    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ success: true, appointmentId: 'appointment-1' });
    expect(medplum.stored('Appointment', result.appointmentId)).toMatchObject({
      status: 'booked',
      start: booking.scheduledAt,
      end: '2099-03-05T02:30:00.000Z',
      identifier: [own],
      participant: [
        { status: 'accepted', actor: { reference: `Patient/${patientId}`, display: booking.patientName } },
        { status: 'accepted', actor: { display: booking.clinician } },
      ],
    });
    expect(medplum.creates('Communication')).toEqual([
      expect.objectContaining({
        identifier: expect.arrayContaining([own]),
        status: 'preparation',
        subject: { reference: `Patient/${patientId}`, display: booking.patientName },
        extension: expect.arrayContaining([
          { url: 'https://ucc.emr/communication/source-id', valueString: result.appointmentId },
        ]),
      }),
    ]);
    const [reminder] = medplum.creates('Communication');
    expect(reminder.identifier.filter(({ system }: { system: string }) => system === 'clinic')).toEqual([own]);
  });

  it('returns a successful booking when reminder persistence fails', async () => {
    const createResource = medplum.client.createResource;
    const write = spyOn(medplum.client, 'createResource');
    spies.push(write);
    // Keep the real fake-client persistence for the appointment and fail just the reminder.
    const createWithReminderFailure: typeof createResource = async (resource, options) => {
      if (resource.resourceType === 'Communication') throw new Error('Fake reminder write failed');
      return createResource(resource, options);
    };
    write.mockImplementation(createWithReminderFailure);

    const response = await appointments.POST(request('appointments', booking));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(medplum.creates('Appointment')).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(expect.objectContaining({ resourceType: 'Communication' }));
  });

  it('rejects an incomplete booking before writing', async () => {
    const response = await appointments.POST(request('appointments', { ...booking, scheduledAt: undefined }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Missing required fields' });
    expect(medplum.writes).toEqual([]);
  });

  it('rejects a booking for a patient in another clinic without writing', async () => {
    const response = await appointments.POST(request('appointments', { ...booking, patientId: foreignPatientId }));

    expect(response.status).toBe(403);
    expect(medplum.writes).toEqual([]);
  });

  it('cancels an existing booking through PATCH and preserves the appointment record', async () => {
    const appointmentId = 'fake-booking';
    medplum.db.set(`Appointment/${appointmentId}`, {
      resourceType: 'Appointment', id: appointmentId, status: 'booked', identifier: [own],
      start: booking.scheduledAt,
      participant: [{ status: 'accepted', actor: { reference: `Patient/${patientId}` } }],
    });
    const response = await appointments.PATCH(request('appointments', { appointmentId, status: 'cancelled' }, 'PATCH'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true });
    expect(medplum.updates('Appointment')).toHaveLength(1);
    expect(medplum.stored('Appointment', appointmentId)).toMatchObject({
      id: appointmentId, status: 'cancelled', start: booking.scheduledAt, identifier: [own],
    });
    expect(medplum.writes.some(({ op }) => op === 'delete')).toBe(false);
  });
});
