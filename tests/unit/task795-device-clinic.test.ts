import { describe, expect, test } from 'bun:test';
import type { Device } from '@medplum/fhirtypes';
import {
  deviceForClinic as poctDeviceForClinic,
  POCT_PROPERTY_SYSTEM,
  POCT_TYPE_SYSTEM,
} from '../../lib/fhir/poct-device';
import {
  deviceForClinic as xrayDeviceForClinic,
  XRAY_PROPERTY_SYSTEM,
  XRAY_TYPE_SYSTEM,
} from '../../lib/fhir/xray-device';

const now = Date.parse('2026-01-01T12:00:00Z');
const clinicId = 'clinic-a';

const devices = [
  {
    name: 'POCT analyser',
    project: poctDeviceForClinic,
    typeSystem: POCT_TYPE_SYSTEM,
    propertySystem: POCT_PROPERTY_SYSTEM,
    kind: { analyserType: 'hematology' },
    code: 'hematology',
  },
  {
    name: 'X-ray device',
    project: xrayDeviceForClinic,
    typeSystem: XRAY_TYPE_SYSTEM,
    propertySystem: XRAY_PROPERTY_SYSTEM,
    kind: { deviceType: 'DX' },
    code: 'DX',
  },
];

for (const { name, project, typeSystem, propertySystem, kind, code } of devices) {
  function fixture(heartbeat?: string): Device {
    return {
      resourceType: 'Device',
      id: 'test-device',
      status: 'active',
      identifier: [{ system: 'clinic', value: clinicId }],
      type: { coding: [{ system: typeSystem, code }] },
      property: heartbeat === undefined ? undefined : [{
        type: { coding: [{ system: propertySystem, code: 'last-heartbeat' }] },
        valueCode: [{ text: heartbeat }],
      }],
    };
  }

  describe(`${name} clinic and online checks`, () => {
    test('requires the requested clinic identifier and the expected device coding system', () => {
      const device = fixture();
      expect(project(device, 'clinic-b', now)).toBeUndefined();
      expect(project({ ...device, identifier: undefined }, clinicId, now)).toBeUndefined();
      expect(project({ ...device, identifier: [{ system: 'serial', value: clinicId }] }, clinicId, now)).toBeUndefined();
      expect(project({ ...device, type: { coding: [{ system: 'other', code }] } }, clinicId, now)).toBeUndefined();
    });

    test('accepts an active device at the 90-second heartbeat cutoff', () => {
      const lastHeartbeat = new Date(now - 90_000).toISOString();
      expect(project(fixture(lastHeartbeat), clinicId, now)).toEqual({
        id: 'test-device',
        name,
        ...kind,
        lastHeartbeat,
        online: true,
      });
    });

    test.each([
      ['missing', undefined],
      ['malformed', 'invalid-date'],
      ['stale', new Date(now - 90_001).toISOString()],
      ['in the future', new Date(now + 1).toISOString()],
    ])('reports the device offline when its heartbeat is %s', (_label, heartbeat) => {
      expect(project(fixture(heartbeat), clinicId, now)?.online).toBe(false);
    });

    test('reports an inactive device offline even with a fresh heartbeat', () => {
      const device = { ...fixture(new Date(now).toISOString()), status: 'inactive' } as const;
      expect(project(device, clinicId, now)?.online).toBe(false);
    });
  });
}
