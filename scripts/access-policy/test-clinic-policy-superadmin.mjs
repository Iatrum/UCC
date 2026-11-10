// Task 090 Phase 0: disposable-identity verification of the REAL "UCC Clinic
// Staff Policy" (scripts/setup-access-policies.ts) against ordinary clinical
// resources (Patient/ServiceRequest/Observation), inside THIS box's actual
// superAdmin:true local project. Task 5b already proved the compartment
// mechanism for the Practitioner/PractitionerRole *directory* case in a
// *non-superAdmin* project; nobody had run the clinical-resource version in
// *this* project before. Answers .ai/PLAN-clinic-isolation.md Phase 0's two
// open questions:
//   Q1: does _compartment=%clinicAccount actually deny cross-clinic
//       Patient read/search for a staff member who HAS the clinicAccount
//       parameter, in this superAdmin project?
//   Q2: does the criteria block `create` of a resource that has no
//       meta.accounts yet (the gap between createResource and $set-accounts)?
//
// Safety: localhost:8113 only; throwaway Organization/HealthcareService/
// Practitioner/User/ProjectMembership/Patient/ServiceRequest/Observation,
// fake data, deleted in a finally; never touches doctor@ucc.local or any
// seeded clinic; never modifies the real AccessPolicy (read-only reference);
// never logs tokens/passwords/response bodies, only status/count/booleans.
import fs from 'node:fs';
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

const CLINIC_POLICY_NAME = 'UCC Clinic Staff Policy';
const STAFF_A = { firstName: 'Task90', lastName: 'StaffA', email: 'task90-staffa@example.invalid' };
const CLINIC_A = { system: 'clinic', value: 'task90-a', name: 'Task90 Clinic A' };
const CLINIC_B = { system: 'clinic', value: 'task90-b', name: 'Task90 Clinic B' };

const EVIDENCE_DIR = '/workspace/ai-logs/task90-phase0';
fs.mkdirSync(EVIDENCE_DIR, { recursive: true, mode: 0o700 });
const LOCK_FILE = `${EVIDENCE_DIR}/test.lock`;
const evidenceLines = [];
const log = (line) => { evidenceLines.push(line); console.log(line); };
const writeEvidence = () => fs.writeFileSync(`${EVIDENCE_DIR}/evidence.txt`, evidenceLines.join('\n') + '\n', { mode: 0o600 });
const RESULT_FILE = `${EVIDENCE_DIR}/result.json`;

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
  if (method === 'POST' && res.ok && !url.pathname.endsWith('/_search') && !url.pathname.includes('$')) {
    const fhirType = url.pathname.match(/^\/fhir\/R4\/([A-Za-z]+)$/)?.[1];
    if (fhirType) {
      const location = res.headers.get('location');
      const locationPath = location ? new URL(location, base).pathname : '';
      const locationId = locationPath.match(new RegExp(`/fhir/R4/${fhirType}/([^/]+)(?:/_history/[^/]+)?$`))?.[1];
      track(fhirType, validId(json?.id) ? json.id : locationId);
      requireResource(json, fhirType);
    } else if (url.pathname.endsWith('/invite')) {
      for (const [type, id] of [['ProjectMembership', json?.id],
        ['Practitioner', json?.profile?.reference?.split('/')[1]], ['User', json?.user?.reference?.split('/')[1]]]) {
        if (validId(id)) track(type, id);
        else untrackedCreation = true;
      }
      requireResource(json, 'ProjectMembership');
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
    if (json?.resourceType !== 'Bundle' || !Array.isArray(json.entry ?? [])) fail(`Malformed search response at ${next}`);
    pages.push(json);
    next = json.link?.find((l) => l.relation === 'next')?.url;
  }
  return { pages, deniedStatus };
}
const entriesOf = (pages) => pages.flatMap((p) => p.entry ?? []).map((e) => e.resource);

