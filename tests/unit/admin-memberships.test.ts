import { expect, test } from 'bun:test';
import type { MedplumClient } from '@medplum/core';
import { getPractitionersFromMedplum } from '../../lib/fhir/admin-service';

test('membership lookup consumes later pages, ignores other projects, and preserves no-login status', async () => {
  let completed = false;
  const membership = (id: string, project: string, active: boolean) => ({
    resourceType: 'ProjectMembership', id,
    project: { reference: `Project/${project}` },
    profile: { reference: 'Practitioner/target' }, active,
  });
  const client = {
    get: async () => ({ project: { id: 'managed' } }),
    searchResources: async (type: string) => type === 'Practitioner'
      ? ['target', 'no-login'].map(id => ({ resourceType: 'Practitioner', id })) : [],
    searchResourcePages: async function* () {
      yield Array.from({ length: 500 }, (_, i) => ({
        ...membership(`filler-${i}`, 'managed', true),
        profile: { reference: `Practitioner/filler-${i}` },
      }));
      yield [membership('target-membership', 'managed', false)];
      yield [membership('foreign-membership', 'foreign', true)];
      completed = true;
    },
  } as unknown as MedplumClient;
  const users = await getPractitionersFromMedplum(client);
  expect(completed).toBe(true);
  expect(users.find(u => u.id === 'target')?.active).toBe(false);
  expect(users.find(u => u.id === 'no-login')?.active).toBeNull();
});

test('revoked Medplum session returns 401 rather than a server error', async () => {
  const { OperationOutcomeError, unauthorized } = await import('@medplum/core');
  const { handleRouteError } = await import('../../lib/server/route-helpers');
  const response = handleRouteError(new OperationOutcomeError(unauthorized));
  expect(response.status).toBe(401);
});
