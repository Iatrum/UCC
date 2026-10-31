// Task 5b: verify the UCC Local Staff Containment policy actually contains a
// non-admin staff member when the Medplum *project* is NOT superAdmin (the
// local dev project is superAdmin:true, which bypasses policy/project
// scoping entirely -- see .ai/research/task5-access-policy.md "Discrepancy
// resolved"). This creates a disposable non-superAdmin project with fake
// data, applies the existing containment policy to one staff member, and
// runs negative FHIR tests plus a no-policy control.
//
// Out of scope: cross-clinic clinical isolation (Patient/Encounter/etc. are
// not clinic-scoped by this policy at all). See ucc-local-staff-containment.json
// and .ai/research/task5-access-policy.md for why that is a separate,
// larger change; this script only exercises staff-directory containment.
//
// Safety: localhost:8113 only; never logs tokens, passwords or response
// bodies; only status codes, counts and booleans are printed/written.
// Pass --keep to leave the created fake identities in place for inspection
// (default: torn down at the end regardless of pass/fail).
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { randomBytes, createHash } from 'node:crypto';

class SafeError extends Error {}
const fail = (message) => { throw new SafeError(message); };
const created = new Map();
let untrackedCreation = false;
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9.-]{1,64}$/.test(id);
function requireResource(resource, type, id) {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)
    || typeof resource.resourceType !== 'string' || !/^[A-Z][A-Za-z]+$/.test(resource.resourceType)
    || !validId(resource.id) || (type && resource.resourceType !== type) || (id && resource.id !== id)) {
    fail('Malformed resource response or unexpected identity');
  }
  return resource;
}
function track(type, id) {
  if (!/^[A-Z][A-Za-z]+$/.test(type) || !validId(id)) {
    untrackedCreation = true;
    fail('Created resource identity unavailable for cleanup');
  }
  created.set(`${type}/${id}`, { type, id });
}
const NARRATIVE_SENTINEL = 'TASK5B-FAKE-NARRATIVE-SENTINEL';
const narrative = { status: 'generated', div: `<div xmlns="http://www.w3.org/1999/xhtml">${NARRATIVE_SENTINEL}</div>` };
const masked = (r) => !Object.hasOwn(r, 'telecom') && !Object.hasOwn(r, 'text')
  && !JSON.stringify(r).includes(NARRATIVE_SENTINEL);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const KEEP = process.argv.includes('--keep');
if (process.argv.slice(2).some((a) => !['--keep'].includes(a))) fail('Unknown argument');

const base = new URL(process.env.MEDPLUM_BASE_URL || 'http://localhost:8113');
if (
  !['http:', 'https:'].includes(base.protocol) ||
  !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) ||
  base.port !== '8113' || base.username || base.password ||
  base.pathname !== '/' || base.search || base.hash
) fail('Only localhost Medplum on port 8113 is allowed');

const ADMIN_EMAIL = process.env.MEDPLUM_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.MEDPLUM_ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) fail('MEDPLUM_ADMIN_EMAIL and MEDPLUM_ADMIN_PASSWORD required');

const PROJECT_NAME = 'UCC Task5 NonSuperAdmin Test';
const POLICY_PATH = new URL('./ucc-local-staff-containment.json', import.meta.url);
const DESIRED_POLICY = JSON.parse(fs.readFileSync(POLICY_PATH));
const PROJECT_ADMIN = { firstName: 'Task5b', lastName: 'ProjectAdmin', email: 'task5b-admin@example.invalid' };
const DOCTOR_A = { firstName: 'Task5b', lastName: 'DoctorA', email: 'task5b-doctora@example.invalid' };
const STAFF_B = { firstName: 'Task5b', lastName: 'StaffB', email: 'task5b-staffb@example.invalid' };
const CLINIC_A = { system: 'clinic', value: 'task5-a', name: 'Task5b Clinic A' };
const CLINIC_B = { system: 'clinic', value: 'task5-b', name: 'Task5b Clinic B' };

const EVIDENCE_DIR = '/workspace/ai-logs/task5b';
fs.mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 });
const LOCK_FILE = `${EVIDENCE_DIR}/test.lock`;
const evidenceLines = [];
const log = (line) => { evidenceLines.push(line); console.log(line); };
const writeEvidence = () => fs.writeFileSync(`${EVIDENCE_DIR}/evidence2.txt`, evidenceLines.join('\n') + '\n', { mode: 0o600 });

let lockFd;
function acquireLock() {
  try { lockFd = fs.openSync(LOCK_FILE, 'wx', 0o600); }
  catch { fail('Another run is in progress (test.lock present); verify no other run is active before removing it'); }
}
function releaseLock() {
  if (lockFd === undefined) return;
  try { fs.closeSync(lockFd); } catch { process.exitCode = 1; }
  lockFd = undefined;
  try { fs.unlinkSync(LOCK_FILE); } catch { process.exitCode = 1; }
}

