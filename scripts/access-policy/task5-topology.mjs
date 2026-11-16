#!/usr/bin/env bun
// Task 5: make Medplum AccessPolicy the primary clinic-isolation control by
// taking the clinical project OUT of superAdmin mode.
//
// Why (see .ai/research/task5-topology.md): `superAdmin: true` on a Project is a
// server-wide bypass. Every member of such a project gets repository superAdmin
// powers: no project scoping, injected ProjectMembership/User/Project grants,
// and (Task 090) cross-clinic update/delete/create that policies do not stop.
// Medplum has no supported operation to move resources between projects
// ($clone mints new ids and caps at 1000/type), so instead of moving data the
// topology is changed around it:
//
//   BEFORE   one project, superAdmin=true: operator + UCC admin + app client +
//            every clinic's staff + all clinical data
//   AFTER    clinical project (same id, same data, same memberships):
//              superAdmin=false, strict project scoping
//              staff        -> "UCC Clinic Staff Policy" + per-clinic access[]
//              app client   -> admin membership + "UCC App Server Policy"
//                              (least privilege, NOT "*")
//              UCC admin    -> project admin (membership.admin), no superAdmin
//            NEW operator project (superAdmin=true, holds ONLY the Medplum
//            operator identity: no clinical data, no staff, no app client)
//
// Usage (dry-run is the default and writes NOTHING):
//   MEDPLUM_ADMIN_EMAIL=.. MEDPLUM_ADMIN_PASSWORD=.. \
//   bun scripts/access-policy/task5-topology.mjs --project <clinicalProjectId> \
//        [--operator-email <email>] [--app-client <ClientApplication id>] \
//        [--rename "UCC Clinics"] [--backup-dir <dir>]
//   ... add --apply            to execute (prepare, verify operator login, cut over)
//   ... --rollback --apply     to restore superAdmin + the backed-up documents
//   ... --rollback             (dry-run) shows what rollback would restore
//
// Remote (production) targets are refused unless `--allow-remote <exact origin>`
// is given; `--apply` on a remote additionally needs `--backup-confirmed <file>`
// pointing at an existing, non-empty database dump. Nothing is ever printed
// except ids, counts, statuses and file paths: no tokens, passwords or bodies.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  APP_SERVER_POLICY_NAME, CLINIC_POLICY_NAME, appServerPolicyResources, clinicStaffPolicyResources,
} from '../../lib/fhir/clinic-access-policy.ts';

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const APPLY = flag('--apply');
const ROLLBACK = flag('--rollback');
const KNOWN = new Set(['--apply', '--rollback', '--project', '--operator-email', '--app-client', '--rename',
  '--backup-dir', '--allow-remote', '--backup-confirmed', '--ops-project-name']);
const seenArguments = new Set();
for (let i = 0; i < argv.length; i++) {
  const name = argv[i];
  if (!KNOWN.has(name) || seenArguments.has(name)) die('Unknown or repeated argument');
  seenArguments.add(name);
  if (!['--apply', '--rollback'].includes(name) && (!argv[++i] || argv[i].startsWith('--'))) die('Missing argument value');
}
function die(m) { console.error(`ERROR: ${m}`); process.exit(2); }
const log = (m) => console.log(m);

const base = new URL(process.env.MEDPLUM_BASE_URL || 'http://127.0.0.1:8113');
if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') die('MEDPLUM_BASE_URL must be a bare origin');
const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) && base.port === '8113';
if (!isLocal) {
  if (val('--allow-remote') !== base.origin) die(`Remote target ${base.origin}: pass --allow-remote ${base.origin} (production is a manual operator step, see the runbook)`);
  if (APPLY) {
    const f = val('--backup-confirmed');
    if (!f || !fs.existsSync(f) || fs.statSync(f).size < 1024) die('Remote --apply needs --backup-confirmed <existing database dump file>');
    log(`backup file acknowledged: ${f} (${fs.statSync(f).size} bytes)`);
  }
}
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

const PROJECT_ID = val('--project');
if (!PROJECT_ID || !/^[0-9a-f-]{36}$/.test(PROJECT_ID)) die('--project <clinical project uuid> is required');
const OPS_NAME = val('--ops-project-name') || 'UCC Platform Operator';
const RENAME = val('--rename') || 'UCC Clinics';
const OPERATOR_EMAIL = (val('--operator-email') || (isLocal ? 'task5-operator@example.invalid' : '')).toLowerCase();
if (!OPERATOR_EMAIL) die('--operator-email is required for a remote target (use a dedicated address you control)');
const ADMIN = { email: process.env.MEDPLUM_ADMIN_EMAIL, password: process.env.MEDPLUM_ADMIN_PASSWORD };
if (!ADMIN.email || !ADMIN.password) die('MEDPLUM_ADMIN_EMAIL / MEDPLUM_ADMIN_PASSWORD are required');
if (OPERATOR_EMAIL === ADMIN.email?.toLowerCase()) die('Operator must be a separate identity');
const BACKUP_DIR = val('--backup-dir') || path.join(process.env.HOME || '.', 'ucc-task5-backup');
const PRE_FILE = path.join(BACKUP_DIR, `task5-pre-${PROJECT_ID}.json`);
const MANIFEST_FILE = path.join(BACKUP_DIR, `task5-written-${PROJECT_ID}.json`);
const LOCK_FILE = path.join(BACKUP_DIR, 'task5.lock');
const OPERATOR_PW_FILE = path.join(BACKUP_DIR, `operator-${crypto.createHash('sha256').update(OPERATOR_EMAIL).digest('hex').slice(0, 12)}.pw`);

