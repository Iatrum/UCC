import { describe, expect, test } from 'bun:test';
import { clinicStaffPolicyDrift, clinicStaffPolicyResources, CLINIC_COMPARTMENT_TYPES } from '../../lib/fhir/clinic-access-policy';

describe('UCC Clinic Staff Policy definition', () => {
  const rules = clinicStaffPolicyResources();

  test('staff can never create a Patient directly (registration goes through the server route)', () => {
    const patient = rules.filter((rule) => rule.resourceType === 'Patient');
    expect(patient.length).toBeGreaterThan(0);
    for (const rule of patient) expect(rule.interaction).not.toContain('create');
  });

  test('every clinical create rule strips caller meta and constrains accounts', () => {
    const creates = rules.filter((rule) => (rule.interaction ?? []).includes('create') && CLINIC_COMPARTMENT_TYPES.includes(rule.resourceType as never));
    for (const rule of creates) {
      if (!rule.criteria && rule.readonlyFields) expect(rule.readonlyFields).toContain('meta');
    }
  });

  test('MedicationDispense stays accessible for checkout stock-deduction audit writes', () => {
    expect(rules.some((rule) => rule.resourceType === 'MedicationDispense')).toBe(true);
  });
});

describe('clinicStaffPolicyDrift', () => {
  test('in-sync policy has no drift', () => {
    expect(clinicStaffPolicyDrift(clinicStaffPolicyResources())).toEqual([]);
  });

  test('legacy policy with a single full-access Patient rule is flagged', () => {
    const legacy = clinicStaffPolicyResources().filter((rule) => rule.resourceType !== 'Patient');
    legacy.push({ resourceType: 'Patient', criteria: 'Patient?_compartment=%clinicAccount', interaction: ['create', 'read', 'update', 'delete', 'search', 'history', 'vread'] });
    const problems = clinicStaffPolicyDrift(legacy);
    expect(problems.some((p) => p.includes('Patient rule still grants "create"'))).toBe(true);
    expect(problems.some((p) => p.includes('missing'))).toBe(true);
  });

  test('missing policy (undefined) reports every rule missing', () => {
    expect(clinicStaffPolicyDrift(undefined).length).toBe(1);
  });
});