const localFetch = (url, init) => {
  if (new URL(url).origin !== base.origin) fail('Nonlocal request refused');
  return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(30000) });
};

async function request(token, relative, method = 'GET', body, headers = {}) {
  const url = new URL(relative, base);
  if (url.origin !== base.origin || !url.pathname.startsWith('/')) fail('Nonlocal request refused');
  const res = await localFetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/fhir+json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => undefined);
  if (method === 'POST' && res.ok && !url.pathname.endsWith('/_search')) {
    const fhirType = url.pathname.match(/^\/fhir\/R4\/([A-Za-z]+)$/)?.[1];
    if (fhirType) {
      const location = res.headers.get('location');
      const locationPath = location ? new URL(location, base).pathname : '';
      const locationId = locationPath.match(new RegExp(`/fhir/R4/${fhirType}/([^/]+)(?:/_history/[^/]+)?$`))?.[1];
      track(fhirType, validId(json?.id) ? json.id : locationId);
      requireResource(json, fhirType);
    } else if (url.pathname.endsWith('/invite')) {
      // Register each side effect before validating the full invitation.
      for (const [type, id] of [['ProjectMembership', json?.id],
        ['Practitioner', json?.profile?.reference?.split('/')[1]], ['User', json?.user?.reference?.split('/')[1]]]) {
        if (validId(id)) track(type, id);
        else untrackedCreation = true;
      }
      requireResource(json, 'ProjectMembership');
      if (!/^Practitioner\/[A-Za-z0-9.-]+$/.test(json.profile?.reference)
        || !/^User\/[A-Za-z0-9.-]+$/.test(json.user?.reference)) fail('Malformed invite references');
    }
  }
  if (res.status === 403 && (json?.resourceType !== 'OperationOutcome'
    || !Array.isArray(json.issue) || json.issue.length === 0
    || json.issue.some((issue) => !issue || typeof issue.code !== 'string' || typeof issue.severity !== 'string'))) {
    fail('Malformed denial response');
  }
  if (res.ok && url.pathname.startsWith('/fhir/R4/') && method !== 'DELETE') {
    const parts = url.pathname.split('/').slice(3);
    if (parts.length >= 2 && parts[1] !== '_search' && parts.at(-1) !== '_history') {
      requireResource(json, parts[0], parts[1]);
      if (parts[2] === '_history' && json.meta?.versionId !== parts[3]) fail('Unexpected vread version');
    }
  }
  return { status: res.status, json };
}

async function login(email, password, projectId) {
  const verifier = randomBytes(32).toString('base64url');
  const loginBody = {
    email, password,
    codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    codeChallengeMethod: 'S256',
  };
  if (projectId) loginBody.projectId = projectId;
  const loginRes = await localFetch(new URL('auth/login', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(loginBody),
  });
  if (!loginRes.ok) fail(`Login failed (${loginRes.status})`);
  const loginJson = await loginRes.json();
  if (!loginJson.code) fail('Login code required');
  const tokenRes = await localFetch(new URL('oauth2/token', base), {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: loginJson.code, code_verifier: verifier }),
  });
  if (!tokenRes.ok) fail('Token exchange failed');
  const tok = await tokenRes.json();
  if (!tok.access_token) fail('Access token required');
  return tok.access_token;
}

// Follows every `next` link; validates that non-denied responses are a
// well-formed Bundle. Returns { pages, deniedStatus } -- deniedStatus is set
// (and paging stops) the first time a page does not return 200.
async function collectPages(token, firstRelative, { maxPages = 25 } = {}) {
  const pages = [];
  const visited = new Set();
  let next = firstRelative;
  let pageCount = 0;
  let deniedStatus = null;
  while (next) {
    if (visited.has(next)) fail('Repeated search page');
    visited.add(next);
    pageCount += 1;
    if (pageCount > maxPages) fail('Too many search pages');
    const { status, json } = await request(token, next);
    if (status !== 200) { deniedStatus = status; break; }
    if (json?.resourceType !== 'Bundle' || !Array.isArray(json.entry ?? [])) fail(`Malformed search response (expected Bundle) at ${next}`);
    if (!['searchset', 'history'].includes(json.type)
      || (json.link !== undefined && (!Array.isArray(json.link) || json.link.some((l) =>
        !l || typeof l.relation !== 'string' || typeof l.url !== 'string')))) fail('Malformed Bundle');
    const expectedType = new URL(firstRelative, base).pathname.split('/')[3];
    const allowsIncludes = /[?&]_(?:rev)?include=/.test(firstRelative);
    for (const entry of json.entry ?? []) {
      requireResource(entry?.resource, allowsIncludes ? undefined : expectedType);
    }
    pages.push(json);
    next = json.link?.find((l) => l.relation === 'next')?.url;
  }
  return { pages, deniedStatus };
}
const entriesOf = (pages) => pages.flatMap((p) => p.entry ?? []).map((e) => e.resource);