// ------------------------------------------------------------------- http
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function raw(token, method, p, body, headers = {}) {
  const h = { 'content-type': 'application/fhir+json', 'X-Medplum': 'extended', ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  const url = requestUrl(p);
  if (url.origin !== base.origin || url.username || url.password) die('Nonlocal request refused');
  if (method === 'PUT' && body?.meta?.versionId) h['If-Match'] = `W/"${body.meta.versionId}"`;
  const r = await fetch(url, { method, headers: h, redirect: 'error', signal: AbortSignal.timeout(30000), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: r.status, json };
}
async function login({ email, password }, projectId) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const r = await raw(null, 'POST', 'auth/login', { email, password, scope: 'openid', projectId, codeChallenge: challenge, codeChallengeMethod: 'S256' });
    if (r.status === 429) { await sleep(20000); continue; }
    if (r.status !== 200) return { error: `login failed (${r.status})` };
    let code = r.json.code;
    if (!code) {
      const ms = r.json.memberships || [];
      const m = projectId ? ms.find((x) => x.project?.reference === `Project/${projectId}`) : (ms.length === 1 ? ms[0] : undefined);
      if (!m) return { error: `login needs a project choice (${ms.length} memberships)` };
      const p = await raw(null, 'POST', 'auth/profile', { login: r.json.login, profile: m.id });
      code = p.json?.code;
    }
    const t = await fetch(B + 'oauth2/token', { redirect: 'error', signal: AbortSignal.timeout(30000), method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier }).toString() });
    if (t.status === 429) { await sleep(20000); continue; }
    const tj = await t.json().catch(() => ({}));
    if (!tj.access_token) return { error: 'token exchange failed' };
    const me = await raw(tj.access_token, 'GET', 'auth/me');
    return { token: tj.access_token, me: me.json };
  }
  return { error: 'login rate-limited' };
}
// Response diagnostics can contain sensitive resource contents. Status only.
const reason = () => '';
const F = (s) => (method, p, body) => raw(s.token, method, 'fhir/R4/' + p, body);
async function searchAll(f, query) {
  const out = []; const visited = new Set(); let r = await f('GET', query);
  if (r.status !== 200) die(`search ${query.split('?')[0]} failed (${r.status})`);
  for (;;) {
    if (r.status !== 200 || r.json?.resourceType !== 'Bundle') die('Invalid search response');
    for (const e of r.json.entry || []) out.push(e.resource);
    const next = (r.json.link || []).find((l) => l.relation === 'next')?.url;
    if (!next) return out;
    if (visited.has(next) || visited.size > 10000) die('Invalid pagination');
    visited.add(next);
    r = await raw(sessToken(f), 'GET', next);
  }
}
let _tok; const sessToken = () => _tok;

// --------------------------------------------------------------- inspection
const projectOf = (m) => m.project?.reference?.replace('Project/', '');
async function inspect(f, { forApply }) {
  const project = (await f('GET', `Project/${PROJECT_ID}`)).json;
  if (!project || project.resourceType !== 'Project') die('clinical project not readable with this login');
  const memberships = (await searchAll(f, `ProjectMembership?project=Project/${PROJECT_ID}&_count=1000`)).filter((m) => projectOf(m) === PROJECT_ID);
  const policies = await searchAll(f, `AccessPolicy?_project=${PROJECT_ID}&_count=1000`);
  const named = (name) => policies.filter((p) => p.name === name);
  const base = (await searchAll(f, 'Project?name=FHIR%20R4&_count=10')).find((p) => p.name === 'FHIR R4');
  const ops = (await searchAll(f, `Project?name=${encodeURIComponent(OPS_NAME)}&_count=10`)).filter((p) => p.name === OPS_NAME);
  return { project, memberships, policies, named, baseProject: base, ops, forApply };
}
const isClient = (m) => m.profile?.reference?.startsWith('ClientApplication/');
const isStaff = (m) => !isClient(m) && !m.admin && m.profile?.reference?.startsWith('Practitioner/');
const clinicAccounts = (m) => (m.access || []).flatMap((a) => (a.parameter || []).filter((p) => p.name === 'clinicAccount').map((p) => p.valueReference?.reference)).filter(Boolean);
const writeUnion = (refs) => `^(${[...new Set(refs)].sort().map((r) => r.replace(/\./g, '[.]')).join('|')})$`;

