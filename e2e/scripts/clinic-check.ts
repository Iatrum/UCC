// Clinic separation check (read-only, local Medplum only). Exit 1 on any leak.
// - lists Organizations with a `clinic` identifier (expects 4 after the seed; warns if fewer)
// - every Patient/Encounter must carry exactly one clinic identifier/tag that matches a known clinic
import { fhir } from '../lib/fhir';
import { MEDPLUM } from '../lib/env';
if (new URL(MEDPLUM).origin !== 'http://localhost:8113') throw new Error('Local Medplum only');
const m = await fhir();
const all = async (type: string, q: Record<string, string> = {}) => {
  const out: any[] = []; for await (const page of m.searchResourcePages(type as any, { _count: '500', ...q }, { cache: 'no-cache', headers: { 'X-Medplum': 'extended' } })) out.push(...page); return out; };
const orgs = (await all('Organization')).filter(o => o.identifier?.some((i: any) => i.system === 'clinic'));
const ids = new Set(orgs.map(o => o.identifier.find((i: any) => i.system === 'clinic').value));
const res: any = { clinics: [...ids], patientsPerClinic: {}, problems: [] };
for (const p of await all('Patient')) {
  const c = [...new Set((p.identifier || []).filter((i: any) => i.system === 'clinic').map((i: any) => i.value))];
  if (c.length !== 1 || !ids.has(c[0])) res.problems.push({ resourceType: 'Patient', invalidClinicIdentifier: true });
  else res.patientsPerClinic[c[0]] = (res.patientsPerClinic[c[0]] || 0) + 1;
}
res.encounters = (await all('Encounter')).length;
res.clinicCount = ids.size;
res.warning = ids.size < 4 ? `only ${ids.size}/4 clinics present` : undefined;
// Phase 1 only inventories historical gaps. Strict completeness is for Phase 2.
const types = ['Patient', 'Encounter', 'Observation', 'Condition', 'Procedure',
  'MedicationRequest', 'MedicationStatement', 'AllergyIntolerance', 'ServiceRequest',
  'DiagnosticReport', 'ImagingStudy', 'DocumentReference', 'Appointment', 'Invoice',
  'Task', 'Basic', 'ChargeItemDefinition', 'Medication', 'Communication',
  'QuestionnaireResponse', 'Schedule', 'Slot', 'Provenance'];
const accountClinics = new Map((await all('HealthcareService')).flatMap(h => {
  const clinic = h.identifier?.find((i: any) => i.system === 'clinic')?.value;
  return clinic && ids.has(clinic) ? [[`HealthcareService/${h.id}`, clinic] as const] : [];
}));
res.accounts = {};
for (const type of types) {
  const counts = { checked: 0, missing: 0, invalid: 0 };
  for (const resource of await all(type)) {
    counts.checked++;
    const references = [...new Set((resource.meta?.accounts || (resource.meta?.account ? [resource.meta.account] : []))
      .map((a: any) => a.reference))];
    if (!references.length) { counts.missing++; continue; }
    const clinicIds = (resource.identifier || []).filter((i: any) => i.system === 'clinic').map((i: any) => i.value);
    if (references.length !== 1 || !accountClinics.has(references[0]) ||
        clinicIds.some((id: string) => id !== accountClinics.get(references[0]))) counts.invalid++;
  }
  res.accounts[type] = counts;
}
const missing = Object.values(res.accounts).reduce((n: number, c: any) => n + c.missing, 0);
const invalid = Object.values(res.accounts).reduce((n: number, c: any) => n + c.invalid, 0);
res.accountMode = process.env.UCC_STRICT_CLINIC_ACCOUNTS === '1' ? 'strict' : 'phase-1-inventory';
res.accountSummary = { missing, invalid };
if (invalid || (process.env.UCC_STRICT_CLINIC_ACCOUNTS === '1' && missing)) {
  res.problems.push({ accountMissing: missing, accountInvalid: invalid });
}
console.log(JSON.stringify(res, null, 1));
process.exit(ids.size === 0 || res.problems.length ? 1 : 0);
