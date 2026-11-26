import { expect, mock, spyOn, test } from 'bun:test';
import type { MedplumClient } from '@medplum/core';
import { NextRequest } from 'next/server';
import { POST } from '../../app/(routes)/api/labs/subscription/route';
import * as modules from '../../lib/module-registry';
import * as devices from '../../lib/fhir/poct-device';
import * as auth from '../../lib/server/medplum-auth';

test('subscription keeps the clinic and module gates and quietly falls back when transport is unavailable', async () => {
  const searchOne = mock(async (_type: string, params: Record<string, string>) =>
    params._id === 'fake-patient' && params.identifier === 'clinic|fake-clinic' ? { id: params._id } : undefined);
  const createResource = mock(async () => { throw new Error('Unsupported socket'); });
  const medplum = { searchOne, createResource } as unknown as MedplumClient;
  const login = spyOn(auth, 'requireClinicAuth').mockResolvedValue({ medplum, clinicId: 'fake-clinic' } as Awaited<ReturnType<typeof auth.requireClinicAuth>>);
  const enabled = spyOn(modules, 'isModuleEnabledForClinic');
  const analysers = spyOn(devices, 'listPoctAnalysers').mockResolvedValue([]);
  const post = (patientId = 'fake-patient') => POST(new NextRequest('http://localhost/api/labs/subscription', {
    method: 'POST', body: JSON.stringify({ patientId }),
  }));

  try {
    enabled.mockResolvedValue(false);
    expect((await post()).status).toBe(403);
    enabled.mockImplementation(async (module) => module === 'poct');
    expect((await post('other-clinic-patient')).status).toBe(403);
    expect(analysers).not.toHaveBeenCalled();
    const polling = await post();
    expect(polling.status).toBe(204);
    expect(await polling.text()).toBe('');
    expect(analysers).toHaveBeenCalledWith('fake-clinic');
    expect(createResource).not.toHaveBeenCalled();

    enabled.mockImplementation(async (module) => module === 'pacs');
    const fallback = await post();
    expect(fallback.status).toBe(204);
    expect(fallback.headers.get('cache-control')).toBe('no-store');
    expect(createResource).toHaveBeenCalledTimes(1);
  } finally {
    login.mockRestore();
    enabled.mockRestore();
    analysers.mockRestore();
  }
});
