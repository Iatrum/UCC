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

describe('UCC Clinic Staff Policy identity/membership containment (Task 568)', () => {
  const rules = clinicStaffPolicyResources();
  const types = new Set(rules.map((rule) => rule.resourceType));

  test('no wildcard and no rule for identity, membership, policy or project resources', () => {
    for (const forbidden of ['*', 'ProjectMembership', 'User', 'AccessPolicy', 'Project', 'Login', 'Bot', 'ClientApplication', 'UserConfiguration', 'AuditEvent']) {
      expect(types.has(forbidden)).toBe(false);
    }
  });

  test('every directory rule is read-only and clinic/self scoped by criteria', () => {
    for (const type of ['Practitioner', 'PractitionerRole', 'Organization', 'HealthcareService']) {
      const own = rules.filter((rule) => rule.resourceType === type);
      expect(own.length).toBeGreaterThan(0);
      for (const rule of own) {
        expect(rule.criteria).toBeTruthy();
        expect(rule.interaction).toEqual(['read', 'search', 'history', 'vread']);
      }
    }
    const criteria = (type: string) => rules.filter((rule) => rule.resourceType === type).map((rule) => rule.criteria);
    expect(criteria('Practitioner')).toEqual(['Practitioner?_compartment=%clinicAccount', 'Practitioner?_id=%profile.id']);
    expect(criteria('PractitionerRole')).toEqual(['PractitionerRole?organization=%clinicOrganization']);
  });

  test('no read-capable rule is unscoped except the create-only clinical rules', () => {
    for (const rule of rules.filter((r) => !r.criteria)) {
      expect(rule.interaction).toEqual(['create']);
    }
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
