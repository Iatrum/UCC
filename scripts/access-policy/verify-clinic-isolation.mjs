#!/usr/bin/env bun
// Task 5: black-box proof that a clinic-A staff token cannot read/write clinic-B
// data or list other clinics' staff. Runs against a live Medplum with REAL
// staff logins (the same ones the app uses), so it measures the actual
// project topology + AccessPolicy, not a simulation.
//
//   MEDPLUM_ADMIN_EMAIL=.. MEDPLUM_ADMIN_PASSWORD=.. UCC_STAFF_PASSWORD=.. \
//   bun scripts/access-policy/verify-clinic-isolation.mjs --label before \
//     --staff doctor-a@ucc.local --staff doctor-b@ucc.local \
//     [--foreign-project-resource Practitioner/<id>] [--allow-remote <origin>]
//
// Safety: only status codes / counts / booleans are printed or saved; no token,
// password or response body ever is. Probe data is fake, tagged
// `task5-isolation-probe`, created through the admin login and always deleted.
// Exit code 0 = every check passed, 1 = at least one check FAILED (a leak),
// 2 = could not run. The admin login must be able to read the clinic project
// (project admin or higher); it is never used for the staff-side checks.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, all = false) => {
  const out = [];
  for (let i = 0; i < args.length; i++) if (args[i] === name) out.push(args[++i]);
  return all ? out : out[0];
};
const LABEL = opt('--label') || 'run';
const STAFF = opt('--staff', true);
const FOREIGN_PROJECT = opt('--foreign-project-resource');
const PROJECT_ID = opt('--project'); // clinic project id for login (optional)
const OUT = opt('--out');
const base = new URL(process.env.MEDPLUM_BASE_URL || 'http://127.0.0.1:8113');
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && base.port === '8113';
if (!isLocal && opt('--allow-remote') !== base.origin) {
  console.error('Refusing non-local Medplum without --allow-remote <exact origin>');
  process.exit(2);
}
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw Error('Bare Medplum origin required');
const B = base.origin + '/';
// Dev advertises localhost links even when the approved request origin is
// 127.0.0.1. Accept only that known loopback alias, then keep every actual
// request on the configured origin. Never rewrite arbitrary pagination hosts.
function requestUrl(value) {
  let url = new URL(value, B);
  if (url.username || url.password) throw new Error('URL credentials refused');
  if (url.origin !== base.origin) {
    const localAliases = new Set(['http://localhost:8113', 'http://127.0.0.1:8113']);
    if (!isLocal || !localAliases.has(url.origin) || !url.pathname.startsWith('/fhir/R4/')) throw new Error('Foreign pagination refused');
    url = new URL(url.pathname + url.search, B);
  }
  return url;
}

