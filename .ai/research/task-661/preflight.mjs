// Task 661 preflight (dev Medplum 127.0.0.1:8113 only). Proves the enforcement topology BEFORE the walk:
// project not superAdmin, fake staff membership carries the clinic access[] + staff policy, policy not drifted.
// Logs the platform admin in once; prints no tokens/passwords/ids of real data.
import { createRequire } from 'node:module';
import { MedplumClient } from '@medplum/core';
const require = createRequire(import.meta.url); require('tsx/cjs');
const { clinicStaffPolicyDrift } = require('../../../lib/fhir/clinic-access-policy.ts');
const m = new MedplumClient({ baseUrl: 'http://127.0.0.1:8113/', fetch: globalThis.fetch.bind(globalThis) });
const r = await m.startLogin({ email: process.env.MEDPLUM_ADMIN_EMAIL || 'admin@example.com', password: process.env.MEDPLUM_ADMIN_PASSWORD });
await m.processCode(r.code);
const out = {};
const projId = m.getActiveLogin()?.project?.reference;
const proj = await m.readReference({ reference: projId });
out.projectSuperAdmin = !!proj.superAdmin; out.projectName = proj.name;
const all = await m.searchResources('ProjectMembership', { _count: '1000' });
for (const email of process.argv.slice(2)) {
  const mem = all.filter(x => x.user?.display === email);
  out[email] = mem.map(x => ({ admin: !!x.admin, accessPolicy: !!x.accessPolicy, accessEntries: (x.access || []).length, policies: [...new Set((x.access || []).map(a => a.policy?.display))], clinicParams: (x.access || []).flatMap(a => (a.parameter || []).map(p => p.name)).filter((v, i, a) => a.indexOf(v) === i) }));
}
const pol = (await m.searchResources('AccessPolicy', { name: 'UCC Clinic Staff Policy' }))[0];
out.staffPolicyFound = !!pol;
if (pol) { const d = clinicStaffPolicyDrift(pol.resource); out.staffPolicyDrift = d; }
console.log(JSON.stringify(out, null, 1));