// Canonical access[] for a staff membership: each entry keeps its clinic params and
// carries the same server-derived clinicWriteAccounts union (mirrors admin-service).
const plannedStaffAccess = new Map();
function canonicalAccess(m) {
  if (plannedStaffAccess.has(m.id)) return plannedStaffAccess.get(m.id);
  const refs = clinicAccounts(m);
  const union = writeUnion(refs);
  return (m.access || []).map((a) => {
    const params = (a.parameter || []).filter((p) => p.name !== 'clinicWriteAccounts');
    params.push({ name: 'clinicWriteAccounts', valueString: union });
    return { ...a, parameter: params };
  });
}


// Practitioner.meta.accounts must equal the clinic HealthcareService of every
// active PractitionerRole (the staff policy lists Practitioners by
// _compartment, since Medplum forbids `_has` in criteria). Returns the changes.
async function directoryPlan(f) {
  const q = (t) => `${t}?_project=${PROJECT_ID}&_count=1000`;
  const orgs = await searchAll(f, q('Organization'));
  const services = await searchAll(f, q('HealthcareService'));
  const slugOf = (r) => (r.identifier || []).find((i) => i.system === 'clinic')?.value;
  if (new Set(services.filter(slugOf).map(slugOf)).size !== services.filter(slugOf).length) die('Duplicate clinic account identifiers');
  const accountBySlug = new Map(services.filter(slugOf).map((h) => [slugOf(h), `HealthcareService/${h.id}`]));
  const accountByOrg = new Map(orgs.filter(slugOf).filter((o) => accountBySlug.has(slugOf(o))).map((o) => [`Organization/${o.id}`, accountBySlug.get(slugOf(o))]));
  const want = new Map((await searchAll(f, q('Practitioner'))).map(p => [`Practitioner/${p.id}`, new Set()]));
  for (const r of await searchAll(f, q('PractitionerRole'))) {
    const pr = r.practitioner?.reference; const acct = accountByOrg.get(r.organization?.reference);
    if (!pr || r.active === false) continue;
    if (!want.has(pr)) want.set(pr, new Set());
    if (!acct) die('Active PractitionerRole has no unambiguous clinic account');
    want.get(pr).add(acct);
  }
  const changes = [];
  for (const [pr, set] of want) {
    const cur = (await raw(_tok, 'GET', `fhir/R4/${pr}`, undefined, { 'X-Medplum': 'extended' })).json;
    if (!cur || cur.resourceType !== 'Practitioner' || cur.meta?.project !== PROJECT_ID) die('Directory profile is outside the clinical project');
    const have = new Set((cur.meta?.accounts || []).map((a) => a.reference));
    if (have.size !== set.size || [...set].some((a) => !have.has(a))) changes.push({ pr, accounts: [...set].sort(), before: [...have].sort() });
  }
  return changes;
}