const ADMIN = { email: process.env.MEDPLUM_ADMIN_EMAIL, password: process.env.MEDPLUM_ADMIN_PASSWORD };
if (!ADMIN.email || !ADMIN.password) { console.error('Admin credentials required'); process.exit(2); }
let staffPassword = process.env.UCC_STAFF_PASSWORD;
if (!staffPassword) {
  try { staffPassword = fs.readFileSync(new URL('../../e2e/.secrets/pw', import.meta.url), 'utf8').trim(); } catch { /* handled below */ }
}
if (STAFF.length < 2 || !staffPassword) { console.error('Need >=2 --staff emails and UCC_STAFF_PASSWORD (or e2e/.secrets/pw)'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(token, method, p, body) {
  const headers = { 'content-type': 'application/fhir+json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const url = requestUrl(p);
  if (url.origin !== base.origin) throw Error('Foreign pagination refused');
  const r = await fetch(url, { method, headers, redirect: 'error', signal: AbortSignal.timeout(30000), body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  if (r.ok && method === 'GET' && url.pathname.startsWith('/fhir/R4/') && url.search) {
    if (json?.resourceType !== 'Bundle' || !Array.isArray(json.entry || [])) throw Error('Malformed search response');
    const visited = new Set();
    let next = json.link?.find(l => l.relation === 'next')?.url;
    while (next) {
      const pageUrl = requestUrl(next);
      if (pageUrl.origin !== base.origin || visited.has(next) || visited.size > 10000) throw Error('Invalid search pagination');
      visited.add(next);
      const page = await fetch(pageUrl, {headers,redirect:'error',signal:AbortSignal.timeout(30000)});
      const data = await page.json();
      if (page.status !== 200 || data.resourceType !== 'Bundle') throw Error('Search pagination failed');
      json.entry = [...(json.entry || []), ...(data.entry || [])];
      next = data.link?.find(l => l.relation === 'next')?.url;
    }
  }
  return { status: r.status, json };
}
async function login({ email, password }) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const r = await http(null, 'POST', 'auth/login', { email, password, scope: 'openid', projectId: PROJECT_ID, codeChallenge: challenge, codeChallengeMethod: 'S256' });
    if (r.status === 429) { await sleep(20000); continue; }
    if (r.status !== 200) throw new Error(`login failed (${r.status})`);
    let code = r.json.code;
    if (!code) {
      const m = r.json.memberships || [];
      if (m.length !== 1) throw new Error(`login ambiguous: ${m.length} memberships (pass --project)`);
      const p = await http(null, 'POST', 'auth/profile', { login: r.json.login, profile: m[0].id });
      code = p.json?.code;
    }
    const form = new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier });
    const t = await fetch(B + 'oauth2/token', { redirect: 'error', signal: AbortSignal.timeout(30000), method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    if (t.status === 429) { await sleep(20000); continue; }
    const tj = await t.json();
    if (!tj.access_token) throw new Error('token exchange failed');
    return tj.access_token;
  }
  throw new Error('login rate-limited');
}

const results = [];
function check(group, name, ok, detail = '') {
  results.push({ group, name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${group}] ${name}${detail ? ' — ' + detail : ''}`);
}
const denied = (s) => s === 403 || s === 404;
const ids = (bundle) => new Set((bundle?.entry || []).map((e) => `${e.resource.resourceType}/${e.resource.id}`));
const TAG = { system: 'http://iatrum.com/seed', code: 'task5-isolation-probe' };

const created = []; // admin-created probe resources for cleanup
async function main() {
  const adminTok = await login(ADMIN);
  const A = (m, p, b) => http(adminTok, m, 'fhir/R4/' + p, b);

  // 1. Discover each staff member's clinic from their membership (admin view).
  const staff = [];
  for (const email of STAFF) {
    const ms = (await A('GET', `ProjectMembership?user:User.email=${encodeURIComponent(email)}${PROJECT_ID ? '&project=Project/'+PROJECT_ID : ''}`)).json;
    const m = ms?.entry?.[0]?.resource;
    const param = (m?.access || []).flatMap((a) => a.parameter || []);
    const acct = param.find((p) => p.name === 'clinicAccount')?.valueReference?.reference;
    const org = param.find((p) => p.name === 'clinicOrganization')?.valueReference?.reference;
    if (!m || !acct || !org) throw new Error(`staff ${email}: no clinic access[] on membership (run staff migration first)`);
    const hs = (await A('GET', acct)).json;
    const slug = (hs?.identifier || []).find((i) => i.system === 'clinic')?.value;
    staff.push({ email, userId: m.user?.reference?.replace('User/', ''), membership: m, acct, org, slug, profile: m.profile?.reference });
  }
  const slugs = new Set(staff.map((s) => s.slug));
  if (slugs.size !== staff.length) throw new Error('staff must belong to distinct clinics');

  // 2. Build per-clinic probe data through the admin login.
  const run = crypto.randomBytes(4).toString('hex');
  const stamp = (r, acct) => A('POST', `${r.resourceType}/${r.id}/$set-accounts`, {
    resourceType: 'Parameters', parameter: [{ name: 'accounts', valueReference: { reference: acct } }, { name: 'propagate', valueBoolean: false }],
  });
  const mk = async (resource, acct) => {
    const r = await A('POST', resource.resourceType, { ...resource, meta: { tag: [TAG] } });
    if (r.status !== 201) throw new Error(`probe create ${resource.resourceType} failed (${r.status})`);
    created.push(`${r.json.resourceType}/${r.json.id}`);
    const s = await stamp(r.json, acct);
    if (s.status >= 300) throw new Error(`probe stamp failed (${s.status})`);
    return r.json;
  };
  for (const s of staff) {
    const idf = [{ system: 'clinic', value: s.slug }];
    const patient = await mk({ resourceType: 'Patient', identifier: idf, name: [{ family: `Task5Probe${run}` }] }, s.acct);
    const subject = { reference: `Patient/${patient.id}` };
    const encounter = await mk({ resourceType: 'Encounter', identifier: idf, status: 'in-progress', class: { code: 'AMB' }, subject }, s.acct);
    const serviceRequest = await mk({ resourceType: 'ServiceRequest', identifier: idf, status: 'active', intent: 'order', code: { text: 'Task5 probe' }, subject }, s.acct);
    const imagingStudy = await mk({ resourceType: 'ImagingStudy', identifier: idf, status: 'available', subject }, s.acct);
    s.own = { Patient: patient, Encounter: encounter, ServiceRequest: serviceRequest, ImagingStudy: imagingStudy };
  }

  // Expected per-clinic directory (admin view): practitioners via PractitionerRole.
  const roles = (await A('GET', 'PractitionerRole?_count=1000')).json;
  const practitionersByOrg = new Map();
  for (const e of roles?.entry || []) {
    const o = e.resource.organization?.reference; const pr = e.resource.practitioner?.reference;
    if (!o || !pr) continue;
    if (!practitionersByOrg.has(o)) practitionersByOrg.set(o, new Set());
    practitionersByOrg.get(o).add(pr);
  }

  // 3. Staff-side checks.
  for (const s of staff) {
    const tok = await login({ email: s.email, password: staffPassword });
    const S = (m, p, b) => http(tok, m, 'fhir/R4/' + p, b);
    const g = `staff ${s.slug}`;
    const foreign = staff.filter((o) => o !== s);

    // Own-clinic positive controls (a broken policy that denies everything must not pass).
    for (const [type, r] of Object.entries(s.own)) {
      const rd = await S('GET', `${type}/${r.id}`);
      check(g, `reads OWN ${type}`, rd.status === 200, `status ${rd.status}`);
      const sr = await S('GET', `${type}?_id=${r.id}`);
      check(g, `search finds OWN ${type} by id`, ids(sr.json).has(`${type}/${r.id}`), `status ${sr.status}`);
    }
    {
      const e = s.own.Encounter;
      const cur = (await S('GET', `Encounter/${e.id}`)).json;
      const up = await S('PUT', `Encounter/${e.id}`, { ...cur, status: 'finished' });
      check(g, 'updates OWN Encounter', up.status === 200, `status ${up.status}`);
      const ok = await S('POST', 'ServiceRequest', { resourceType: 'ServiceRequest', status: 'active', intent: 'order', code: { text: 'own' }, subject: { reference: `Patient/${s.own.Patient.id}` }, meta: { tag: [TAG] } });
      if (ok.status === 201 && ok.json?.resourceType === 'ServiceRequest' && ok.json.id) created.push(`ServiceRequest/${ok.json.id}`);
      check(g, 'creates ServiceRequest for OWN patient', ok.status === 201, `status ${ok.status}`);
    }

    for (const f of foreign) {
      const gf = `${g} -> ${f.slug}`;
      for (const [type, r] of Object.entries(f.own)) {
        const rd = await S('GET', `${type}/${r.id}`);
        check(gf, `cannot READ ${type}`, denied(rd.status), `status ${rd.status}`);
        const byId = await S('GET', `${type}?_id=${r.id}`);
        check(gf, `cannot SEARCH ${type} by id`, byId.status === 200 && ids(byId.json).size === 0, `status ${byId.status}, hits ${ids(byId.json).size}`);
        const all = await S('GET', `${type}?_count=1000`);
        check(gf, `${type} list omits foreign`, all.status === 200 && !ids(all.json).has(`${type}/${r.id}`), `status ${all.status}`);
        const before = (await A('GET', `${type}/${r.id}`)).json;
        const put = await S('PUT', `${type}/${r.id}`, { ...before, text: { status: 'generated', div: '<div xmlns="http://www.w3.org/1999/xhtml">tamper</div>' } });
        check(gf, `cannot UPDATE ${type}`, denied(put.status), `status ${put.status}`);
        const del = await S('DELETE', `${type}/${r.id}`);
        check(gf, `cannot DELETE ${type}`, denied(del.status), `status ${del.status}`);
        const after = (await A('GET', `${type}/${r.id}`)).json;
        check(gf, `${type} untouched`, after?.meta?.versionId === before?.meta?.versionId, '');
      }
      const forged = await S('POST', 'Patient', { resourceType: 'Patient', identifier: [{ system: 'clinic', value: f.slug }], meta: { accounts: [{ reference: f.acct }], compartment: [{ reference: f.acct }] } });
      if (forged.status === 201 && forged.json?.resourceType === 'Patient' && forged.json.id) created.push(`Patient/${forged.json.id}`);
      check(gf, 'cannot CREATE Patient with forged foreign accounts', forged.status === 403, `status ${forged.status}`);
      // Write containment: create new clinical resources pointing at the foreign patient.
      const subj = { reference: `Patient/${f.own.Patient.id}` };
      const attempts = {
        ServiceRequest: { resourceType: 'ServiceRequest', status: 'active', intent: 'order', code: { text: 'x' }, subject: subj },
        Encounter: { resourceType: 'Encounter', status: 'planned', class: { code: 'AMB' }, subject: subj },
        ImagingStudy: { resourceType: 'ImagingStudy', status: 'available', subject: subj },
        Observation: { resourceType: 'Observation', status: 'final', code: { text: 'x' }, subject: subj },
      };
      for (const [type, body] of Object.entries(attempts)) {
        const r = await S('POST', type, { ...body, meta: { tag: [TAG] } });
        if (r.json?.id && r.json.resourceType === type) created.push(`${type}/${r.json.id}`);
        check(gf, `cannot CREATE ${type} for foreign patient`, r.status === 403, `status ${r.status}`);
      }
    }

    // Directory containment: only own clinic's staff/org visible, no identity tables.
    const mine = practitionersByOrg.get(s.org) || new Set();
    const otherOnly = new Set();
    for (const o of foreign) for (const p of practitionersByOrg.get(o.org) || []) if (!mine.has(p)) otherOnly.add(p);
    const pr = await S('GET', 'Practitioner?_count=1000');
    const seen = new Set([...ids(pr.json)]);
    if (pr.status !== 200) throw Error('Directory positive control failed');
    const leaked = [...otherOnly].filter((p) => seen.has(p));
    check(g, 'cannot list other clinics\' Practitioners', leaked.length === 0, `status ${pr.status}, leaked ${leaked.length}/${otherOnly.size}`);
    check(g, 'still lists OWN clinic Practitioners', [...mine].every((p) => seen.has(p)) && mine.size > 0, `status ${pr.status}, visible ${[...mine].filter((p) => seen.has(p)).length}/${mine.size}`);
    const pro = await S('GET', 'PractitionerRole?_count=1000');
    const roleOrgs = new Set((pro.json?.entry || []).map((e) => e.resource.organization?.reference));
    check(g, 'PractitionerRole only OWN clinic', [...roleOrgs].every((o) => o === s.org), `orgs ${roleOrgs.size}`);
    const og = await S('GET', 'Organization?_count=1000');
    check(g, 'Organization only OWN clinic', ids(og.json).size <= 1 && [...ids(og.json)].every((x) => x === s.org), `visible ${ids(og.json).size}`);
    const hsr = await S('GET', 'HealthcareService?_count=1000');
    check(g, 'HealthcareService only OWN clinic', ids(hsr.json).size <= 1 && [...ids(hsr.json)].every((x) => x === s.acct), `visible ${ids(hsr.json).size}`);
    for (const type of ['ProjectMembership', 'User', 'Project', 'AccessPolicy', 'ClientApplication', 'Bot']) {
      const r = await S('GET', `${type}?_count=50`);
      check(g, `cannot list ${type}`, denied(r.status) || ids(r.json).size === 0, `status ${r.status}, visible ${ids(r.json).size}`);
    }
    for (const o of foreign) {
      const rd = await S('GET', o.profile);
      const shared = (practitionersByOrg.get(s.org) || new Set()).has(o.profile); // multi-clinic practitioner is legitimately visible
      check(g, `cannot read foreign clinic staff profile (${o.slug})`, shared || denied(rd.status), `status ${rd.status}`);
      const mr = await S('GET', `ProjectMembership/${o.membership.id}`);
      check(g, `cannot read foreign ProjectMembership (${o.slug})`, denied(mr.status), `status ${mr.status}`);
      if (o.userId) {
        const ur = await S('GET', `User/${o.userId}`);
        check(g, `cannot read foreign User (${o.slug})`, denied(ur.status), `status ${ur.status}`);
      }
    }
    const myMembership = await S('GET', `ProjectMembership/${s.membership.id}`);
    check(g, 'cannot read even own ProjectMembership (no identity grants)', denied(myMembership.status), `status ${myMembership.status}`);
    if (FOREIGN_PROJECT) {
      const fp = await S('GET', FOREIGN_PROJECT);
      check(g, 'cannot read a resource of ANOTHER project', denied(fp.status), `status ${fp.status}`);
    }
    const me = await http(tok, 'GET', 'auth/me');
    check(g, 'own session still works (auth/me)', me.status === 200, `status ${me.status}`);
  }
}

let fatal;
try { await main(); } catch (e) { fatal = e; console.error('FATAL:', e.message); }
// Cleanup (admin login), best effort, children first.
try {
  const adminTok = await login(ADMIN);
  const order = ['ImagingStudy', 'ServiceRequest', 'Observation', 'Encounter', 'Patient'];
  const sorted = [...new Set(created)].sort((a, b) => order.indexOf(a.split('/')[0]) - order.indexOf(b.split('/')[0]));
  let n = 0;
  for (const ref of sorted) { const r = await http(adminTok, 'DELETE', 'fhir/R4/' + ref); if ([200,204,404,410].includes(r.status)) n++; else console.error(`cleanup ${ref.split('/')[0]} failed (${r.status})`); }
  console.log(`cleanup: deleted ${n}/${sorted.length} probe resources`);
  if (n !== sorted.length) fatal ||= new Error('Probe cleanup incomplete');
} catch { fatal ||= new Error('Probe cleanup failed'); console.error('Probe cleanup failed'); }

const failed = results.filter((r) => !r.ok);
console.log(`\n${LABEL}: ${results.length - failed.length}/${results.length} checks passed, ${failed.length} failed${fatal ? ', FATAL error' : ''}`);
if (OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ label: LABEL, at: new Date().toISOString(), passed: results.length - failed.length, failed: failed.length, fatal: fatal?.message, results }, null, 2), { mode: 0o600 });
}
process.exit(fatal ? 2 : failed.length ? 1 : 0);