// --- Step 1: idempotent non-superAdmin Project -----------------------------
async function ensureProject(saToken) {
  const { pages, deniedStatus } = await collectPages(saToken, `fhir/R4/Project?name=${encodeURIComponent(PROJECT_NAME)}&_count=100`);
  if (deniedStatus !== null) fail(`Project search failed (${deniedStatus})`);
  const matches = entriesOf(pages).filter((r) => r?.resourceType === 'Project' && r.name === PROJECT_NAME);
  if (matches.length > 1) fail('Ambiguous project name');
  let project = matches[0];
  if (!project) {
    const { status, json } = await request(saToken, 'fhir/R4/Project', 'POST', { resourceType: 'Project', name: PROJECT_NAME });
    if (status !== 201 && status !== 200) fail(`Project create failed (${status})`);
    project = json;
  }
  const { status: rs, json: reread } = await request(saToken, `fhir/R4/Project/${project.id}`);
  if (rs !== 200) fail('Project reread failed');
  if (reread.superAdmin) fail('Project unexpectedly superAdmin:true');
  return reread.id;
}

// A User is a global (cross-project) resource. Only delete it once no
// ProjectMembership anywhere still references it.
async function remainingMembershipCountForUser(saToken, userRef) {
  const { pages, deniedStatus } = await collectPages(saToken, `fhir/R4/ProjectMembership?user=${encodeURIComponent(userRef)}&_count=100`);
  if (deniedStatus !== null) fail(`Membership-by-user search failed (${deniedStatus})`);
  return entriesOf(pages).length;
}

async function deleteOwnedIdentity(saToken, { membershipId, practitionerId, userRef }) {
  const statuses = {};
  const roles = await collectPages(saToken, `fhir/R4/PractitionerRole?practitioner=Practitioner/${practitionerId}&_count=100`);
  if (roles.deniedStatus !== null) fail('Role cleanup search failed');
  for (const role of entriesOf(roles.pages)) {
    const deleted = await request(saToken, `fhir/R4/PractitionerRole/${role.id}`, 'DELETE');
    if (![200, 204, 404, 410].includes(deleted.status)) fail('Role cleanup delete failed');
  }
  const delMembership = await request(saToken, `fhir/R4/ProjectMembership/${membershipId}`, 'DELETE');
  statuses.membership = delMembership.status;
  if (![200, 204, 404].includes(delMembership.status)) fail(`Membership delete failed (${delMembership.status})`);
  const delPractitioner = await request(saToken, `fhir/R4/Practitioner/${practitionerId}`, 'DELETE');
  statuses.practitioner = delPractitioner.status;
  if (![200, 204, 404].includes(delPractitioner.status)) fail(`Practitioner delete failed (${delPractitioner.status})`);
  if (userRef) {
    const remaining = await remainingMembershipCountForUser(saToken, userRef);
    if (remaining === 0) {
      const userId = userRef.split('/')[1];
      const delUser = await request(saToken, `fhir/R4/User/${userId}`, 'DELETE');
      statuses.user = delUser.status;
      if (![200, 204, 404].includes(delUser.status)) fail(`User delete failed (${delUser.status})`);
    } else {
      statuses.user = 'skipped-shared';
    }
  }
  return statuses;
}

// --- Idempotency: remove any stale fake identities in this project ---------
async function cleanupExistingIdentities(saToken, projectId, targetEmails) {
  const { pages, deniedStatus } = await collectPages(saToken, `fhir/R4/ProjectMembership?project=Project/${projectId}&_count=100`);
  if (deniedStatus !== null) fail(`Membership listing failed (${deniedStatus})`);
  let removed = 0;
  for (const membership of entriesOf(pages)) {
    const profileRef = membership.profile?.reference;
    if (!profileRef?.startsWith('Practitioner/')) continue;
    const { status, json: practitioner } = await request(saToken, `fhir/R4/${profileRef}`);
    if (status !== 200) continue;
    const email = practitioner.telecom?.find((t) => t.system === 'email')?.value;
    if (!email || !targetEmails.includes(email)) continue;
    await deleteOwnedIdentity(saToken, { membershipId: membership.id, practitionerId: profileRef.split('/')[1], userRef: membership.user?.reference });
    removed += 1;
  }
  return removed;
}

// --- Step 2: invite a fake identity via the admin invite API ---------------
async function invite(saToken, projectId, { firstName, lastName, email, admin, accessPolicyReference }) {
  const password = randomBytes(24).toString('base64url');
  const body = { resourceType: 'Practitioner', firstName, lastName, email, password, sendEmail: false, admin };
  if (accessPolicyReference) body.accessPolicy = { reference: accessPolicyReference };
  const { status, json } = await request(saToken, `admin/projects/${projectId}/invite`, 'POST', body);
  if (status !== 200 || json?.resourceType !== 'ProjectMembership') fail(`Invite failed (${status})`);
  return {
    membershipId: json.id,
    practitionerId: json.profile.reference.split('/')[1],
    userRef: json.user?.reference,
    email, password,
  };
}

