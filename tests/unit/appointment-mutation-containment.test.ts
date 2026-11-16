import { describe, expect, it } from 'bun:test';
import { OperationOutcomeError, gone, notFound, forbidden, type MedplumClient } from '@medplum/core';
import type { Appointment } from '@medplum/fhirtypes';
import { deleteAppointment, rescheduleAppointment, updateAppointmentStatus } from '../../lib/fhir/appointment-service';
import { ForbiddenError, handleRouteError } from '../../lib/server/route-helpers';

const clinicId = 'fake-clinic-a';
const ownIdentifier = { system: 'clinic', value: clinicId };
const foreignIdentifier = { system: 'clinic', value: 'fake-clinic-b' };
const account = { reference: 'HealthcareService/fake-account-a' };
const foreignAccount = { reference: 'HealthcareService/fake-account-b' };
const initial: Appointment = {
  resourceType: 'Appointment', id: 'fake-appointment', status: 'cancelled',
  identifier: [ownIdentifier], participant: [{ actor: { reference: 'Patient/fake-patient' }, status: 'accepted' }],
  start: '2030-01-01T10:00:00.000Z', end: '2030-01-01T10:45:00.000Z', minutesDuration: 45,
  comment: 'Fake note', extension: [{ url: 'urn:fake:preserved', valueString: 'Fake extension' }],
};

// Fake server with an unrestricted client: no AccessPolicy can mask a missing service guard.
// It hides extended accounts unless explicitly requested, like Medplum.
function fakeServer(overrides: Partial<Appointment> = {}, readError?: Error) {
  let stored: Appointment | undefined = structuredClone({ ...initial, ...overrides });
  const reads: { type: string; id: string; options: any }[] = [];
  const writes: { method: string; resource?: Appointment; type?: string; id?: string }[] = [];
  const client = {
    async readResource(type: string, id: string, options: any) {
      reads.push({ type, id, options });
      if (type === 'Organization') return { resourceType: type, id };
      if (readError) throw readError;
      if (!stored) throw new OperationOutcomeError(gone);
      const result = structuredClone(stored);
      if (options?.headers?.['X-Medplum'] !== 'extended') delete (result.meta as any)?.accounts;
      return result;
    },
    async searchOne(type: string) {
      return type === 'HealthcareService' ? { resourceType: type, id: 'fake-account-a' } : undefined;
    },
    async updateResource(resource: Appointment) {
      writes.push({ method: 'PUT', resource: structuredClone(resource) });
      stored = structuredClone(resource);
      return resource;
    },
    async deleteResource(type: string, id: string) {
      writes.push({ method: 'DELETE', type, id });
      stored = undefined;
    },
  } as unknown as MedplumClient;
  return { client, reads, writes, stored: () => stored };
}

const cases = [
  { name: 'updateAppointmentStatus', run: (m: MedplumClient, clinic: string) => updateAppointmentStatus(m, initial.id!, 'arrived', clinic) },
  { name: 'rescheduleAppointment', run: (m: MedplumClient, clinic: string) => rescheduleAppointment(m, initial.id!, '2030-02-01T11:00:00.000Z', clinic) },
  { name: 'deleteAppointment', run: (m: MedplumClient, clinic: string) => deleteAppointment(m, initial.id!, clinic) },
];

for (const c of cases) describe(c.name, () => {
  for (const [name, overrides, caller] of [
    ['foreign clinic', { identifier: [foreignIdentifier] }, clinicId],
    ['missing clinic', {}, ''],
    ['untagged appointment', { identifier: [] }, clinicId],
    ['absent identifier and meta', { identifier: undefined, meta: undefined }, clinicId],
    ['untagged with matching compartment', { identifier: undefined, meta: { compartment: [{ reference: `Organization/${clinicId}` }] } }, clinicId],
    ['undefined clinic', {}, undefined],
    ['null clinic', {}, null],
    ['empty clinic identifier', { identifier: [{ system: 'clinic' }] }, clinicId],
    ['foreign singular account', { meta: { account: foreignAccount } }, clinicId],
    ['foreign singular account array', { meta: { account: [foreignAccount] } }, clinicId],
    ['conflicting clinic identifiers', { identifier: [ownIdentifier, foreignIdentifier] }, clinicId],
    ['foreign account despite own identifier', { meta: { accounts: [foreignAccount] } }, clinicId],
    ['mixed accounts despite own identifier', { meta: { accounts: [account, foreignAccount] } }, clinicId],
  ] as const) {
    it(`${name} => ForbiddenError / 403 and zero writes`, async () => {
      const server = fakeServer(overrides as Partial<Appointment>);
      const before = structuredClone(server.stored());
      let error: unknown;
      try { await c.run(server.client, caller as string); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(handleRouteError(error, 'fake appointment containment')).toHaveProperty('status', 403);
      expect(server.writes).toHaveLength(0);
      expect(server.stored()).toEqual(before);
      if (!caller) expect(server.reads).toHaveLength(0);
    });
  }

  for (const [name, outcome] of [['missing', notFound], ['deleted', gone]] as const) {
    it(`${name} appointment returns 404 with zero writes`, async () => {
      const server = fakeServer({}, new OperationOutcomeError(outcome));
      let error: unknown;
      try { await c.run(server.client, clinicId); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(Error);
      expect(handleRouteError(error, 'fake appointment read')).toHaveProperty('status', 404);
      expect(server.writes).toHaveLength(0);
      expect(server.stored()).toEqual(initial);
    });
  }

  it('permission failure propagates with zero writes', async () => {
    const failure = new OperationOutcomeError(forbidden);
    const server = fakeServer({}, failure);
    await expect(c.run(server.client, clinicId)).rejects.toBe(failure);
    expect(server.writes).toHaveLength(0);
  });

  for (const extended of [false, true]) it(`own clinic succeeds (${extended ? 'with account' : 'identifier only'})`, async () => {
    const server = fakeServer(extended ? { meta: { accounts: [account] } } as any : {});
    await c.run(server.client, clinicId);
    expect(server.reads[0]).toEqual({ type: 'Appointment', id: initial.id, options: { cache: 'no-cache', headers: { 'X-Medplum': 'extended' } } });
    expect(server.writes).toHaveLength(1);
    if (c.name === 'deleteAppointment') {
      expect(server.writes[0]).toEqual({ method: 'DELETE', type: 'Appointment', id: initial.id });
      expect(server.stored()).toBeUndefined();
    } else {
      const result = server.stored()!;
      expect(result.identifier).toEqual(initial.identifier);
      expect(result.participant).toEqual(initial.participant);
      expect(result.comment).toBe(initial.comment);
      expect(result.extension).toContainEqual(initial.extension![0]);
      if (extended) expect((result.meta as any).accounts).toEqual([account]);
      if (c.name === 'updateAppointmentStatus') {
        expect(result.status).toBe('arrived');
        expect(result.start).toBe(initial.start);
        expect(result.extension).toContainEqual({ url: 'urn:iatrum:appointment/checkin-at', valueDateTime: expect.any(String) });
      } else {
        expect(result.start).toBe('2030-02-01T11:00:00.000Z');
        expect(result.end).toBe('2030-02-01T11:45:00.000Z');
        expect(result.status).toBe('booked');
      }
    }
  });
});