async function ensureOrganization(token, clinic) {
  const identifier = `${clinic.system}|${clinic.value}`;
  const { pages, deniedStatus } = await collectPages(token, `fhir/R4/Organization?identifier=${encodeURIComponent(identifier)}&_count=10`);
  if (deniedStatus !== null) fail(`Organization search failed (${deniedStatus})`);
  const matches = entriesOf(pages).filter((r) => r?.resourceType === 'Organization');
  if (matches[0]) return matches[0].id;
  const { status, json } = await request(token, 'fhir/R4/Organization', 'POST', {
    resourceType: 'Organization', name: clinic.name, identifier: [{ system: clinic.system, value: clinic.value }],
  });
  if (status !== 201 && status !== 200) fail(`Organization create failed (${status})`);
  return json.id;
}

async function ensureHealthcareService(token, clinic, organizationId) {
  const identifier = `${clinic.system}|${clinic.value}`;
  const { pages, deniedStatus } = await collectPages(token, `fhir/R4/HealthcareService?identifier=${encodeURIComponent(identifier)}&_count=10`);
  if (deniedStatus !== null) fail(`HealthcareService search failed (${deniedStatus})`);
  const matches = entriesOf(pages).filter((r) => r?.resourceType === 'HealthcareService');
  if (matches[0]) return matches[0].id;
  const { status, json } = await request(token, 'fhir/R4/HealthcareService', 'POST', {
    resourceType: 'HealthcareService', active: true, name: clinic.name,
    identifier: [{ system: clinic.system, value: clinic.value }],
    providedBy: { reference: `Organization/${organizationId}` },
  });
  if (status !== 201 && status !== 200) fail(`HealthcareService create failed (${status})`);
  return json.id;
}

async function setAccounts(token, resourceType, id, accountRef) {
  const { status } = await request(token, `fhir/R4/${resourceType}/${id}/$set-accounts`, 'POST', {
    resourceType: 'Parameters',
    parameter: [
      { name: 'accounts', valueReference: { reference: accountRef } },
      { name: 'propagate', valueBoolean: true },
    ],
  });
  return status;
}

async function remainingMembershipCountForUser(saToken, userRef) {
  const { pages, deniedStatus } = await collectPages(saToken, `fhir/R4/ProjectMembership?user=${encodeURIComponent(userRef)}&_count=100`);
  if (deniedStatus !== null) fail(`Membership-by-user search failed (${deniedStatus})`);
  return entriesOf(pages).length;
}

async function cleanupExistingIdentities(saToken, projectId, targetEmails) {
  const { pages, deniedStatus } = await collectPages(saToken, `fhir/R4/ProjectMembership?project=Project/${projectId}&_count=200`);
  if (deniedStatus !== null) fail(`Membership listing failed (${deniedStatus})`);
  let removed = 0;
  for (const membership of entriesOf(pages)) {
    const profileRef = membership.profile?.reference;
    if (!profileRef?.startsWith('Practitioner/')) continue;
    const { status, json: practitioner } = await request(saToken, `fhir/R4/${profileRef}`);
    if (status !== 200) continue;
    const email = practitioner.telecom?.find((t) => t.system === 'email')?.value;
    if (!email || !targetEmails.includes(email)) continue;
    const practitionerId = profileRef.split('/')[1];
    const roles = await collectPages(saToken, `fhir/R4/PractitionerRole?practitioner=Practitioner/${practitionerId}&_count=50`);
    for (const role of entriesOf(roles.pages)) {
      await request(saToken, `fhir/R4/PractitionerRole/${role.id}`, 'DELETE');
    }
    await request(saToken, `fhir/R4/ProjectMembership/${membership.id}`, 'DELETE');
    await request(saToken, `fhir/R4/Practitioner/${practitionerId}`, 'DELETE');
    const userRef = membership.user?.reference;
    if (userRef && await remainingMembershipCountForUser(saToken, userRef) === 0) {
      await request(saToken, `fhir/R4/${userRef}`, 'DELETE');
    }
    removed += 1;
  }
  return removed;
}