// --- Step 2: idempotent AccessPolicy / Organization / PractitionerRole -----
async function ensureAccessPolicy(scopedToken) {
  const { pages, deniedStatus } = await collectPages(scopedToken, 'fhir/R4/AccessPolicy?_count=100');
  if (deniedStatus !== null) fail(`AccessPolicy search failed (${deniedStatus})`);
  const matches = entriesOf(pages).filter((r) => r?.resourceType === 'AccessPolicy' && r.name === DESIRED_POLICY.name);
  if (matches.length > 1) fail('Ambiguous policy name');
  let policy = matches[0];
  if (policy && !isDeepStrictEqual(policy.resource, DESIRED_POLICY.resource)) fail('Existing policy differs from desired');
  if (!policy) {
    const { status, json } = await request(scopedToken, 'fhir/R4/AccessPolicy', 'POST', DESIRED_POLICY);
    if (status !== 201 && status !== 200) fail(`AccessPolicy create failed (${status})`);
    policy = json;
  }
  return policy.id;
}

async function ensureOrganization(scopedToken, clinic) {
  const identifier = `${clinic.system}|${clinic.value}`;
  const { pages, deniedStatus } = await collectPages(scopedToken, `fhir/R4/Organization?identifier=${encodeURIComponent(identifier)}&_count=100`);
  if (deniedStatus !== null) fail(`Organization search failed (${deniedStatus})`);
  const matches = entriesOf(pages).filter((r) => r?.resourceType === 'Organization');
  if (matches.length > 1) fail('Ambiguous organization identifier');
  if (matches[0]) return matches[0].id;
  const { status, json } = await request(scopedToken, 'fhir/R4/Organization', 'POST', {
    resourceType: 'Organization', name: clinic.name, identifier: [{ system: clinic.system, value: clinic.value }],
  });
  if (status !== 201 && status !== 200) fail(`Organization create failed (${status})`);
  return json.id;
}

// PractitionerRole carries its own telecom so the policy's hiddenFields can
// be exercised on a second resource type (not just Practitioner).
async function ensurePractitionerRole(scopedToken, practitionerId, organizationId, email) {
  const query = `fhir/R4/PractitionerRole?practitioner=Practitioner/${practitionerId}&organization=Organization/${organizationId}&_count=10`;
  const { pages, deniedStatus } = await collectPages(scopedToken, query);
  if (deniedStatus !== null) fail(`PractitionerRole search failed (${deniedStatus})`);
  const matches = entriesOf(pages).filter((r) => r?.resourceType === 'PractitionerRole');
  if (matches.length > 1) fail('Ambiguous PractitionerRole');
  if (matches[0]) return matches[0].id;
  const { status, json } = await request(scopedToken, 'fhir/R4/PractitionerRole', 'POST', {
    resourceType: 'PractitionerRole',
    practitioner: { reference: `Practitioner/${practitionerId}` },
    organization: { reference: `Organization/${organizationId}` },
    telecom: [{ system: 'email', value: email }],
    text: narrative,
  });
  if (status !== 201 && status !== 200) fail(`PractitionerRole create failed (${status})`);
  return json.id;
}

// --- Assertions --------------------------------------------------------
function recordFactory(results) {
  return async function record(name, fn) {
    try {
      const r = await fn();
      results.push({ name, status: r.status ?? '-', count: r.count ?? '-', pass: r.pass });
    } catch (error) {
      results.push({ name, status: 'ERROR', count: '-', pass: false });
      log(`assertion errored: ${name}${error instanceof SafeError ? `: ${error.message}` : ''}`);
    }
  };
}

async function assertDeniedOrNoOthers(token, resourceType, ownId) {
  const { pages, deniedStatus } = await collectPages(token, `fhir/R4/${resourceType}?_count=100`);
  if (deniedStatus !== null) return { status: deniedStatus, count: 0, pass: deniedStatus === 403 };
  const others = entriesOf(pages).filter((r) => r?.id !== ownId);
  return { status: 200, count: others.length, pass: others.length === 0 };
}

async function assertDirectoryMasked(token, resourceType, fixtureId) {
  const { pages, deniedStatus } = await collectPages(token, `fhir/R4/${resourceType}?_count=100`);
  if (deniedStatus !== null) return { status: deniedStatus, count: 0, pass: false };
  const entries = entriesOf(pages);
  const telecomCount = entries.filter((r) => r?.telecom?.length).length;
  const textCount = entries.filter((r) => r?.text).length;
  const fixtureFound = entries.some((r) => r?.id === fixtureId);
  return { status: 200, count: telecomCount, pass: fixtureFound && telecomCount === 0 && textCount === 0 && entries.every(masked) };
}

