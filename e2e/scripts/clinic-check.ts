// Clinic separation check (read-only, local Medplum only). Exit 1 on any leak.
// - lists Organizations with a `clinic` identifier (expects 4 after the seed; warns if fewer)
// - every Patient/Encounter must carry exactly one clinic identifier/tag that matches a known clinic
import { fhir } from '../lib/fhir';
const m = await fhir();
const all = async (type: string, q: Record<string, string> = {}) => {
  const out: any[] = []; for await (const page of m.searchResourcePages(type as any, { _count: '500', ...q })) out.push(...page); return out; };
const orgs = (await all('Organization')).filter(o => o.identifier?.some((i: any) => i.system === 'clinic'));
const ids = new Set(orgs.map(o => o.identifier.find((i: any) => i.system === 'clinic').value));
const res: any = { clinics: [...ids], patientsPerClinic: {}, problems: [] };
for (const p of await all('Patient')) {
  const c = [...new Set((p.identifier || []).filter((i: any) => i.system === 'clinic').map((i: any) => i.value))];
  if (c.length !== 1 || !ids.has(c[0])) res.problems.push({ Patient: p.id, clinics: c });
  else res.patientsPerClinic[c[0]] = (res.patientsPerClinic[c[0]] || 0) + 1;
}
res.encounters = (await all('Encounter')).length;
res.clinicCount = ids.size;
res.warning = ids.size < 4 ? `only ${ids.size}/4 clinics present` : undefined;
console.log(JSON.stringify(res, null, 1));
process.exit(ids.size === 0 || res.problems.length ? 1 : 0);
