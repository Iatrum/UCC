// Fixture Devices are fake (named "Fake ...", clinic-scoped, deleted in `finally`). The app hides Devices tagged
// `simulated` in production builds (lib/fhir/{poct,xray}-device.ts), and the gate runs a production build, so the
// tag is opt-in (UCC_E2E_SIMULATED_TAG=1, dev server only) instead of hiding the fixture from the code under test.
import type { Device } from '@medplum/fhirtypes';

export function deviceMeta(system: string): Pick<Device, 'meta'> {
  return process.env.UCC_E2E_SIMULATED_TAG === '1' ? { meta: { tag: [{ system, code: 'simulated' }] } } : {};
}