async function assertIncludeMasked(token, relative, practitionerId, roleId, includedType) {
  const { pages, deniedStatus } = await collectPages(token, relative);
  if (deniedStatus !== null) return { status: deniedStatus, count: 0, pass: false };
  const entries = entriesOf(pages);
  if (entries.length === 0) return { status: 200, count: 0, pass: false };
  const telecomCount = entries.filter((r) => r?.telecom?.length).length;
  return { status: 200, count: telecomCount, pass: entries.every(masked)
    && entries.some((r) => r.resourceType === 'Practitioner' && r.id === practitionerId)
    && entries.some((r) => r.resourceType === 'PractitionerRole' && r.id === roleId)
    && pages.some((p) => p.entry?.some((e) => e.search?.mode === 'include'
      && e.resource.resourceType === includedType
      && e.resource.id === (includedType === 'Practitioner' ? practitionerId : roleId))) };
}

async function assertDirectReadMasked(token, resourceType, id) {
  const { status, json } = await request(token, `fhir/R4/${resourceType}/${id}`);
  if (status !== 200) return { status, count: 0, pass: false };
  const telecomCount = json?.telecom?.length ?? 0;
  return { status, count: telecomCount, pass: masked(json) };
}

async function assertElementsMasked(token, resourceType, id) {
  const { status, json } = await request(token, `fhir/R4/${resourceType}/${id}?_elements=telecom`);
  if (status !== 200) return { status, count: 0, pass: false };
  const telecomCount = json?.telecom?.length ?? 0;
  return { status, count: telecomCount, pass: masked(json) };
}

async function assertHistoryMasked(token, resourceType, id) {
  const { pages, deniedStatus } = await collectPages(token, `fhir/R4/${resourceType}/${id}/_history?_count=100`);
  if (deniedStatus !== null) return { status: deniedStatus, count: 0, pass: false };
  const entries = entriesOf(pages);
  if (entries.length === 0) return { status: 200, count: 0, pass: false };
  const telecomCount = entries.filter((r) => r?.telecom?.length).length;
  for (const resource of entries) requireResource(resource, resourceType, id);
  return { status: 200, count: telecomCount, pass: entries.every(masked) };
}

async function assertMutationDenied(token, method, relative, body, headers) {
  const { status } = await request(token, relative, method, body, headers);
  return { status, count: 0, pass: status === 403 };
}

async function assertDoctorAuthContext(doctorAMe, saToken, membershipId, projectId, policyId, practitionerId) {
  // Medplum omits boolean `superAdmin` entirely when false (confirmed
  // empirically against this server), so "explicitly false" is expressed
  // as `!== true`, not a literal `=== false` -- there is no other way to
  // observe a false boolean on this API.
  const basics = doctorAMe.status === 200
    && doctorAMe.json.project?.id === projectId
    && doctorAMe.json.project?.superAdmin !== true
    && doctorAMe.json.project?.resourceType === 'Project'
    && doctorAMe.json.membership?.resourceType === 'ProjectMembership'
    && doctorAMe.json.membership?.id === membershipId
    && doctorAMe.json.membership?.profile?.reference === `Practitioner/${practitionerId}`
    && doctorAMe.json.profile?.resourceType === 'Practitioner'
    && doctorAMe.json.profile?.id === practitionerId
    && doctorAMe.json.membership?.admin !== true;
  const memRead = await request(saToken, `fhir/R4/ProjectMembership/${membershipId}`);
  // auth/me deliberately omits membership.project; bind its exact membership
  // ID to the persisted project's reference instead (server auth/me.ts).
  const policyAssigned = memRead.status === 200 && memRead.json.accessPolicy?.reference === `AccessPolicy/${policyId}`
    && memRead.json.project?.reference === `Project/${projectId}`
    && memRead.json.profile?.reference === `Practitioner/${practitionerId}`;
  return { status: doctorAMe.status, count: '-', pass: basics && policyAssigned };
}