async function invite(saToken, projectId, { firstName, lastName, email }) {
  const password = randomBytes(24).toString('base64url');
  const { status, json } = await request(saToken, `admin/projects/${projectId}/invite`, 'POST', {
    resourceType: 'Practitioner', firstName, lastName, email, password, sendEmail: false, admin: false,
  });
  if (status !== 200 || json?.resourceType !== 'ProjectMembership') fail(`Invite failed (${status})`);
  return {
    membershipId: json.id,
    practitionerId: json.profile.reference.split('/')[1],
    userRef: json.user?.reference,
    email, password,
  };
}

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

async function run() {
  acquireLock();
  let saToken, projectId, policyId, orgAId, orgBId, accountAId, accountBId, staffA;
  let patientA1Id, patientB1Id, rawCreateAttemptId;
  try {
    log('=== Task 090 Phase 0: clinic policy vs. superAdmin project, clinical resources ===');
    saToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const saMe = await request(saToken, 'auth/me');
    if (saMe.status !== 200 || !saMe.json.membership?.admin || saMe.json.project?.superAdmin !== true) {
      fail('MEDPLUM_ADMIN_EMAIL/PASSWORD must be the local superAdmin');
    }
    projectId = saMe.json.project.id;
    log(`admin login: project.superAdmin=${saMe.json.project?.superAdmin === true} projectId=${!!projectId}`);

    const policySearch = await request(saToken, `fhir/R4/AccessPolicy?name=${encodeURIComponent(CLINIC_POLICY_NAME)}&_count=10`);
    const policyMatches = (policySearch.json?.entry ?? []).map((e) => e.resource).filter((r) => r?.name === CLINIC_POLICY_NAME);
    if (policyMatches.length !== 1) fail(`Expected exactly one real "${CLINIC_POLICY_NAME}" (found ${policyMatches.length}) — run scripts/setup-access-policies.ts first`);
    policyId = policyMatches[0].id;
    log(`real clinic staff policy found: AccessPolicy/${policyId} (read-only reference, never modified)`);

    const removed = await cleanupExistingIdentities(saToken, projectId, [STAFF_A.email]);
    log(`cleanup: removedStaleIdentities=${removed}`);
    await sleep(2000);

    orgAId = await ensureOrganization(saToken, CLINIC_A);
    orgBId = await ensureOrganization(saToken, CLINIC_B);
    accountAId = await ensureHealthcareService(saToken, CLINIC_A, orgAId);
    accountBId = await ensureHealthcareService(saToken, CLINIC_B, orgBId);
    log(`2 disposable clinics ensured: orgA=${!!orgAId} accountA=${!!accountAId} orgB=${!!orgBId} accountB=${!!accountBId}`);

    staffA = await invite(saToken, projectId, STAFF_A);
    log(`staffA invited: membershipCreated=${!!staffA.membershipId}`);

    // Mirror admin-service.ts withClinicMembershipAccess: real policy + real
    // parameter shape, applied via PUT (same as invitePractitionerToMedplum
    // does for an existing membership), never a bespoke substitute policy.
    const memBefore = await request(saToken, `fhir/R4/ProjectMembership/${staffA.membershipId}`);
    if (memBefore.status !== 200) fail('Could not read staffA membership');
    const withAccess = {
      ...memBefore.json,
      accessPolicy: undefined,
      access: [{
        policy: { reference: `AccessPolicy/${policyId}` },
        parameter: [
          { name: 'clinicAccount', valueReference: { reference: `HealthcareService/${accountAId}` } },
          { name: 'clinicOrganization', valueReference: { reference: `Organization/${orgAId}` } },
        ],
      }],
    };
    const memAfter = await request(saToken, `fhir/R4/ProjectMembership/${staffA.membershipId}`, 'PUT', withAccess,
      { 'If-Match': `W/"${memBefore.json.meta.versionId}"` });
    if (memAfter.status !== 200 || memAfter.json.access?.[0]?.policy?.reference !== `AccessPolicy/${policyId}`) {
      fail('Could not assign real clinic policy to staffA');
    }
    log('staffA assigned the real clinic policy with clinicAccount=A parameters');

    await sleep(3000);
    const staffAToken = await login(staffA.email, staffA.password, projectId);
    const staffAMe = await request(staffAToken, 'auth/me');
    if (staffAMe.status !== 200 || staffAMe.json.membership?.admin) fail('Unexpected staffA auth/me state');
    log(`staffA login: status=${staffAMe.status}`);

    const results = [];
    const record = recordFactory(results);

    // --- Q2: raw create by a policied user, resource with NO antecedent to inherit an account from ---
    await record('Q2: staffA raw Patient create (no meta.accounts, no patient-subject to inherit from)', async () => {
      const { status, json } = await request(staffAToken, 'fhir/R4/Patient', 'POST', {
        resourceType: 'Patient', name: [{ family: 'Task90RawCreateProbe' }],
      });
      if (validId(json?.id)) rawCreateAttemptId = json.id;
      // Documented, not a failure either way: this just measures whether the
      // compartment criteria blocks create before any account is derivable.
      return { status, count: '-', pass: status === 201 || status === 403 };
    });
    if (rawCreateAttemptId) {
      await record('Q2 follow-up: staffA immediate read-back of the just-created Patient', async () => {
        const { status } = await request(staffAToken, `fhir/R4/Patient/${rawCreateAttemptId}`);
        return { status, count: '-', pass: status === 200 || status === 404 };
      });
    }

    // --- Set up clinic A / clinic B patients the way the real app does: admin-client create, then $set-accounts ---
    const createA1 = await request(saToken, 'fhir/R4/Patient', 'POST', {
      resourceType: 'Patient', name: [{ family: 'Task90PatientA1' }], identifier: [{ system: 'clinic', value: CLINIC_A.value }],
    });
    if (createA1.status !== 201) fail(`Admin Patient A1 create failed (${createA1.status})`);
    patientA1Id = createA1.json.id;
    const setA1 = await setAccounts(saToken, 'Patient', patientA1Id, `HealthcareService/${accountAId}`);
    log(`Patient A1 created + stamped: create=${createA1.status} setAccounts=${setA1}`);

    const createB1 = await request(saToken, 'fhir/R4/Patient', 'POST', {
      resourceType: 'Patient', name: [{ family: 'Task90PatientB1' }], identifier: [{ system: 'clinic', value: CLINIC_B.value }],
    });
    if (createB1.status !== 201) fail(`Admin Patient B1 create failed (${createB1.status})`);
    patientB1Id = createB1.json.id;
    const setB1 = await setAccounts(saToken, 'Patient', patientB1Id, `HealthcareService/${accountBId}`);
    log(`Patient B1 created + stamped: create=${createB1.status} setAccounts=${setB1}`);

    // --- Q1 positive case: same-clinic direct read of an ordinary clinical resource, in THIS superAdmin project ---
    await record('Q1 positive: staffA direct read of same-clinic Patient A1', async () => {
      const { status } = await request(staffAToken, `fhir/R4/Patient/${patientA1Id}`);
      return { status, count: '-', pass: status === 200 };
    });

    // --- Q1 negative case: cross-clinic direct read + search containment ---
    await record('Q1 negative: staffA direct read of other-clinic Patient B1 (expect 404, SQL-filtered not found)', async () => {
      const { status } = await request(staffAToken, `fhir/R4/Patient/${patientB1Id}`);
      return { status, count: '-', pass: status === 404 };
    });
    await record('Q1 negative: staffA Patient search contains A1, never B1', async () => {
      const { pages, deniedStatus } = await collectPages(staffAToken, 'fhir/R4/Patient?_count=200');
      if (deniedStatus !== null) return { status: deniedStatus, count: 0, pass: false };
      const entries = entriesOf(pages);
      for (const e of entries) requireResource(e, 'Patient');
      const hasA1 = entries.some((r) => r.id === patientA1Id);
      const hasB1 = entries.some((r) => r.id === patientB1Id);
      return { status: 200, count: entries.length, pass: hasA1 && !hasB1 };
    });

    // --- Q2 realistic case: create a patient-subject resource via the user's own token (createLabOrder's real shape) ---
    await record('Q2 realistic: staffA creates ServiceRequest subject=Patient/A1 (own clinic)', async () => {
      const { status, json } = await request(staffAToken, 'fhir/R4/ServiceRequest', 'POST', {
        resourceType: 'ServiceRequest', status: 'active', intent: 'order',
        subject: { reference: `Patient/${patientA1Id}` },
        code: { text: 'Task90 probe test' },
      });
      return { status, count: '-', pass: status === 201 };
    });
    const createdSR = [...created.values()].find((c) => c.type === 'ServiceRequest');
    if (createdSR) {
      await record('Q2 realistic follow-up: staffA immediate read-back of own just-created ServiceRequest (no explicit $set-accounts call)', async () => {
        const { status } = await request(staffAToken, `fhir/R4/ServiceRequest/${createdSR.id}`);
        return { status, count: '-', pass: status === 200 };
      });
    }

    await record('Q2 realistic: staffA creates Observation subject=Patient/A1 (own clinic)', async () => {
      const { status } = await request(staffAToken, 'fhir/R4/Observation', 'POST', {
        resourceType: 'Observation', status: 'final',
        subject: { reference: `Patient/${patientA1Id}` },
        code: { text: 'Task90 probe observation' },
      });
      return { status, count: '-', pass: status === 201 };
    });

    // --- Write-side containment: staffA must not be able to attach new data to another clinic's patient ---
    await record('Write containment: staffA create Observation subject=Patient/B1 (other clinic) denied', async () => {
      const { status } = await request(staffAToken, 'fhir/R4/Observation', 'POST', {
        resourceType: 'Observation', status: 'final',
        subject: { reference: `Patient/${patientB1Id}` },
        code: { text: 'Task90 probe observation (should be denied)' },
      });
      return { status, count: '-', pass: status === 403 };
    });

    log('');
    log('| Assertion | Status | Count | PASS/FAIL |');
    log('| --- | --- | --- | --- |');
    for (const r of results) {
      const verdict = r.pass === null ? 'N/A' : r.pass ? 'PASS' : 'FAIL';
      log(`| ${r.name} | ${r.status} | ${r.count ?? '-'} | ${verdict} |`);
    }

    const anyFail = results.some((r) => r.pass !== true);
    if (anyFail) { log(''); log('RESULT: one or more assertions FAILED.'); }
    else { log(''); log('RESULT: all assertions PASSED.'); }

    fs.writeFileSync(RESULT_FILE, JSON.stringify({
      ranAt: new Date().toISOString(),
      results, anyFail,
    }, null, 2), { mode: 0o600 });
    writeEvidence();
    if (anyFail) process.exitCode = 1;
    return results;
  } finally {
    if (!KEEP && saToken) {
      const teardown = [];
      const priority = { Observation: 0, ServiceRequest: 0, Patient: 1, PractitionerRole: 1, ProjectMembership: 2, Practitioner: 3, User: 4, HealthcareService: 5, Organization: 6 };
      for (const { type, id } of [...created.values()].sort((a, b) => (priority[a.type] ?? 3) - (priority[b.type] ?? 3))) {
        try {
          if (type === 'User' && await remainingMembershipCountForUser(saToken, `User/${id}`) !== 0) {
            teardown.push('User: skipped-shared');
            continue;
          }
          const deleted = await request(saToken, `fhir/R4/${type}/${id}`, 'DELETE');
          if (![200, 204, 404, 410].includes(deleted.status)) fail(`Delete failed (${type}/${id}: ${deleted.status})`);
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
