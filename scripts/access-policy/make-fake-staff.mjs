#!/usr/bin/env bun
// Task 5 helper: create (or reuse) disposable FAKE staff accounts, one per clinic
// slug, through the app's own admin invite route, so they get exactly the
// membership/access[] that production invites produce.
//   MEDPLUM_ADMIN_EMAIL=.. MEDPLUM_ADMIN_PASSWORD=.. UCC_STAFF_PASSWORD=.. \
//   bun scripts/access-policy/make-fake-staff.mjs --app http://localhost:3251 --clinic demo --clinic clinicb [--remove]
// Prints only the e-mail addresses. Never prints passwords. Local only.
import fs from 'node:fs';
const args = process.argv.slice(2);
const all = (n) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
const app = new URL(all('--app')[0] || 'http://localhost:3251');
if (!['localhost', '127.0.0.1'].includes(app.hostname)) { console.error('local app only'); process.exit(2); }
const med = 'http://127.0.0.1:8113/';
const adminLogin = { email: process.env.MEDPLUM_ADMIN_EMAIL || 'admin@example.com', password: process.env.MEDPLUM_ADMIN_PASSWORD || 'medplum_admin' };
let pw = process.env.UCC_STAFF_PASSWORD;
if (!pw) pw = fs.readFileSync(new URL('../../e2e/.secrets/pw', import.meta.url), 'utf8').trim();
const remove = args.includes('--remove');

const cookie = [];
const call = async (method, path, body) => {
  const r = await fetch(app.origin + path, { method, headers: { 'content-type': 'application/json', cookie: cookie.join('; ') }, body: body ? JSON.stringify(body) : undefined });
  for (const c of r.headers.getSetCookie?.() || []) cookie.push(c.split(';')[0]);
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const l = await call('POST', '/api/auth/login', adminLogin);
if (l.status !== 200) { console.error('admin app login failed', l.status); process.exit(2); }
// resolve clinic organization ids via the admin API
const orgs = await call('GET', '/api/admin/clinics');
const list = orgs.json?.clinics || [];
for (const slug of all('--clinic')) {
  const org = (Array.isArray(list) ? list : []).find((o) => (o.identifier || []).some((i) => i.system === 'clinic' && i.value === slug) || o.subdomain === slug);
  if (!org) { console.error('clinic not found:', slug); process.exit(2); }
  const email = `task5-${slug}@example.invalid`;
  if (remove) { console.log('remove not implemented via API; delete manually', email); continue; }
  const r = await call('POST', '/api/admin/users/invite', { firstName: 'Task5', lastName: `Fake ${slug}`, email, password: pw, sendEmail: false, clinicId: org.id });
  console.log(`${email}: invite status ${r.status}`);
}