// --------------------------------------------------------------------- main
async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });
  if (APPLY) {
    try { fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx', mode: 0o600 }); }
    catch { die(`lock file exists (${LOCK_FILE}); another run is active or crashed, inspect then delete it`); }
    process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE); } catch { /* ignore */ } });
  }
  log(`target ${base.origin}  mode=${ROLLBACK ? 'ROLLBACK' : 'MIGRATE'}  ${APPLY ? 'APPLY' : 'DRY-RUN (no writes)'}`);

  // Session: the current super admin (before cut-over) or the operator (after).
  let sess = await login(ADMIN, PROJECT_ID);
  let mode = 'admin';
  if (sess.error || !sess.me?.project?.superAdmin) {
    // Already cut over (admin lost superAdmin): need the operator identity.
    const opPw = process.env.OPERATOR_PASSWORD || (fs.existsSync(OPERATOR_PW_FILE) ? fs.readFileSync(OPERATOR_PW_FILE, 'utf8').trim() : '');
    if (!opPw) die('admin login is not superAdmin (already cut over?) and no operator password (OPERATOR_PASSWORD or ' + OPERATOR_PW_FILE + ')');
    sess = await login({ email: OPERATOR_EMAIL, password: opPw }, undefined);
    if (sess.error || !sess.me?.project?.superAdmin) die(`no superAdmin session available (${sess.error || 'operator not superAdmin'})`);
    mode = 'operator';
  }
  _tok = sess.token;
  log(`session: ${mode}, superAdmin project ${sess.me.project.id}`);
  const f = F(sess);
  const st = await inspect(f, { forApply: APPLY });
  const proj = st.project;
  const cutOver = !proj.superAdmin;
  log(`clinical project ${PROJECT_ID}: name="${proj.name}" superAdmin=${Boolean(proj.superAdmin)} links=${(proj.link || []).length}`);

  // ------------------------------------------------------------- rollback
  if (ROLLBACK) return rollback(f, st, sess, mode);

  // -------------------------------------------------------------- planning
  const clients = st.memberships.filter(isClient);
  const wantClient = val('--app-client');
  const appClient = wantClient ? clients.find((m) => m.profile.reference === `ClientApplication/${wantClient}`) : (clients.length === 1 ? clients[0] : undefined);
  if (!appClient) die(`app client membership not unique/found (${clients.length} client memberships); pass --app-client <ClientApplication id>`);
  const staff = st.memberships.filter(isStaff);
  const unsupported = st.memberships.filter(m => !isClient(m) && !m.admin && !isStaff(m));
  if (unsupported.length) die('Unsupported non-staff memberships require a separately reviewed migration');
  const orgs = await searchAll(f, `Organization?_project=${PROJECT_ID}&_count=100`);
  const services = await searchAll(f, `HealthcareService?_project=${PROJECT_ID}&_count=100`);
  const roles = await searchAll(f, `PractitionerRole?_project=${PROJECT_ID}&_count=100`);
  if (st.memberships.some(m => m.admin && !isClient(m) && roles.some(r => r.active !== false && r.practitioner?.reference === m.profile?.reference))) die('Clinic-assigned human has project-admin privilege; separate platform administration before migration');
  const slug = r => (r.identifier || []).filter(i => i.system === 'clinic').map(i => i.value);
  const unresolved = [];
  for (const member of staff) {
    const assignments = roles.filter(r => r.active !== false && r.practitioner?.reference === member.profile.reference);
    const clinics = [];
    for (const role of assignments) {
      const org = orgs.find(o => `Organization/${o.id}` === role.organization?.reference);
      const keys = org ? slug(org) : [];
      const accounts = services.filter(h => keys.length === 1 && slug(h).length === 1 && slug(h)[0] === keys[0]);
      if (accounts.length !== 1) die('Staff assignment has no unique clinic Organization/account pair');
      clinics.push({ org: role.organization.reference, account: `HealthcareService/${accounts[0].id}` });
    }
    const unique = [...new Map(clinics.map(c => [c.org, c])).values()].sort((a,b) => a.org.localeCompare(b.org));
    if (!unique.length) unresolved.push(member);
    const union = writeUnion(unique.map(c => c.account));
    plannedStaffAccess.set(member.id, unique.map(c => ({ policy: { reference: 'CLINIC_POLICY' }, parameter: [
      { name: 'clinicAccount', valueReference: { reference: c.account } },
      { name: 'clinicOrganization', valueReference: { reference: c.org } },
      { name: 'clinicWriteAccounts', valueString: union },
    ] })));
  }
  const privilegedProjects = new Set((await searchAll(f, 'Project?_count=100')).filter(p => p.superAdmin && p.id !== PROJECT_ID).map(p => `Project/${p.id}`));
  for (const member of staff) {
    if (!member.user?.reference) die('Staff membership has no user identity');
    const otherMemberships = await searchAll(f, `ProjectMembership?user=${encodeURIComponent(member.user.reference)}&_count=100`);
    if (otherMemberships.some(m => m.active !== false && privilegedProjects.has(m.project?.reference))) die('Staff identity also belongs to another superAdmin project');
  }
  const unpoliced = unresolved;
  const clinicPolicy = st.named(CLINIC_POLICY_NAME);
  if (clinicPolicy.length > 1) die(`${clinicPolicy.length} policies named "${CLINIC_POLICY_NAME}" exist in the server; pick one and delete the duplicates first`);
  const appPolicyExisting = st.named(APP_SERVER_POLICY_NAME);
  if (appPolicyExisting.length > 1) die(`duplicate "${APP_SERVER_POLICY_NAME}" policies`);
  const clinicPolicyRef = clinicPolicy[0] && `AccessPolicy/${clinicPolicy[0].id}`;
  const wrongPolicy = staff.filter((m) => (m.access || []).some((a) => a.policy?.reference !== clinicPolicyRef) || (!m.access?.length && m.accessPolicy && m.accessPolicy.reference !== clinicPolicyRef));
  if (clinicPolicyRef) for (const [id, access] of plannedStaffAccess) plannedStaffAccess.set(id, access.map(a => ({ ...a, policy: { reference: clinicPolicyRef } })));
  const needParamRefresh = staff.filter((m) => !unpoliced.includes(m) && !isDeepStrictEqual(canonicalAccess(m), m.access));
  const wantClinic = clinicStaffPolicyResources();
  const clinicPolicyStale = !clinicPolicy[0] || !isDeepStrictEqual(clinicPolicy[0].resource, wantClinic);
  const wantApp = appServerPolicyResources();
  const appPolicyStale = !appPolicyExisting[0] || !isDeepStrictEqual(appPolicyExisting[0].resource, wantApp);
  if (st.ops.length > 1) die('Ambiguous operator project');
  const opsProject = st.ops[0];
  if (opsProject?.id === PROJECT_ID) die('Operator and clinical project must differ');
  const dirChanges = await directoryPlan(f);

  log('\nPLAN');
  log(` 1. operator project "${OPS_NAME}": ${opsProject ? `exists (${opsProject.id}), superAdmin=${Boolean(opsProject.superAdmin)}` : 'CREATE (superAdmin=true, holds only the operator identity)'}`);
  log(` 2. operator membership ${OPERATOR_EMAIL ? '(dedicated identity)' : ''}: ${opsProject ? 'verify/ensure' : 'CREATE with generated password file ' + OPERATOR_PW_FILE}`);
  log(` 3. policy "${CLINIC_POLICY_NAME}": ${clinicPolicy[0] ? (clinicPolicyStale ? 'UPDATE to current definition' : 'up to date') : 'CREATE'}`);
  log(` 4. policy "${APP_SERVER_POLICY_NAME}": ${appPolicyExisting[0] ? (appPolicyStale ? 'UPDATE' : 'up to date') : 'CREATE'}`);
  log(` 4b. staff directory: ${dirChanges.length} Practitioner(s) need meta.accounts synced from their active PractitionerRoles`);
  log(` 5. app client membership ${appClient.id}: admin=${Boolean(appClient.admin)} policy=${appClient.accessPolicy?.reference || 'none'} -> admin + ${APP_SERVER_POLICY_NAME}`);
  log(` 6. staff memberships: ${staff.length} non-admin Practitioner(s); unpoliced=${unpoliced.length} (blocker), foreign/old policy=${wrongPolicy.length}, parameter refresh=${needParamRefresh.length}`);
  for (const m of unpoliced) log(`      BLOCKER ProjectMembership/${m.id} (${m.profile?.reference}) has no active clinic assignment; fix PractitionerRole first`);
  log(` 7. cut-over: project superAdmin ${Boolean(proj.superAdmin)} -> false, name "${proj.name}" -> "${RENAME}", link to base "FHIR R4" project: ${st.baseProject ? ((proj.link || []).some((l) => l.project?.reference === `Project/${st.baseProject.id}`) ? 'present' : 'ADD') : 'base project not found (skipped)'}`);
  const admins = st.memberships.filter((m) => m.admin && !isClient(m));
  log(` 8. ${admins.length} human project admin membership(s) keep admin=true (project-scoped admin, no superAdmin)`);
  for (const m of wrongPolicy) log(`      BLOCKER ProjectMembership/${m.id} (${m.profile?.reference}) uses a policy other than "${CLINIC_POLICY_NAME}": review/remove it (this script never repoints a hand-set policy)`);
  if (unpoliced.length || wrongPolicy.length) { log('\nRESULT: BLOCKED (see BLOCKER lines)'); process.exit(APPLY ? 1 : 3); }
  if (!APPLY) { log('\nDRY-RUN complete. Nothing was written. Re-run with --apply to execute.'); return; }
  if (cutOver && !opsProject) die('project already cut over but operator project missing: refusing to continue');

  // --------------------------------------------------------------- backups
  if (!fs.existsSync(PRE_FILE)) {
    const snap = {
      kind: 'task5-pre', at: new Date().toISOString(), projectId: PROJECT_ID, server: base.origin,
      project: proj, clinicPolicy: clinicPolicy[0] || null, appPolicy: appPolicyExisting[0] || null,
      memberships: st.memberships, staffAccess: Object.fromEntries(plannedStaffAccess), opsProjectExisted: Boolean(opsProject),
    };
    snap.directory = dirChanges;
    fs.writeFileSync(PRE_FILE, JSON.stringify(snap, null, 2), { mode: 0o600, flag: 'wx' });
    log(`pre-change snapshot written: ${PRE_FILE}`);
  } else {
    const prior = JSON.parse(fs.readFileSync(PRE_FILE, 'utf8'));
    if (prior.server !== base.origin || prior.projectId !== PROJECT_ID) die('Snapshot target mismatch');
    log(`pre-change snapshot kept (never overwritten): ${PRE_FILE}`);
  }

  const manifest = fs.existsSync(MANIFEST_FILE)
    ? JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))
    : { server: base.origin, projectId: PROJECT_ID, policies: {} };
  if (manifest.server !== base.origin || manifest.projectId !== PROJECT_ID) die('Manifest target mismatch');
  const saveManifest = () => {
    fs.writeFileSync(MANIFEST_FILE + '.tmp', JSON.stringify(manifest), { mode: 0o600 });
    fs.renameSync(MANIFEST_FILE + '.tmp', MANIFEST_FILE);
  };
  // ------------------------------------------------------------ step 1 + 2
  let ops = opsProject;
  if (!ops) {
    const r = await f('POST', 'Project', { resourceType: 'Project', name: OPS_NAME });
    if (r.status !== 201) die(`operator project create failed (${r.status})${reason(r)}`);
    ops = r.json; manifest.operatorProjectId = ops.id; saveManifest(); log(`created operator project ${ops.id}`);
  }
  if (!ops.superAdmin) {
    if (manifest.operatorProjectId !== ops.id) die('Refusing to promote a pre-existing unowned project');
    const r = await f('PUT', `Project/${ops.id}`, { ...ops, superAdmin: true });
    if (r.status !== 200) die(`operator project superAdmin update failed (${r.status})${reason(r)}`);
    ops = r.json; log('operator project set superAdmin=true');
  }
  const opsMembers = await searchAll(f, `ProjectMembership?project=Project/${ops.id}&_count=100`);
  let opPw = process.env.OPERATOR_PASSWORD || (fs.existsSync(OPERATOR_PW_FILE) ? fs.readFileSync(OPERATOR_PW_FILE, 'utf8').trim() : '');
  if (opsMembers.length && (opsMembers.length !== 1 || !opsMembers[0].admin)) die('Operator project must contain exactly one dedicated admin');
  if (!opsMembers.length) {
    const existing = await searchAll(f, `User?email=${encodeURIComponent(OPERATOR_EMAIL)}&_count=100`);
    if (existing.length) die('Operator email already exists: refusing to reuse a clinical/global identity');
    if (!opPw) { opPw = crypto.randomBytes(24).toString('base64url'); fs.writeFileSync(OPERATOR_PW_FILE, opPw + '\n', { mode: 0o600 }); log(`operator password generated -> ${OPERATOR_PW_FILE} (0600, never printed)`); }
    const r = await raw(sess.token, 'POST', `admin/projects/${ops.id}/invite`, { resourceType: 'Practitioner', firstName: 'UCC', lastName: 'Operator', email: OPERATOR_EMAIL, password: opPw, sendEmail: false, admin: true });
    if (r.status !== 200 && r.status !== 201) die(`operator invite failed (${r.status})`);
    log('operator membership created in operator project');
  }
  // ------------------------------------------------------------ step 3 + 4
  const upsertPolicy = async (existing, name, resource) => {
    const knownId = manifest.policies[name];
    if (existing && knownId && existing.id !== knownId) die('Policy identity drift');
    if (!manifest.policies[name]) { manifest.policies[name] = existing?.id || crypto.randomUUID(); saveManifest(); }
    if (existing) {
      if (isDeepStrictEqual(existing.resource, resource)) return existing;
      const r = await f('PUT', `AccessPolicy/${existing.id}`, { ...existing, resource });
      if (r.status !== 200) die(`policy ${name} update failed (${r.status})${reason(r)}`);
      log(`policy "${name}" updated (${existing.id})`); return r.json;
    }
    // POST intentionally replaces client IDs. Pinned 5.2.15 repo.canSetId and
    // fhir-router.updateResourceImpl support PUT of a new UUID for super admins.
    const plannedId = manifest.policies[name];
    const collision = await f('GET', `AccessPolicy/${plannedId}`);
    if (![404,410].includes(collision.status)) die('Planned policy ID already exists; review before retry');
    const r = await f('PUT', `AccessPolicy/${plannedId}`, { resourceType: 'AccessPolicy', id: plannedId, meta: { project: PROJECT_ID }, name, resource });
    if (r.status !== 200 || r.json?.id !== plannedId) die(`policy ${name} create failed (${r.status})`);
    log(`policy "${name}" created (${r.json.id})`); return r.json;
  };
  for (const c of dirChanges) {
    const r = await f('POST', `${c.pr}/$set-accounts`, { resourceType: 'Parameters', parameter: [...c.accounts.map((a) => ({ name: 'accounts', valueReference: { reference: a } })), { name: 'propagate', valueBoolean: false }] });
    if (r.status !== 200) die(`directory stamp ${c.pr} failed (${r.status})${reason(r)}`);
  }
  if (dirChanges.length) log(`staff directory: stamped ${dirChanges.length} Practitioner(s)`);
  const cp = await upsertPolicy(clinicPolicy[0], CLINIC_POLICY_NAME, wantClinic);
  const ap = await upsertPolicy(appPolicyExisting[0], APP_SERVER_POLICY_NAME, wantApp);
  // ------------------------------------------------------------ step 5 + 6
  for (const m of staff) {
    const desired = canonicalAccess(m).map(a => ({ ...a, policy: { reference: `AccessPolicy/${cp.id}` } }));
    if (isDeepStrictEqual(desired, m.access) && !m.accessPolicy) continue;
    const r = await f('PUT', `ProjectMembership/${m.id}`, { ...m, accessPolicy: undefined, access: desired });
    if (r.status !== 200) die(`staff membership ${m.id} update failed (${r.status})${reason(r)}`);
    log(`staff membership ${m.id}: access[] normalised`);
  }
  if (!appClient.admin || appClient.access?.length || appClient.accessPolicy?.reference !== `AccessPolicy/${ap.id}`) {
    const r = await f('PUT', `ProjectMembership/${appClient.id}`, { ...appClient, access: undefined, admin: true, accessPolicy: { reference: `AccessPolicy/${ap.id}` } });
    if (r.status !== 200) die(`app client membership update failed (${r.status})${reason(r)}`);
    log(`app client membership ${appClient.id}: now ${APP_SERVER_POLICY_NAME}`);
  }
  // --------------------------------------------------------- verify operator
  const op = await login({ email: OPERATOR_EMAIL, password: opPw }, ops.id);
  if (op.error || !op.me?.project?.superAdmin || op.me.project.id !== ops.id) die(`operator login verification failed (${op.error || 'not superAdmin in operator project'}); NOT cutting over`);
  const verifiedOperators = await searchAll(f, `ProjectMembership?project=Project/${ops.id}&_count=100`);
  if (verifiedOperators.length !== 1 || !verifiedOperators[0].admin || !verifiedOperators[0].user?.reference) die('Operator membership is not dedicated');
  const operatorMemberships = await searchAll(f, `ProjectMembership?user=${encodeURIComponent(verifiedOperators[0].user.reference)}&_count=100`);
  if (operatorMemberships.length !== 1 || operatorMemberships[0].project?.reference !== `Project/${ops.id}`) die('Operator identity must belong only to the operator project');
  log('operator login verified (superAdmin in operator project, dedicated identity)');
  // ----------------------------------------------------------- step 7: flip
  const fo = F(op); _tok = op.token;
  const cur = (await fo('GET', `Project/${PROJECT_ID}`)).json;
  const link = [...(cur.link || [])];
  if (st.baseProject && !link.some((l) => l.project?.reference === `Project/${st.baseProject.id}`)) link.push({ project: { reference: `Project/${st.baseProject.id}` } });
  const next = { ...cur, name: RENAME, superAdmin: false, link: link.length ? link : undefined };
  const needsCutover = !isDeepStrictEqual(cur, next);
  const r = needsCutover ? await fo('PUT', `Project/${PROJECT_ID}`, next) : { status: 200 };
  if (r.status !== 200) die(`cut-over failed (${r.status}); run --rollback --apply if anything looks wrong`);
  const after = (await fo('GET', `Project/${PROJECT_ID}`)).json;
  if (after.id !== PROJECT_ID) die('Cut-over identity mismatch');
  if (after.superAdmin) die('cut-over verification failed: project still superAdmin');
  log(`CUT OVER: project ${PROJECT_ID} superAdmin=false name="${after.name}"`);
  log('\nNext: restart nothing; run scripts/access-policy/verify-clinic-isolation.mjs and the app regression suite.');
}