async function run() {
  acquireLock();
  let saToken, projectId, projectAdmin, doctorA, staffB;
  try {
    log(`=== Task 5b non-superAdmin containment retest ===`);
    saToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const saMe = await request(saToken, 'auth/me');
    if (saMe.status !== 200 || !saMe.json.membership?.admin || saMe.json.project?.superAdmin !== true) {
      fail('MEDPLUM_ADMIN_EMAIL/PASSWORD must be the local superAdmin');
    }
    log(`admin login: status=${saMe.status} membership.admin=${!!saMe.json.membership?.admin} project.superAdmin=${saMe.json.project?.superAdmin === true}`);

    projectId = await ensureProject(saToken);
    log(`project ensured: superAdmin=false`);

    const targetEmails = [PROJECT_ADMIN.email, DOCTOR_A.email, STAFF_B.email];
    const removed = await cleanupExistingIdentities(saToken, projectId, targetEmails);
    log(`cleanup: removedStaleIdentities=${removed}`);

    await sleep(3000);
    projectAdmin = await invite(saToken, projectId, { ...PROJECT_ADMIN, admin: true });
    log(`project admin invited: membershipCreated=${!!projectAdmin.membershipId}`);

    await sleep(3000);
    const adminToken = await login(projectAdmin.email, projectAdmin.password, projectId);
    const adminMe = await request(adminToken, 'auth/me');
    log(`project-admin login: status=${adminMe.status} membership.admin=${!!adminMe.json.membership?.admin} project.superAdmin=${adminMe.json.project?.superAdmin === true}`);
    if (adminMe.status !== 200 || !adminMe.json.membership?.admin || adminMe.json.project?.superAdmin) {
      fail('Unexpected project-admin auth/me state');
    }

    const policyId = await ensureAccessPolicy(adminToken);
    const orgAId = await ensureOrganization(adminToken, CLINIC_A);
    const orgBId = await ensureOrganization(adminToken, CLINIC_B);
    log(`access policy + 2 organizations ensured: policyCreated=${!!policyId} orgACreated=${!!orgAId} orgBCreated=${!!orgBId}`);

    doctorA = await invite(saToken, projectId, { ...DOCTOR_A, admin: false, accessPolicyReference: `AccessPolicy/${policyId}` });
    staffB = await invite(saToken, projectId, { ...STAFF_B, admin: false });
    log(`doctorA + staffB invited: doctorAHasMembership=${!!doctorA.membershipId} staffBHasMembership=${!!staffB.membershipId}`);

    const doctorARoleId = await ensurePractitionerRole(adminToken, doctorA.practitionerId, orgAId, DOCTOR_A.email);
    const staffBRoleId = await ensurePractitionerRole(adminToken, staffB.practitionerId, orgBId, STAFF_B.email);
    log(`practitioner roles ensured: doctorARole=${!!doctorARoleId} staffBRole=${!!staffBRoleId}`);

    const fixtureVersions = {};
    for (const [type, id] of [['Practitioner', staffB.practitionerId], ['PractitionerRole', staffBRoleId]]) {
      const fixture = await request(adminToken, `fhir/R4/${type}/${id}`);
      if (fixture.status !== 200) fail('Fixture read failed');
      const seeded = await request(adminToken, `fhir/R4/${type}/${id}`, 'PUT', { ...fixture.json, text: narrative },
        { 'If-Match': `W/"${fixture.json.meta.versionId}"` });
      if (seeded.status !== 200 || seeded.json.text?.div !== narrative.div
        || !seeded.json.telecom?.length || !validId(seeded.json.meta?.versionId)) fail('Sensitive fixture seed failed');
      fixtureVersions[type] = seeded.json.meta.versionId;
    }
    log('sensitive fixtures: telecomAndNarrativeSeeded=true');
    await sleep(3000);
    const doctorAToken = await login(doctorA.email, doctorA.password, projectId);
    const doctorAMe = await request(doctorAToken, 'auth/me');

    const doctorAUserId = doctorA.userRef?.split('/')[1];
    const results = [];
    const record = recordFactory(results);

    await record('doctorA auth context + policy assigned (verified via superAdmin read)', () =>
      assertDoctorAuthContext(doctorAMe, saToken, doctorA.membershipId, projectId, policyId, doctorA.practitionerId));

    // --- With policy ---
    await record('ProjectMembership denied/no-others (with policy)', () => assertDeniedOrNoOthers(doctorAToken, 'ProjectMembership', doctorA.membershipId));
    await record('User denied/no-others (with policy)', () => assertDeniedOrNoOthers(doctorAToken, 'User', doctorAUserId));
    await record('Project denied/no-others (with policy)', () => assertDeniedOrNoOthers(doctorAToken, 'Project', projectId));

    await record('Practitioner directory masked + staffB fixture present (with policy)', () => assertDirectoryMasked(doctorAToken, 'Practitioner', staffB.practitionerId));
    await record('PractitionerRole directory masked + staffB fixture present (with policy)', () => assertDirectoryMasked(doctorAToken, 'PractitionerRole', staffBRoleId));

    await record('Practitioner/staffB direct read telecom+text absent', () => assertDirectReadMasked(doctorAToken, 'Practitioner', staffB.practitionerId));
    await record('Practitioner/staffB _elements=telecom absent', () => assertElementsMasked(doctorAToken, 'Practitioner', staffB.practitionerId));
    await record('Practitioner/staffB _history telecom absent', () => assertHistoryMasked(doctorAToken, 'Practitioner', staffB.practitionerId));
    await record('PractitionerRole?_include=PractitionerRole:practitioner telecom absent', () =>
      assertIncludeMasked(doctorAToken, `fhir/R4/PractitionerRole?_include=PractitionerRole:practitioner&_count=100`, staffB.practitionerId, staffBRoleId, 'Practitioner'));

    for (const [type, id] of [['Practitioner', staffB.practitionerId], ['PractitionerRole', staffBRoleId]]) {
      if (type === 'PractitionerRole') {
        await record(`${type}/staffB direct read telecom+text absent`, () => assertDirectReadMasked(doctorAToken, type, id));
        await record(`${type}/staffB _elements telecom+text absent`, () => assertElementsMasked(doctorAToken, type, id));
        await record(`${type}/staffB _history telecom+text absent`, () => assertHistoryMasked(doctorAToken, type, id));
        await record(`${type}/staffB PUT denied`, async () => {
          const got = await request(doctorAToken, `fhir/R4/${type}/${id}`);
          if (got.status !== 200) return { status: got.status, pass: false };
          return assertMutationDenied(doctorAToken, 'PUT', `fhir/R4/${type}/${id}`, got.json,
            { 'If-Match': `W/"${got.json.meta.versionId}"` });
        });
      }
      await record(`${type}/staffB vread telecom+text absent`, () =>
        assertDirectReadMasked(doctorAToken, type, `${id}/_history/${fixtureVersions[type]}`));
    }
    await record('Practitioner reverse include fixtures masked', () =>
      assertIncludeMasked(doctorAToken, `fhir/R4/Practitioner?_id=${staffB.practitionerId}&_revinclude=PractitionerRole:practitioner&_count=100`,
        staffB.practitionerId, staffBRoleId, 'PractitionerRole'));

    await record('POST Practitioner denied', () => assertMutationDenied(doctorAToken, 'POST', 'fhir/R4/Practitioner', { resourceType: 'Practitioner', name: [{ family: 'ShouldNotCreate' }] }));
    await record('PUT Practitioner/staffB denied', async () => {
      const got = await request(doctorAToken, `fhir/R4/Practitioner/${staffB.practitionerId}`);
      if (got.status !== 200) return { status: got.status, count: 0, pass: false };
      const headers = got.json.meta?.versionId ? { 'If-Match': `W/"${got.json.meta.versionId}"` } : {};
      return assertMutationDenied(doctorAToken, 'PUT', `fhir/R4/Practitioner/${staffB.practitionerId}`, got.json, headers);
    });
    await record('PATCH Practitioner/staffB denied', () =>
      assertMutationDenied(doctorAToken, 'PATCH', `fhir/R4/Practitioner/${staffB.practitionerId}`, [{ op: 'test', path: '/resourceType', value: 'Practitioner' }], { 'Content-Type': 'application/json-patch+json' }));
    await record('DELETE Practitioner/staffB denied', () => assertMutationDenied(doctorAToken, 'DELETE', `fhir/R4/Practitioner/${staffB.practitionerId}`));

    await record('POST PractitionerRole denied', () => assertMutationDenied(doctorAToken, 'POST', 'fhir/R4/PractitionerRole', { resourceType: 'PractitionerRole', practitioner: { reference: `Practitioner/${staffB.practitionerId}` } }));
    await record('PATCH PractitionerRole/staffB denied', () =>
      assertMutationDenied(doctorAToken, 'PATCH', `fhir/R4/PractitionerRole/${staffBRoleId}`, [{ op: 'test', path: '/resourceType', value: 'PractitionerRole' }], { 'Content-Type': 'application/json-patch+json' }));
    await record('DELETE PractitionerRole/staffB denied', () => assertMutationDenied(doctorAToken, 'DELETE', `fhir/R4/PractitionerRole/${staffBRoleId}`));

    await record('AccessPolicy read+write denied', async () => {
      const { pages, deniedStatus } = await collectPages(doctorAToken, 'fhir/R4/AccessPolicy?_count=100');
      const getOk = deniedStatus === 403 || (deniedStatus === null && entriesOf(pages).length === 0);
      const post = await request(doctorAToken, 'fhir/R4/AccessPolicy', 'POST', { resourceType: 'AccessPolicy', name: 'Task5b should-not-create' });
      return { status: `get=${deniedStatus ?? 200} post=${post.status}`, count: '-', pass: getOk && post.status === 403 };
    });

    await record('Patient search works', async () => {
      const { deniedStatus } = await collectPages(doctorAToken, 'fhir/R4/Patient?_count=1');
      return { status: deniedStatus ?? 200, count: '-', pass: deniedStatus === null };
    });

    // --- Control: same GETs with doctorA membership WITHOUT policy ---
    const memBefore = await request(saToken, `fhir/R4/ProjectMembership/${doctorA.membershipId}`);
    if (memBefore.status !== 200) fail('Could not read doctorA membership for control');
    try {
      const stripped = { ...memBefore.json };
      delete stripped.accessPolicy;
      const strip = await request(saToken, `fhir/R4/ProjectMembership/${doctorA.membershipId}`, 'PUT', stripped, { 'If-Match': `W/"${memBefore.json.meta.versionId}"` });
      if (strip.status !== 200) fail('Could not strip doctorA policy for control');

      await record('ProjectMembership denied/no-others (control, no policy)', () => assertDeniedOrNoOthers(doctorAToken, 'ProjectMembership', doctorA.membershipId));
      await record('User denied/no-others (control, no policy)', () => assertDeniedOrNoOthers(doctorAToken, 'User', doctorAUserId));
      await record('Project denied/no-others (control, no policy)', () => assertDeniedOrNoOthers(doctorAToken, 'Project', projectId));
      await record('Practitioner telecom exposed (control, no policy)', async () => {
        const { pages, deniedStatus } = await collectPages(doctorAToken, 'fhir/R4/Practitioner?_count=100');
        if (deniedStatus !== null) return { status: deniedStatus, count: 0, pass: false };
        const fixtures = entriesOf(pages);
        const telecomCount = fixtures.filter((r) => r?.telecom?.length).length;
        const seededFixture = fixtures.find((r) => r.id === staffB.practitionerId);
        // Control is expected to show the leak (telecom exposed): pass means the contrast was demonstrated.
        return { status: 200, count: telecomCount, pass: !!seededFixture?.telecom?.length && seededFixture.text?.div === narrative.div };
      });
    } finally {
      // Always restore, even if a control assertion threw. Idempotent: if
      // the policy is already assigned (e.g. the strip above never ran),
      // this PUT is a harmless no-op write of the same reference.
      const memAfterControl = await request(saToken, `fhir/R4/ProjectMembership/${doctorA.membershipId}`);
      if (memAfterControl.status !== 200) fail('Could not reread doctorA membership to restore');
      const restored = { ...memAfterControl.json, accessPolicy: { reference: `AccessPolicy/${policyId}` } };
      const restore = await request(saToken, `fhir/R4/ProjectMembership/${doctorA.membershipId}`, 'PUT', restored, { 'If-Match': `W/"${memAfterControl.json.meta.versionId}"` });
      if (restore.status !== 200) fail('Could not restore doctorA policy after control');
      const finalMem = await request(saToken, `fhir/R4/ProjectMembership/${doctorA.membershipId}`);
      const finalRestored = finalMem.status === 200 && finalMem.json.accessPolicy?.reference === `AccessPolicy/${policyId}`;
      log(`control restore: finalGrantsRestored=${finalRestored}`);
      if (!finalRestored) fail('Restore verification failed');
    }

    log('');
    log('| Assertion | Status | Count | PASS/FAIL |');
    log('| --- | --- | --- | --- |');
    for (const r of results) {
      const verdict = r.pass === null ? 'N/A' : r.pass ? 'PASS' : 'FAIL';
      log(`| ${r.name} | ${r.status} | ${r.count ?? '-'} | ${verdict} |`);
    }

    const anyFail = results.some((r) => r.pass !== true);
    if (anyFail) log('');
    if (anyFail) log('RESULT: one or more assertions FAILED.');

    writeEvidence();
    if (anyFail) process.exitCode = 1;
    return results;
  } finally {
    if (!KEEP && saToken) {
      const teardown = [];
      const priority = { PractitionerRole: 0, ProjectMembership: 1, Practitioner: 2, User: 3, AccessPolicy: 4, Organization: 5, Project: 6 };
      for (const { type, id } of [...created.values()].sort((a, b) => (priority[a.type] ?? 4) - (priority[b.type] ?? 4))) {
        try {
          if (type === 'User' && await remainingMembershipCountForUser(saToken, `User/${id}`) !== 0) {
            teardown.push('User: skipped-shared');
            continue;
          }
          const deleted = await request(saToken, `fhir/R4/${type}/${id}`, 'DELETE');
          if (![200, 204, 404, 410].includes(deleted.status)) fail(`Delete failed (${deleted.status})`);
          teardown.push(`${type}: status=${deleted.status}`);
        } catch (error) {
          process.exitCode = 1;
          teardown.push(`${type}: teardown FAILED (${error instanceof SafeError ? error.message : 'unexpected error'})`);
        }
      }
      if (untrackedCreation) {
        process.exitCode = 1;
        teardown.push('FAILED: successful creation lacked cleanup identity');
      }
      log('teardown: ' + (teardown.length ? teardown.join(' | ') : 'nothing to remove'));
    } else if (KEEP) {
      log('teardown skipped (--keep)');
    }
    writeEvidence();
    releaseLock();
  }
}

run().catch((error) => {
  if (error instanceof SafeError) console.error(error.message);
  console.error('Stopped; inspect locally without printing credentials or response bodies');
  writeEvidence();
  releaseLock();
  process.exitCode = 1;
});