async function rollback(f, st, sess, mode) {
  if (!fs.existsSync(PRE_FILE)) die(`no pre-change snapshot at ${PRE_FILE}`);
  const snap = JSON.parse(fs.readFileSync(PRE_FILE, 'utf8'));
  const manifest = fs.existsSync(MANIFEST_FILE) ? JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8')) : undefined;
  if (manifest && (manifest.server !== base.origin || manifest.projectId !== PROJECT_ID)) die('Manifest target mismatch');
  for (const [name, before] of [[CLINIC_POLICY_NAME, snap.clinicPolicy], [APP_SERVER_POLICY_NAME, snap.appPolicy]]) {
    const candidates = st.named(name);
    if (candidates.length > 1) die('Ambiguous rollback policy');
    const expectedId = before?.id || manifest?.policies[name];
    if (candidates.length && (!expectedId || candidates[0].id !== expectedId)) die('Policy identity drift; rollback refused');
  }
  if (snap.server !== base.origin || snap.projectId !== PROJECT_ID) die('snapshot is for another project');
  log('\nROLLBACK PLAN (from ' + PRE_FILE + ')');
  const cur = st.project;
  log(` 1. project superAdmin ${Boolean(cur.superAdmin)} -> ${Boolean(snap.project.superAdmin)}, name "${cur.name}" -> "${snap.project.name}", links restored (${(snap.project.link || []).length})`);
  const diffs = [];
  for (const m of snap.memberships) {
    const now = st.memberships.find((x) => x.id === m.id);
    if (!now) { diffs.push([m, 'MISSING now (not recreated by rollback)']); continue; }
    if (!isDeepStrictEqual(now.access, m.access) || !isDeepStrictEqual(now.accessPolicy, m.accessPolicy) || Boolean(now.admin) !== Boolean(m.admin)) diffs.push([m, 'restore access/accessPolicy/admin']);
  }
  log(` 2. memberships to restore: ${diffs.filter(([, a]) => a.startsWith('restore')).length}`);
  for (const [m, a] of diffs) log(`      ProjectMembership/${m.id}: ${a}`);
  if (snap.clinicPolicy) log(` 3. restore "${CLINIC_POLICY_NAME}" to the pre-change definition (${snap.clinicPolicy.resource?.length} rules)`);
  log(` 4. "${APP_SERVER_POLICY_NAME}": ${snap.appPolicy ? 'restore pre-change definition' : 'delete (created by this migration)'}`);
  log(' 5. operator retained for recovery; remove manually only after successful verification');
  log(` 6. restore ${(snap.directory || []).length} directory account snapshots`);
  if (!cur.superAdmin && mode !== 'operator') die('need the operator session to restore superAdmin');
  // Preview and apply share the same preflight. Restoring superAdmin elevates
  // every current member, including identities absent from the snapshot.
  const savedIds = new Set(snap.memberships.map(m => m.id));
  if (st.memberships.some(m => !savedIds.has(m.id))) die('Membership inventory drift; rollback refused');
  for (const before of snap.memberships) {
    const now = st.memberships.find(m => m.id === before.id);
    if (!now || !isDeepStrictEqual([now.project, now.user, now.profile, now.active], [before.project, before.user, before.profile, before.active])) die('Membership identity/status drift; rollback refused');
  }
  const expectedLinks = [...(snap.project.link || [])];
  if (st.baseProject && !expectedLinks.some(l => l.project?.reference === `Project/${st.baseProject.id}`)) expectedLinks.push({ project: { reference: `Project/${st.baseProject.id}` } });
  if (![snap.project.name, RENAME].includes(cur.name)
      || (!isDeepStrictEqual(cur.link || [], snap.project.link || []) && !isDeepStrictEqual(cur.link || [], expectedLinks))) die('Project topology drift; rollback refused');
  // Validate drift before changing any backed-up document. Operational freeze is required.
  for (const [old, action] of diffs) {
    if (!action.startsWith('restore')) die('Missing backed-up membership; rollback refused');
    const now = st.memberships.find(x => x.id === old.id);
    const isApp = isClient(old);
    const expected = isApp
      ? { ...old, access: undefined, admin: true, accessPolicy: { reference: `AccessPolicy/${st.named(APP_SERVER_POLICY_NAME)[0]?.id}` } }
      : { ...old, accessPolicy: undefined, access: (snap.staffAccess?.[old.id] || canonicalAccess(old)).map(a => ({ ...a, policy: { reference: `AccessPolicy/${st.named(CLINIC_POLICY_NAME)[0]?.id}` } })) };
    if (!isDeepStrictEqual([now.access, now.accessPolicy, now.admin], [expected.access, expected.accessPolicy, expected.admin])) die('Grant drift; rollback refused before writes');
  }
  for (const item of snap.directory || []) {
    const current = await raw(_tok, 'GET', `fhir/R4/${item.pr}`, undefined, { 'X-Medplum': 'extended' });
    const have = (current.json?.meta?.accounts || []).map(a => a.reference).sort();
    if (!isDeepStrictEqual(have, item.accounts) && !isDeepStrictEqual(have, item.before)) die('Directory account drift; rollback refused');
  }
  // Order: policies+memberships first (still scoped by the current mode), flip last.
  for (const [name, desired, before] of [[CLINIC_POLICY_NAME, clinicStaffPolicyResources(), snap.clinicPolicy], [APP_SERVER_POLICY_NAME, appServerPolicyResources(), snap.appPolicy]]) {
    const live = st.named(name)[0];
    if (before && !live) die('Missing backed-up policy; rollback refused');
    if (live && !isDeepStrictEqual(live.resource, desired) && !isDeepStrictEqual(live.resource, before?.resource)) die('Policy drift; rollback refused');
  }
  if (!APPLY) { log('\nDRY-RUN complete. Drift checks passed; nothing was written.'); return; }
  if (snap.clinicPolicy) {
    const live = st.named(CLINIC_POLICY_NAME)[0];
    if (live && !isDeepStrictEqual(live.resource, snap.clinicPolicy.resource)) {
      const r = await f('PUT', `AccessPolicy/${live.id}`, { ...live, resource: snap.clinicPolicy.resource });
      if (r.status !== 200) die(`clinic policy restore failed (${r.status})`); log('clinic policy restored');
    }
  }
  for (const [m, a] of diffs) {
    if (!a.startsWith('restore')) continue;
    const now = st.memberships.find((x) => x.id === m.id);
    const r = await f('PUT', `ProjectMembership/${m.id}`, { ...now, access: m.access, accessPolicy: m.accessPolicy, admin: m.admin });
    if (r.status !== 200) die(`membership ${m.id} restore failed (${r.status})`); log(`membership ${m.id} restored`);
  }
  if (!snap.clinicPolicy) {
    const cp = st.named(CLINIC_POLICY_NAME)[0];
    if (cp) { const deleted = await f('DELETE', `AccessPolicy/${cp.id}`); if (![200,204].includes(deleted.status)) die('Clinic policy delete failed'); }
  }
  const app = st.named(APP_SERVER_POLICY_NAME)[0];
  if (app && !snap.appPolicy) { const r = await f('DELETE', `AccessPolicy/${app.id}`); if (![200,204].includes(r.status)) die('App policy delete failed'); log('App server policy deleted'); }
  else if (app && snap.appPolicy) { const saved = await f('PUT', `AccessPolicy/${app.id}`, { ...app, resource: snap.appPolicy.resource }); if (saved.status !== 200) die('App policy restore failed'); }
  for (const item of snap.directory || []) {
    const restored = await f('POST', `${item.pr}/$set-accounts`, { resourceType: 'Parameters', parameter: [
      ...item.before.map(reference => ({ name: 'accounts', valueReference: { reference } })),
      { name: 'propagate', valueBoolean: false },
    ] });
    if (restored.status !== 200) die('Directory restore failed');
  }
  const live = (await f('GET', `Project/${PROJECT_ID}`)).json;
  const r = await f('PUT', `Project/${PROJECT_ID}`, { ...live, name: snap.project.name, superAdmin: snap.project.superAdmin || false, link: snap.project.link });
  if (r.status !== 200) die(`project restore failed (${r.status})`);
  log(`project restored: superAdmin=${Boolean((await f('GET', `Project/${PROJECT_ID}`)).json.superAdmin)}`);
  log('ROLLBACK complete.');
}

try { await main(); } catch (e) { console.error('ERROR: migration failed; inspect status-only output and use rollback after reviewing drift'); process.exit(2); }
